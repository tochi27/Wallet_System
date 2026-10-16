import { ApiError, createPartFromFunctionResponse, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { z } from "zod";
import { env } from "../../config/env";
import logger from "../../config/logger";
import redisClient from "../redis.service";

// Every Gemini call in the app goes through this file, so changing provider means changing one file.

const REQUEST_TIMEOUT_MS = 30_000;
// After an outage, skip that model for a while instead of waiting on it again. Rate limits are
// usually per minute, so they're benched for less time than an overload or timeout.
const OUTAGE_COOLDOWN_SECONDS = 5 * 60;
const RATE_LIMIT_COOLDOWN_SECONDS = 60;
// A used-up daily quota won't come back for hours: don't keep trying that model first
const DAILY_QUOTA_COOLDOWN_SECONDS = 60 * 60;

const cooldownKey = (model: string) => `ai:cooldown:${model}`;

// Overloaded (503), gateway timeout (504), rate limited (429) or our own request timeout. A model
// that merely answered badly isn't benched.
const isOutage = (error: unknown) =>
  error instanceof ApiError
    ? error.status === 429 || error.status >= 500
    : error instanceof Error && /abort|timeout|timed out/i.test(`${error.name} ${error.message}`);

const markDown = async (model: string, error: unknown) => {
  if (!isOutage(error)) return;
  const seconds =
    error instanceof ApiError && error.status === 429
      ? /PerDay/i.test(error.message)
        ? DAILY_QUOTA_COOLDOWN_SECONDS
        : RATE_LIMIT_COOLDOWN_SECONDS
      : OUTAGE_COOLDOWN_SECONDS;
  await redisClient.set(cooldownKey(model), "1", "EX", seconds).catch(() => undefined);
};

/**
 * The models to try, healthy ones first. A model in cooldown is still tried last, so a request is
 * never refused just because every model recently failed.
 */
const inOrder = async (models: string[]): Promise<string[]> => {
  const unique = [...new Set(models)];
  const down = await Promise.all(unique.map((m) => redisClient.exists(cooldownKey(m)).catch(() => 0)));
  return [...unique.filter((_, i) => !down[i]), ...unique.filter((_, i) => down[i])];
};

/** Every model in the chain failed (overloaded, rate-limited, timed out, or returned bad JSON). */
export class AiUnavailableError extends Error {
  constructor(message = "The AI service is unavailable") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export const isAiConfigured = (): boolean => Boolean(env.GEMINI_API_KEY);

let client: GoogleGenAI | null = null;
const getClient = () => {
  if (!env.GEMINI_API_KEY) throw new AiUnavailableError("GEMINI_API_KEY is not set");
  // One attempt per call: the SDK otherwise retries for minutes on an overloaded model. Our own
  // fallback chain and job retries take over instead.
  client ??= new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  return client;
};

type JsonRequest<T extends z.ZodType> = {
  // Tried in order until one returns valid JSON
  models: string[];
  system: string;
  prompt: string;
  schema: T;
};

/**
 * Asks Gemini for JSON matching `schema`. The schema is sent as a response constraint and the
 * reply is validated again here, so callers only ever get well-formed data. Falls through the
 * model list on overload (503), rate limits (429), timeouts and invalid output.
 */
export const generateJson = async <T extends z.ZodType>(request: JsonRequest<T>): Promise<{ data: z.infer<T>; model: string }> => {
  const ai = getClient();
  let lastError: unknown;

  for (const model of await inOrder(request.models)) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: request.prompt,
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(request.schema),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const parsed = request.schema.safeParse(JSON.parse(response.text ?? ""));
      if (parsed.success) return { data: parsed.data, model };
      lastError = new Error(`Invalid output: ${parsed.error.issues[0]?.message}`);
    } catch (error) {
      lastError = error;
      await markDown(model, error);
    }
    logger.warn(
      { model, status: lastError instanceof ApiError ? lastError.status : undefined, err: String(lastError).slice(0, 300) },
      "Gemini call failed, trying the next model"
    );
  }

  throw new AiUnavailableError(lastError instanceof Error ? lastError.message : "No model responded");
};

// ── Conversations with tools ────────────────────────────────────────────────

export type ToolSpec = { name: string; description: string; parameters: unknown };
export type ChatTurn = { role: "user" | "assistant"; text: string };
// A tool's outcome: either a result for the model to read, or the final value that ends the turn
export type ToolOutcome = { response: Record<string, unknown> } | { done: true; value: unknown };

type ToolChat = {
  models: string[];
  system: string;
  history: ChatTurn[];
  message: string;
  tools: ToolSpec[];
  execute: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  maxSteps: number;
};

/**
 * A tool-calling conversation turn. The model must call a tool every step (mode ANY), so the turn
 * only ends when `execute` reports `done` (the caller's "respond" tool). Falls back to the next
 * model if one fails; tools are read-only, so starting over on another model is safe.
 */
export const chatWithTools = async (chat: ToolChat): Promise<{ value: unknown; model: string }> => {
  const ai = getClient();
  let lastError: unknown;

  for (const model of await inOrder(chat.models)) {
    const contents: Content[] = [
      ...chat.history.map((turn): Content => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] })),
      { role: "user", parts: [{ text: chat.message }] },
    ];
    try {
      for (let step = 0; step < chat.maxSteps; step++) {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: chat.system,
            tools: [{ functionDeclarations: chat.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        const calls = response.functionCalls ?? [];
        const modelContent = response.candidates?.[0]?.content;
        if (calls.length === 0 || !modelContent) throw new Error("The model didn't call a tool");

        // Keep the model's own turn as-is: it carries the signatures Gemini needs to continue
        contents.push(modelContent);
        const parts = [];
        for (const call of calls) {
          const outcome = await chat.execute(call.name ?? "", call.args ?? {});
          if ("done" in outcome) return { value: outcome.value, model };
          parts.push(createPartFromFunctionResponse(call.id ?? "", call.name ?? "", outcome.response));
        }
        contents.push({ role: "user", parts });
      }
      throw new Error(`No answer after ${chat.maxSteps} steps`);
    } catch (error) {
      lastError = error;
      await markDown(model, error);
      logger.warn(
        { model, status: error instanceof ApiError ? error.status : undefined, err: String(error).slice(0, 300) },
        "Gemini tool conversation failed, trying the next model"
      );
    }
  }
  throw new AiUnavailableError(lastError instanceof Error ? lastError.message : "No model responded");
};
