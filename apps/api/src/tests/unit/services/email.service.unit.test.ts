// email.service reads its provider when it loads, so each test loads it fresh with its own settings
type Env = Record<string, unknown>;

const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport } }));

const load = (env: Env) => {
  let service!: typeof import("../../../services/notifications/email.service");
  jest.isolateModules(() => {
    jest.doMock("../../../config/env", () => ({
      env: { EMAIL_FROM: "PurpleWallet <onboarding@resend.dev>", APP_URL: "http://localhost:5173", ...env },
    }));
    service = require("../../../services/notifications/email.service");
  });
  return service;
};

const email = { to: "ada@mailbox.ng", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

describe("email.service", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("with Gmail", () => {
    const gmailEnv = { EMAIL_PROVIDER: "gmail", GMAIL_USER: "purplewallet.demo@gmail.com", GMAIL_APP_PASSWORD: "abcdefghijklmnop" };

    it("signs in to Gmail with the app password and sends as PurpleWallet", async () => {
      const service = load(gmailEnv);
      sendMail.mockResolvedValue({ messageId: "1" });

      await service.sendEmail(email);

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ service: "gmail", auth: { user: "purplewallet.demo@gmail.com", pass: "abcdefghijklmnop" } })
      );
      expect(sendMail).toHaveBeenCalledWith({
        from: { name: "PurpleWallet", address: "purplewallet.demo@gmail.com" },
        to: "ada@mailbox.ng",
        subject: "Hello",
        html: "<p>Hi</p>",
        text: "Hi",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(service.isEmailConfigured()).toBe(true);
      expect(service.senderAddress()).toBe("purplewallet.demo@gmail.com");
    });

    it("throws when Gmail refuses, so the job retries", async () => {
      const service = load(gmailEnv);
      sendMail.mockRejectedValue(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"));
      await expect(service.sendEmail(email)).rejects.toThrow("Invalid login");
    });
  });

  describe("with Resend", () => {
    it("sends through Resend's API as before", async () => {
      const service = load({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" });
      fetchMock.mockResolvedValue({ ok: true });

      await service.sendEmail(email);

      expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
      expect(createTransport).not.toHaveBeenCalled();
      expect(service.senderAddress()).toBe("onboarding@resend.dev");
    });

    it("never sends to demo or reserved test addresses", async () => {
      const service = load({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" });
      for (const to of ["demo@purplewallet.demo", "ada@example.com", "someone@school.test"]) await service.sendEmail({ ...email, to });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("only logs when no key is set", async () => {
      const service = load({ EMAIL_PROVIDER: "resend" });
      await service.sendEmail(email);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(service.isEmailConfigured()).toBe(false);
    });
  });
});

describe("email settings", () => {
  const parse = (vars: Env) => {
    const saved = { ...process.env };
    Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: "postgresql://x:y@localhost:5432/z", JWT_SECRET: "test-secret", ...vars });
    const exit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as never);
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      let result: unknown;
      jest.isolateModules(() => {
        jest.dontMock("../../../config/env");
        result = require("../../../config/env").env;
      });
      return { env: result as Env, messages: error.mock.calls.flat().join(" ") };
    } catch {
      return { env: null, messages: error.mock.calls.flat().join(" ") };
    } finally {
      process.env = saved;
      exit.mockRestore();
      error.mockRestore();
    }
  };

  it("refuses to start with Gmail chosen but no app password", () => {
    const { env, messages } = parse({ EMAIL_PROVIDER: "gmail", GMAIL_USER: "demo@gmail.com", GMAIL_APP_PASSWORD: "" });
    expect(env).toBeNull();
    expect(messages).toContain("EMAIL_PROVIDER=gmail needs GMAIL_USER and GMAIL_APP_PASSWORD");
  });

  it("accepts the app password with Google's spaces", () => {
    const { env } = parse({ EMAIL_PROVIDER: "gmail", GMAIL_USER: "demo@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(env?.GMAIL_APP_PASSWORD).toBe("abcdefghijklmnop");
  });
});
