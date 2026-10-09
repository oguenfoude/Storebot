import crypto from "crypto";

describe("Payment Key Encryption", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-for-unit-tests-32b!";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("encrypts and decrypts round-trip", () => {
    const { encryptApiKey, decryptApiKey } = require("../helpers/encryption");
    const plaintext = "np_test_api_key_1234567890abcdef";
    const encrypted = encryptApiKey(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const { encryptApiKey } = require("../helpers/encryption");
    const plaintext = "np_same_key";
    const enc1 = encryptApiKey(plaintext);
    const enc2 = encryptApiKey(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("format is base64:base64:base64", () => {
    const { encryptApiKey } = require("../helpers/encryption");
    const encrypted = encryptApiKey("test-key");
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("throws on invalid encrypted format", () => {
    const { decryptApiKey } = require("../helpers/encryption");
    expect(() => decryptApiKey("invalid")).toThrow("Invalid encrypted API key format");
  });

  it("throws on wrong number of parts", () => {
    const { decryptApiKey } = require("../helpers/encryption");
    expect(() => decryptApiKey("a:b")).toThrow("Invalid encrypted API key format");
  });

  it("fails fast when API_KEY_ENCRYPTION_SECRET is missing", () => {
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    try {
      require("../helpers/encryption");
      fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("API_KEY_ENCRYPTION_SECRET not configured");
    }
  });
});

describe("NOWPayments API Key Validation", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-for-unit-tests-32b!";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("validateNOWPaymentsKey returns true for valid key", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const { validateNOWPaymentsKey } = require("../services/nowpayments");
    const result = await validateNOWPaymentsKey("np_valid_key");
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/currencies"),
      expect.objectContaining({ headers: { "x-api-key": "np_valid_key" } })
    );
  });

  it("validateNOWPaymentsKey returns false for invalid key", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const { validateNOWPaymentsKey } = require("../services/nowpayments");
    const result = await validateNOWPaymentsKey("np_bad_key");
    expect(result).toBe(false);
  });

  it("validateNOWPaymentsKey returns false on network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
    const { validateNOWPaymentsKey } = require("../services/nowpayments");
    const result = await validateNOWPaymentsKey("np_key");
    expect(result).toBe(false);
  });
});

describe("createSubscriptionInvoice with per-seller key", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-for-unit-tests-32b!";
    process.env.NOWPAYMENTS_API_KEY = "np_global_key";
    process.env.NOWPAYMENTS_IPN_SECRET = "test_ipn_secret";
    process.env.WEBHOOK_URL = "https://example.com";
    process.env.FRONTEND_URL = "";
    process.env.TELEGRAM_ADMIN_IDS = "12345";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses seller key when provided (decrypts it)", async () => {
    const { encryptApiKey } = require("../helpers/encryption");
    const sellerApiKey = encryptApiKey("np_seller_key_123");

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 99999 }),
    });

    jest.mock("../db", () => ({
      connectToDB: jest.fn().mockResolvedValue({
        collection: jest.fn().mockReturnValue({
          insertOne: jest.fn().mockResolvedValue({}),
          updateOne: jest.fn().mockResolvedValue({}),
        }),
      }),
    }));

    const { createSubscriptionInvoice } = require("../services/nowpayments");
    const { ObjectId } = require("mongodb");
    await createSubscriptionInvoice(new ObjectId(), "testuser", 30, 3, sellerApiKey);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "np_seller_key_123",
        }),
      })
    );
  });

  it("falls back to global key when seller key is undefined", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 88888 }),
    });

    jest.mock("../db", () => ({
      connectToDB: jest.fn().mockResolvedValue({
        collection: jest.fn().mockReturnValue({
          insertOne: jest.fn().mockResolvedValue({}),
          updateOne: jest.fn().mockResolvedValue({}),
        }),
      }),
    }));

    const { createSubscriptionInvoice } = require("../services/nowpayments");
    const { ObjectId } = require("mongodb");
    await createSubscriptionInvoice(new ObjectId(), "testuser", 30, 3, undefined);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "np_global_key",
        }),
      })
    );
  });

  it("returns null when no key is available", async () => {
    delete process.env.NOWPAYMENTS_API_KEY;

    const { createSubscriptionInvoice } = require("../services/nowpayments");
    const { ObjectId } = require("mongodb");
    const result = await createSubscriptionInvoice(new ObjectId(), "testuser", 30, 3);
    expect(result).toBeNull();
  });
});
