process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";

import { statusEmoji, sellerButtonLabel } from "../manager/handlers";
import { Seller } from "../models/seller";

// Minimal seller mock (we only need _id, status, botUsername, telegramId)
function makeSeller(overrides: Partial<Seller> = {}): Seller {
  return {
    _id: undefined as any,
    telegramId: "123456789",
    botToken: "fake:token",
    botUsername: "TestBot",
    status: "active",
    maxProducts: 3,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("Manager Helper Functions", () => {
  describe("statusEmoji()", () => {
    it("returns [Active] for active", () => {
      expect(statusEmoji("active")).toBe("[Active]");
    });

    it("returns [Trial] for trial", () => {
      expect(statusEmoji("trial")).toBe("[Trial]");
    });

    it("returns [Expired] for expired", () => {
      expect(statusEmoji("expired")).toBe("[Expired]");
    });

    it("returns [Token Invalid] for token_invalid", () => {
      expect(statusEmoji("token_invalid")).toBe("[Token Invalid]");
    });

    it("returns [Expired] for any unknown status", () => {
      expect(statusEmoji("unknown")).toBe("[Expired]");
      expect(statusEmoji("")).toBe("[Expired]");
      expect(statusEmoji("ACTIVE")).toBe("[Expired]");
    });
  });

  describe("sellerButtonLabel()", () => {
    it("shows status label and @username", () => {
      const seller = makeSeller({ status: "active", botUsername: "MyBot" });
      expect(sellerButtonLabel(seller)).toBe("[Active] @MyBot");
    });

    it("shows trial label for trial seller", () => {
      const seller = makeSeller({ status: "trial", botUsername: "NewBot" });
      expect(sellerButtonLabel(seller)).toBe("[Trial] @NewBot");
    });

    it("shows expired label for expired seller", () => {
      const seller = makeSeller({ status: "expired", botUsername: "OldBot" });
      expect(sellerButtonLabel(seller)).toBe("[Expired] @OldBot");
    });

    it("shows token_invalid label for seller with revoked token", () => {
      const seller = makeSeller({ status: "token_invalid", botUsername: "RevokedBot" });
      expect(sellerButtonLabel(seller)).toBe("[Token Invalid] @RevokedBot");
    });

    it("falls back to telegramId when botUsername is missing", () => {
      const seller = makeSeller({ botUsername: undefined, telegramId: "999888777" });
      expect(sellerButtonLabel(seller)).toBe("[Active] @999888777");
    });

    it("falls back to telegramId when botUsername is empty string", () => {
      const seller = makeSeller({ botUsername: "", telegramId: "999888777" });
      expect(sellerButtonLabel(seller)).toBe("[Active] @999888777");
    });

    it("uses telegramId as fallback for any status", () => {
      const seller = makeSeller({ status: "trial", botUsername: undefined, telegramId: "111222333" });
      expect(sellerButtonLabel(seller)).toBe("[Trial] @111222333");
    });
  });
});
