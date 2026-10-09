jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("../db", () => ({ connectToDB: jest.fn() }));
jest.mock("../bot/manager", () => ({
  BotManager: {
    getBotForMessage: jest.fn(),
    getPrimaryBot: jest.fn(),
  },
}));

describe("Admin ID Validation — Fail-Fast", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.mock("dotenv", () => ({ config: jest.fn() }));
    jest.mock("../db", () => ({ connectToDB: jest.fn() }));
    jest.mock("../bot/manager", () => ({
      BotManager: {
        getBotForMessage: jest.fn(),
        getPrimaryBot: jest.fn(),
      },
    }));
    process.env = { ...originalEnv };
    delete process.env.TELEGRAM_ADMIN_IDS;
    delete process.env.TELEGRAM_ADMIN_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws at module load when no admin ID env vars are set", () => {
    expect(() => {
      require("../helpers/adminNotificationHelper");
    }).toThrow("Admin ID not configured — set TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_ID in .env");
  });

  it("does not throw when TELEGRAM_ADMIN_IDS is set", () => {
    process.env.TELEGRAM_ADMIN_IDS = "123456789";

    expect(() => {
      require("../helpers/adminNotificationHelper");
    }).not.toThrow();
  });

  it("does not throw when TELEGRAM_ADMIN_ID is set", () => {
    process.env.TELEGRAM_ADMIN_ID = "987654321";

    expect(() => {
      require("../helpers/adminNotificationHelper");
    }).not.toThrow();
  });

  it("throws when TELEGRAM_ADMIN_IDS contains only non-numeric values", () => {
    process.env.TELEGRAM_ADMIN_IDS = "not_a_number,also_not";

    expect(() => {
      require("../helpers/adminNotificationHelper");
    }).toThrow("Admin ID not configured — set TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_ID in .env");
  });

  it("throws when TELEGRAM_ADMIN_IDS is empty string", () => {
    process.env.TELEGRAM_ADMIN_IDS = "";

    expect(() => {
      require("../helpers/adminNotificationHelper");
    }).toThrow("Admin ID not configured — set TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_ID in .env");
  });
});
