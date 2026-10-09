import crypto from "crypto";

// We need to test the pure logic of verifyIPNSignature.
// Since it reads IPN_SECRET from module-level constant, we mock env before import.
// However the function is already bound at import time, so we test the algorithm directly.

describe("NOWPayments IPN Signature Verification", () => {
  const SECRET = "test_ipn_secret_key_12345";

  // Replicate the exact HMAC-SHA512 logic from verifyIPNSignature
  function computeSignature(body: string, secret: string): string {
    const hmac = crypto.createHmac("sha512", secret);
    hmac.update(body);
    return hmac.digest("hex");
  }

  // Import the actual function and test with env manipulation
  let verifyIPNSignature: (body: string, signature: string) => boolean;

  beforeAll(() => {
    // Set the env var before requiring the module
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
    // Re-import to pick up the env var
    jest.resetModules();
    const mod = require("../services/nowpayments");
    verifyIPNSignature = mod.verifyIPNSignature;
  });

  afterAll(() => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
  });

  it("returns true for a valid signature", () => {
    const body = '{"id":123,"status":"finished","order_id":"sub_abc"}';
    const signature = computeSignature(body, SECRET);
    expect(verifyIPNSignature(body, signature)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = '{"id":123,"status":"finished"}';
    const fakeSignature = "a".repeat(128); // wrong hex
    expect(verifyIPNSignature(body, fakeSignature)).toBe(false);
  });

  it("returns false when body is tampered", () => {
    const originalBody = '{"id":123,"status":"finished"}';
    const signature = computeSignature(originalBody, SECRET);
    const tamperedBody = '{"id":123,"status":"cancelled"}';
    expect(verifyIPNSignature(tamperedBody, signature)).toBe(false);
  });

  it("returns false when secret is not configured", () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    jest.resetModules();
    const mod = require("../services/nowpayments");
    const verifyNoSecret = mod.verifyIPNSignature;
    const body = '{"id":123}';
    const sig = computeSignature(body, "any_secret");
    expect(verifyNoSecret(body, sig)).toBe(false);
    // Restore
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    jest.resetModules();
    const restored = require("../services/nowpayments");
    verifyIPNSignature = restored.verifyIPNSignature;
  });

  it("returns false for empty signature", () => {
    const body = '{"id":123}';
    expect(verifyIPNSignature(body, "")).toBe(false);
  });

  it("returns false for empty body", () => {
    const signature = computeSignature("", SECRET);
    expect(verifyIPNSignature("", signature)).toBe(true); // valid sig for empty body
    expect(verifyIPNSignature("not_empty", signature)).toBe(false);
  });

  it("produces consistent signatures", () => {
    const body = "test data";
    const sig1 = computeSignature(body, SECRET);
    const sig2 = computeSignature(body, SECRET);
    expect(sig1).toBe(sig2);
    expect(verifyIPNSignature(body, sig1)).toBe(true);
  });

  it("produces different signatures for different secrets", () => {
    const body = "test data";
    const sig1 = computeSignature(body, "secret_one");
    const sig2 = computeSignature(body, "secret_two");
    expect(sig1).not.toBe(sig2);
  });
});
