import { parseManagerCallback, ManagerCallback } from "../manager/callbackParser";

describe("Manager Callback Parser", () => {
  describe("sellers list", () => {
    it("parses mgr:sellers", () => {
      const result = parseManagerCallback("mgr:sellers");
      expect(result).toEqual({ type: "sellers" });
    });
  });

  describe("seller detail", () => {
    it("parses mgr:seller:<id>", () => {
      const id = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:seller:${id}`);
      expect(result).toEqual({ type: "seller_detail", sellerId: id });
    });

    it("handles long ObjectId strings", () => {
      const id = "507f1f77bcf86cd799439011507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:seller:${id}`);
      expect(result).toEqual({ type: "seller_detail", sellerId: id });
    });
  });

  describe("user list", () => {
    it("parses mgr:users:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:users:${sellerId}`);
      expect(result).toEqual({ type: "user_list", sellerId, page: 0 });
    });

    it("parses mgr:users:<sellerId>:<page>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:users:${sellerId}:2`);
      expect(result).toEqual({ type: "user_list", sellerId, page: 2 });
    });

    it("defaults to page 0 when no page specified", () => {
      const result = parseManagerCallback("mgr:users:abc123");
      expect(result).toEqual({ type: "user_list", sellerId: "abc123", page: 0 });
    });

    it("handles page 0 explicitly", () => {
      const result = parseManagerCallback("mgr:users:abc123:0");
      expect(result).toEqual({ type: "user_list", sellerId: "abc123", page: 0 });
    });
  });

  describe("user detail", () => {
    it("parses mgr:user:<userId>", () => {
      const userId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:user:${userId}`);
      expect(result).toEqual({ type: "user_detail", userId });
    });
  });

  describe("product list", () => {
    it("parses mgr:products:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:products:${sellerId}`);
      expect(result).toEqual({ type: "product_list", sellerId, page: 0 });
    });

    it("parses mgr:products:<sellerId>:<page>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:products:${sellerId}:3`);
      expect(result).toEqual({ type: "product_list", sellerId, page: 3 });
    });
  });

  describe("product detail", () => {
    it("parses mgr:product:<productId>", () => {
      const productId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:product:${productId}`);
      expect(result).toEqual({ type: "product_detail", productId });
    });
  });

  describe("back navigation", () => {
    it("parses mgr:back:seller:<id>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:back:seller:${sellerId}`);
      expect(result).toEqual({ type: "back_seller", sellerId });
    });

    it("parses mgr:back:users:<id>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:back:users:${sellerId}`);
      expect(result).toEqual({ type: "back_users", sellerId });
    });

    it("parses mgr:back:products:<id>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:back:products:${sellerId}`);
      expect(result).toEqual({ type: "back_products", sellerId });
    });
  });

  describe("pay seller selection", () => {
    it("parses mgr:pay:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:pay:${sellerId}`);
      expect(result).toEqual({ type: "pay_seller", sellerId });
    });

    it("returns unknown for mgr:pay with no id", () => {
      const result = parseManagerCallback("mgr:pay:");
      expect(result).toEqual({ type: "unknown", raw: "mgr:pay:" });
    });
  });

  describe("seller_back navigation", () => {
    it("parses mgr:seller_back", () => {
      const result = parseManagerCallback("mgr:seller_back");
      expect(result).toEqual({ type: "seller_back" });
    });
  });

  describe("renew", () => {
    it("parses mgr:renew:<sellerId> with days", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:renew:${sellerId}:30`);
      expect(result).toEqual({ type: "renew_with_days", sellerId, days: 30 });
    });

    it("parses mgr:renew:<sellerId> without days", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:renew:${sellerId}`);
      expect(result).toEqual({ type: "renew", sellerId });
    });

    it("returns unknown for mgr:renew with no sellerId", () => {
      const result = parseManagerCallback("mgr:renew");
      expect(result).toEqual({ type: "unknown", raw: "mgr:renew" });
    });
  });

  describe("edit product price", () => {
    it("parses mgr:epprod:<productId>", () => {
      const productId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:epprod:${productId}`);
      expect(result).toEqual({ type: "edit_product_price", productId });
    });
  });

  describe("seller product detail", () => {
    it("parses mgr:prod_detail:<productId>", () => {
      const productId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:prod_detail:${productId}`);
      expect(result).toEqual({ type: "seller_product_detail", productId });
    });
  });

  describe("category detail", () => {
    it("parses mgr:cat_detail:<categoryId>", () => {
      const categoryId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:cat_detail:${categoryId}`);
      expect(result).toEqual({ type: "category_detail", categoryId });
    });
  });

  describe("ban / unban / delete", () => {
    it("parses mgr:ban:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:ban:${sellerId}`);
      expect(result).toEqual({ type: "ban", sellerId });
    });

    it("parses mgr:unban:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:unban:${sellerId}`);
      expect(result).toEqual({ type: "unban", sellerId });
    });

    it("parses mgr:delete_seller:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:delete_seller:${sellerId}`);
      expect(result).toEqual({ type: "delete_seller", sellerId });
    });
  });

  describe("recharge", () => {
    it("parses mgr:recharge:<userId>", () => {
      const userId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:recharge:${userId}`);
      expect(result).toEqual({ type: "recharge", userId });
    });
  });

  describe("confirm actions", () => {
    it("parses mgr:confirm_ban:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:confirm_ban:${sellerId}`);
      expect(result).toEqual({ type: "confirm_ban", sellerId });
    });

    it("parses mgr:confirm_unban:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:confirm_unban:${sellerId}`);
      expect(result).toEqual({ type: "confirm_unban", sellerId });
    });

    it("parses mgr:confirm_delete_seller:<sellerId>", () => {
      const sellerId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:confirm_delete_seller:${sellerId}`);
      expect(result).toEqual({ type: "confirm_delete_seller", sellerId });
    });

    it("parses mgr:confirm_recharge:<userId>:<amount>", () => {
      const userId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:confirm_recharge:${userId}:100`);
      expect(result).toEqual({ type: "confirm_recharge", userId, amount: 100 });
    });

    it("parses mgr:confirm_recharge with decimal amount", () => {
      const userId = "507f1f77bcf86cd799439011";
      const result = parseManagerCallback(`mgr:confirm_recharge:${userId}:25.5`);
      expect(result).toEqual({ type: "confirm_recharge", userId, amount: 25.5 });
    });
  });

  describe("cancel action", () => {
    it("parses mgr:cancel_action", () => {
      const result = parseManagerCallback("mgr:cancel_action");
      expect(result).toEqual({ type: "cancel_action" });
    });
  });

  describe("back navigation edge cases", () => {
    it("returns unknown for mgr:back:users: with empty sellerId", () => {
      const result = parseManagerCallback("mgr:back:users:");
      expect(result).toEqual({ type: "unknown", raw: "mgr:back:users:" });
    });

    it("returns unknown for mgr:back:products: with empty sellerId", () => {
      const result = parseManagerCallback("mgr:back:products:");
      expect(result).toEqual({ type: "unknown", raw: "mgr:back:products:" });
    });
  });

  describe("unknown callbacks", () => {
    it("returns unknown for empty string", () => {
      const result = parseManagerCallback("");
      expect(result).toEqual({ type: "unknown", raw: "" });
    });

    it("returns unknown for non-mgr prefix", () => {
      const result = parseManagerCallback("category:123");
      expect(result).toEqual({ type: "unknown", raw: "category:123" });
    });

    it("returns unknown for incomplete mgr callback", () => {
      const result = parseManagerCallback("mgr:seller");
      expect(result).toEqual({ type: "unknown", raw: "mgr:seller" });
    });

    it("returns unknown for mgr with no subcommand", () => {
      const result = parseManagerCallback("mgr");
      expect(result).toEqual({ type: "unknown", raw: "mgr" });
    });

    it("returns unknown for mgr:back with no id", () => {
      const result = parseManagerCallback("mgr:back:seller:");
      expect(result).toEqual({ type: "unknown", raw: "mgr:back:seller:" });
    });
  });

  describe("callback isolation", () => {
    it("store bot callbacks are not parsed as manager callbacks", () => {
      const storeCallbacks = [
        "menu:main",
        "menu:balance",
        "menu:products",
        "category:123",
        "product:456",
        "buy:confirm:789",
        "buy:cancel:789",
        "account:view",
        "support:view",
      ];
      for (const cb of storeCallbacks) {
        const result = parseManagerCallback(cb);
        expect(result.type).toBe("unknown");
      }
    });
  });
});
