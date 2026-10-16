import { z } from "zod";

const generateContent = jest.fn();
jest.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor({ message, status }: { message: string; status: number }) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    ThinkingLevel: { LOW: "LOW" },
    GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent } })),
  };
});
jest.mock("../../../config/env", () => ({ env: { GEMINI_API_KEY: "test-key" } }));
const cooling = new Set<string>();
jest.mock("../../../services/redis.service", () => ({
  __esModule: true,
  default: {
    exists: jest.fn(async (key: string) => (cooling.has(key) ? 1 : 0)),
    set: jest.fn(async (key: string) => {
      cooling.add(key);
      return "OK";
    }),
  },
}));

import { ApiError } from "@google/genai";
import { AiUnavailableError, generateJson } from "../../../services/ai/gemini.client";

const schema = z.object({ category: z.enum(["FOOD", "OTHER"]) });
const request = { models: ["main-model", "backup-model"], system: "s", prompt: "p", schema };

describe("gemini.client generateJson", () => {
  beforeEach(() => {
    generateContent.mockReset();
    cooling.clear();
  });

  it("returns validated JSON and which model produced it", async () => {
    generateContent.mockResolvedValue({ text: '{"category":"FOOD"}' });

    await expect(generateJson(request)).resolves.toEqual({ data: { category: "FOOD" }, model: "main-model" });
    const call = generateContent.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseJsonSchema).toMatchObject({ type: "object" });
  });

  it("falls back to the next model when the first is overloaded", async () => {
    generateContent
      .mockRejectedValueOnce(new ApiError({ message: "high demand", status: 503 }))
      .mockResolvedValueOnce({ text: '{"category":"OTHER"}' });

    await expect(generateJson(request)).resolves.toEqual({ data: { category: "OTHER" }, model: "backup-model" });
  });

  it("falls back when a model returns JSON that doesn't match the schema", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"category":"CARS"}' }).mockResolvedValueOnce({ text: '{"category":"FOOD"}' });

    await expect(generateJson(request)).resolves.toMatchObject({ model: "backup-model" });
  });

  it("gives up with AiUnavailableError when every model fails", async () => {
    generateContent.mockRejectedValue(new ApiError({ message: "quota", status: 429 }));

    await expect(generateJson(request)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("asks each model once even if it's listed twice", async () => {
    generateContent.mockRejectedValue(new Error("timeout"));

    await expect(generateJson({ ...request, models: ["same", "same"] })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("benches an overloaded model so the next request goes straight to the healthy one", async () => {
    generateContent
      .mockRejectedValueOnce(new ApiError({ message: "high demand", status: 503 }))
      .mockResolvedValueOnce({ text: '{"category":"FOOD"}' });
    await generateJson(request);

    generateContent.mockResolvedValueOnce({ text: '{"category":"OTHER"}' });
    await expect(generateJson(request)).resolves.toMatchObject({ model: "backup-model" });
    expect(generateContent.mock.calls[2][0].model).toBe("backup-model");
  });

  it("doesn't bench a model for a bad answer", async () => {
    generateContent.mockResolvedValueOnce({ text: "not json" }).mockResolvedValueOnce({ text: '{"category":"FOOD"}' });
    await generateJson(request);

    generateContent.mockResolvedValueOnce({ text: '{"category":"OTHER"}' });
    await expect(generateJson(request)).resolves.toMatchObject({ model: "main-model" });
  });
});
