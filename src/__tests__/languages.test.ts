import { t, setLanguage, getLanguage, template, Language } from "../languages";

describe("Language System", () => {
  const originalEnv = process.env.BOT_LANGUAGE;

  afterEach(() => {
    // Reset to English after each test
    setLanguage("en");
    if (originalEnv !== undefined) {
      process.env.BOT_LANGUAGE = originalEnv;
    } else {
      delete process.env.BOT_LANGUAGE;
    }
  });

  describe("t()", () => {
    it("returns English by default", () => {
      const lang = t();
      expect(lang).toBeDefined();
      expect(lang.general).toBeDefined();
      expect(lang.buttons).toBeDefined();
      expect(lang.menu).toBeDefined();
    });

    it("has all required sections", () => {
      const lang = t();
      const requiredSections = [
        "general", "buttons", "help", "start", "menu",
        "balance", "products", "buy", "support", "account",
        "admin", "preorder", "messages", "sellerKeyboard",
      ];
      for (const section of requiredSections) {
        expect(lang).toHaveProperty(section);
        expect(typeof lang[section as keyof Language]).toBe("object");
      }
    });

    it("returns the same reference for repeated calls", () => {
      const a = t();
      const b = t();
      expect(a).toBe(b);
    });

    it("has non-empty string values in each section", () => {
      const lang = t();
      for (const [section, entries] of Object.entries(lang)) {
        if (typeof entries === "object" && entries !== null) {
          for (const [key, value] of Object.entries(entries)) {
            expect(typeof value).toBe("string");
            expect((value as string).length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe("setLanguage()", () => {
    it("switches to Arabic", () => {
      setLanguage("ar");
      const lang = t();
      // Arabic strings should be different from English
      expect(lang.general.userNotFound).not.toBe("User not found. Please register first.");
    });

    it("switches to French", () => {
      setLanguage("fr");
      const lang = t();
      // French strings should be different from English
      expect(lang.general.userNotFound).not.toBe("User not found. Please register first.");
    });

    it("switches back to English", () => {
      setLanguage("ar");
      setLanguage("en");
      const lang = t();
      expect(lang.general.userNotFound).toBe("User not found. Please register first.");
    });

    it("throws for unsupported language", () => {
      expect(() => setLanguage("xyz")).toThrow("not supported");
      expect(() => setLanguage("de")).toThrow("not supported");
    });

    it("does not change language when throwing", () => {
      setLanguage("ar");
      expect(() => setLanguage("xyz")).toThrow();
      // Should still be Arabic
      const lang = t();
      expect(lang.general.userNotFound).not.toBe("User not found. Please register first.");
    });
  });

  describe("getLanguage()", () => {
    it("returns 'en' by default", () => {
      expect(getLanguage()).toBe("en");
    });

    it("returns current language after switch", () => {
      setLanguage("ar");
      expect(getLanguage()).toBe("ar");
      setLanguage("en");
      expect(getLanguage()).toBe("en");
    });
  });

  describe("English translations", () => {
    it("has correct menu button text", () => {
      const lang = t();
      expect(lang.menu.buttonBalance).toBe("Balance");
      expect(lang.menu.buttonProducts).toBe("Products");
      expect(lang.menu.buttonAccount).toBe("My Account");
      expect(lang.menu.buttonSupport).toBe("Support");
    });

    it("has correct button text", () => {
      const lang = t();
      expect(lang.buttons.confirmPurchase).toBe("Confirm Purchase");
      expect(lang.buttons.cancelPurchase).toBe("Cancel Purchase");
      expect(lang.buttons.preorderProduct).toBe("Pre-order Product");
    });

    it("has template variables in welcome message", () => {
      const lang = t();
      expect(lang.menu.welcome).toContain("${name}");
    });

    it("has template variables in balance message", () => {
      const lang = t();
      expect(lang.balance.amount).toContain("${balance}");
    });

    it("has support links", () => {
      const lang = t();
      expect(lang.support.whatsappLink).toBe("Contact via WhatsApp");
      expect(lang.support.telegramLink).toBe("Contact via Telegram");
    });
  });

  describe("Arabic translations", () => {
    it("has same structure as English", () => {
      setLanguage("ar");
      const arLang = t();
      setLanguage("en");
      const enLang = t();

      const enSections = Object.keys(enLang);
      const arSections = Object.keys(arLang);
      expect(arSections.sort()).toEqual(enSections.sort());
    });

    it("has same keys in each section", () => {
      setLanguage("ar");
      const arLang = t();
      setLanguage("en");
      const enLang = t();

      for (const section of Object.keys(enLang)) {
        const enKeys = Object.keys((enLang as any)[section]).sort();
        const arKeys = Object.keys((arLang as any)[section]).sort();
        expect(arKeys).toEqual(enKeys);
      }
    });
  });

  describe("French translations", () => {
    it("has same structure as English", () => {
      setLanguage("fr");
      const frLang = t();
      setLanguage("en");
      const enLang = t();

      const enSections = Object.keys(enLang);
      const frSections = Object.keys(frLang);
      expect(frSections.sort()).toEqual(enSections.sort());
    });

    it("has same keys in each section", () => {
      setLanguage("fr");
      const frLang = t();
      setLanguage("en");
      const enLang = t();

      for (const section of Object.keys(enLang)) {
        const enKeys = Object.keys((enLang as any)[section]).sort();
        const frKeys = Object.keys((frLang as any)[section]).sort();
        expect(frKeys).toEqual(enKeys);
      }
    });

    it("French sellerKeyboard has same keys as English", () => {
      setLanguage("fr");
      const frLang = t();
      setLanguage("en");
      const enLang = t();
      const enKeys = Object.keys(enLang.sellerKeyboard).sort();
      const frKeys = Object.keys(frLang.sellerKeyboard).sort();
      expect(frKeys).toEqual(enKeys);
    });
  });

  describe("adminPanel translations", () => {
    it("has all required admin panel keys", () => {
      const lang = t();
      const requiredKeys = [
        "welcomeTitle", "welcomeDesc", "sellersBtn", "statsBtn", "addSellerBtn",
        "cancelBtn", "backBtn", "prevBtn", "nextBtn", "sellersTitle", "sellersEmpty",
        "sellerTitle", "sellerStatus", "sellerExpires", "sellerUsersProducts",
        "usersBtn", "productsBtn", "usersTitle", "usersEmpty",
        "userTitle", "userPhone", "userTelegram", "userBalance", "userSeller", "userJoined",
        "userPurchasesTitle", "userPurchasesEmpty", "userPurchaseItem",
        "productsTitle", "productsEmpty", "productTitle", "productPrice", "productStock",
        "productCategory", "productPreorder", "productAvailable", "productSeller",
        "pageLabel", "addSellerSuccess", "renewSuccess", "statsTitle", "statsSellers",
        "statsUsers", "statsProducts", "statsBots",
        "paymentTitle", "payment30", "payment90", "payment365",
        "paymentCancelled", "paymentInvalidPlan", "paymentPlanActive",
        "paymentInvoiceTitle", "paymentInvoiceFailed",
        "mystoreTitle", "mystoreNotRegistered", "mystoreStatus", "mystoreExpires", "mystoreLink",
        "setPaymentTitle", "setPaymentExplainer", "setPaymentAwaiting",
        "setPaymentSuccess", "setPaymentInvalid", "setPaymentError", "setPaymentCleared",
        "setPaymentReuseTitle", "setPaymentReuseQuestion", "setPaymentReuseBtn", "setPaymentNewKeyBtn",
        "paymentStatusTitle", "paymentStatusActive", "paymentStatusNone",
        "setPaymentKeyBtn", "paymentStatusUpdateBtn", "paymentStatusRemoveBtn", "paymentStatusSetupBtn",
      ];
      for (const key of requiredKeys) {
        expect(lang.adminPanel).toHaveProperty(key);
        expect(typeof (lang.adminPanel as any)[key]).toBe("string");
        expect(((lang.adminPanel as any)[key] as string).length).toBeGreaterThan(0);
      }
    });
  });

  describe("sellerKeyboard translations", () => {
    it("has all required seller keyboard keys", () => {
      const lang = t();
      const requiredKeys = [
        "myStore", "myProducts", "myCategories",
        "addProduct", "addCategory", "subscription", "setPayment", "help",
      ];
      for (const key of requiredKeys) {
        expect(lang.sellerKeyboard).toHaveProperty(key);
        expect(typeof (lang.sellerKeyboard as any)[key]).toBe("string");
        expect(((lang.sellerKeyboard as any)[key] as string).length).toBeGreaterThan(0);
      }
    });

    it("Arabic sellerKeyboard has same keys as English", () => {
      setLanguage("ar");
      const arLang = t();
      setLanguage("en");
      const enLang = t();
      const enKeys = Object.keys(enLang.sellerKeyboard).sort();
      const arKeys = Object.keys(arLang.sellerKeyboard).sort();
      expect(arKeys).toEqual(enKeys);
    });

    it("French sellerKeyboard has same keys as English", () => {
      setLanguage("fr");
      const frLang = t();
      setLanguage("en");
      const enLang = t();
      const enKeys = Object.keys(enLang.sellerKeyboard).sort();
      const frKeys = Object.keys(frLang.sellerKeyboard).sort();
      expect(frKeys).toEqual(enKeys);
    });
  });

  describe("template()", () => {
    it("replaces single variable", () => {
      expect(template("Hello ${name}", { name: "World" })).toBe("Hello World");
    });

    it("replaces multiple variables", () => {
      expect(template("${a} and ${b}", { a: "X", b: "Y" })).toBe("X and Y");
    });

    it("replaces numeric values", () => {
      expect(template("Count: ${n}", { n: 42 })).toBe("Count: 42");
    });

    it("leaves unreplaced variables intact", () => {
      expect(template("Hello ${name}", {})).toBe("Hello ${name}");
    });

    it("handles empty string", () => {
      expect(template("", { a: "b" })).toBe("");
    });

    it("handles string with no variables", () => {
      expect(template("no vars here", { a: "b" })).toBe("no vars here");
    });

    it("handles multiple same variable", () => {
      expect(template("${x}${x}", { x: "a" })).toBe("aa");
    });
  });
});
