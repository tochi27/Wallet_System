import { Prisma } from "@prisma/client";

jest.mock("../../../config/env", () => ({
  env: {
    PAYSTACK_SECRET_KEY: "sk_test_unit",
    PAYSTACK_BASE_URL: "https://api.paystack.test",
  },
}));

import { env } from "../../../config/env";
import {
  fromSubunit,
  initializeTransaction,
  PaymentsNotConfiguredError,
  PaystackError,
  toSubunit,
  verifyTransaction,
} from "../../../services/payments/paystack.client";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response;

describe("paystack.client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (env as { PAYSTACK_SECRET_KEY?: string }).PAYSTACK_SECRET_KEY = "sk_test_unit";
  });

  describe("toSubunit / fromSubunit", () => {
    it("converts naira to kobo without floating-point drift", () => {
      expect(toSubunit(1000.1)).toBe(100010);
      expect(toSubunit("19.99")).toBe(1999);
      expect(toSubunit(new Prisma.Decimal("5000.00"))).toBe(500000);
    });

    it("converts kobo back to naira", () => {
      expect(fromSubunit(75050).toFixed(2)).toBe("750.50");
    });
  });

  describe("initializeTransaction", () => {
    it("posts the payment details with the secret key and returns the checkout data", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          status: true,
          message: "Authorization URL created",
          data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "dep_1" },
        })
      );

      const result = await initializeTransaction({
        email: "ada@example.com",
        amount: 500000,
        reference: "dep_1",
        currency: "NGN",
        callbackUrl: "http://localhost:5173/deposit/callback",
      });

      expect(result.authorization_url).toBe("https://checkout.paystack.com/abc");
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.paystack.test/transaction/initialize");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer sk_test_unit");
      expect(JSON.parse(init.body)).toMatchObject({
        email: "ada@example.com",
        amount: 500000,
        reference: "dep_1",
        currency: "NGN",
        callback_url: "http://localhost:5173/deposit/callback",
      });
    });

    it("throws a PaystackError with Paystack's message when the request is rejected", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ status: false, message: "Invalid key" }, 401));

      await expect(
        initializeTransaction({ email: "a@b.co", amount: 100, reference: "r", currency: "NGN", callbackUrl: "http://x.co" })
      ).rejects.toMatchObject({ name: "PaystackError", message: "Invalid key", status: 401 });
    });

    it("throws a PaystackError when Paystack cannot be reached", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      await expect(verifyTransaction("dep_1")).rejects.toBeInstanceOf(PaystackError);
    });

    it("refuses to call Paystack without a secret key", async () => {
      (env as { PAYSTACK_SECRET_KEY?: string }).PAYSTACK_SECRET_KEY = undefined;

      await expect(verifyTransaction("dep_1")).rejects.toBeInstanceOf(PaymentsNotConfiguredError);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("verifyTransaction", () => {
    it("fetches the transaction by URL-encoded reference", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ status: true, message: "ok", data: { status: "success", amount: 100 } }));

      const result = await verifyTransaction("dep/1");

      expect(mockFetch.mock.calls[0][0]).toBe("https://api.paystack.test/transaction/verify/dep%2F1");
      expect(result.status).toBe("success");
    });
  });
});
