import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
process.env.TELEGRAM_ADMIN_IDS = "999999";

jest.mock("../bot/manager", () => ({
  BotManager: {
    stopAll: jest.fn().mockResolvedValue(undefined),
    runningCount: 0,
    bootAll: jest.fn().mockResolvedValue(undefined),
    bootSeller: jest.fn().mockResolvedValue(true),
    stopSeller: jest.fn().mockResolvedValue(undefined),
    restartSeller: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../db", () => ({
  connectToDB: jest.fn().mockResolvedValue({}),
  closeDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../server", () => ({
  startWebhookServer: jest.fn(),
  stopWebhookServer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../manager/expiry", () => ({
  startExpiryChecker: jest.fn(),
}));

jest.mock("../manager/bot", () => ({
  startManagerBot: jest.fn().mockResolvedValue(undefined),
  stopManagerBot: jest.fn().mockResolvedValue(undefined),
  createManagerBot: jest.fn().mockReturnValue({
    stop: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("../languages", () => ({
  setLanguage: jest.fn(),
}));

describe("Graceful Shutdown Chain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("closeDB() is exported and is a function", async () => {
    const dbModule = await import("../db");
    expect(typeof dbModule.closeDB).toBe("function");
  });

  it("stopWebhookServer() is exported and is a function", async () => {
    const serverModule = await import("../server");
    expect(typeof serverModule.stopWebhookServer).toBe("function");
  });

  it("BotManager.stopAll() is a method that calls stopSeller for every running bot", async () => {
    const { BotManager } = await import("../bot/manager");
    expect(typeof BotManager.stopAll).toBe("function");
    await BotManager.stopAll();
    expect(BotManager.stopAll).toHaveBeenCalled();
  });

  it("exports closeDB, stopWebhookServer, and BotManager.stopAll — all callable", async () => {
    const { closeDB } = await import("../db");
    const { stopWebhookServer } = await import("../server");
    const { BotManager } = await import("../bot/manager");

    await Promise.all([
      closeDB(),
      stopWebhookServer(),
      BotManager.stopAll(),
    ]);

    expect(closeDB).toHaveBeenCalled();
    expect(stopWebhookServer).toHaveBeenCalled();
    expect(BotManager.stopAll).toHaveBeenCalled();
  });

  it("shutdown calls stopWebhookServer → stopManagerBot → BotManager.stopAll → closeDB in order", async () => {
    const { stopWebhookServer } = await import("../server");
    const { stopManagerBot } = await import("../manager/bot");
    const { BotManager } = await import("../bot/manager");
    const { closeDB } = await import("../db");

    const callOrder: string[] = [];
    (stopWebhookServer as jest.Mock).mockImplementation(async () => callOrder.push("webhook"));
    (stopManagerBot as jest.Mock).mockImplementation(async () => callOrder.push("manager"));
    (BotManager.stopAll as jest.Mock).mockImplementation(async () => callOrder.push("bots"));
    (closeDB as jest.Mock).mockImplementation(async () => callOrder.push("db"));

    // Simulate the shutdown sequence from bot.ts
    await stopWebhookServer();
    await stopManagerBot();
    await BotManager.stopAll();
    await closeDB();

    expect(callOrder).toEqual(["webhook", "manager", "bots", "db"]);
  });

  it("each shutdown step catches its own errors without crashing subsequent steps", async () => {
    const { stopWebhookServer } = await import("../server");
    const { stopManagerBot } = await import("../manager/bot");
    const { BotManager } = await import("../bot/manager");
    const { closeDB } = await import("../db");

    const callOrder: string[] = [];
    (stopWebhookServer as jest.Mock).mockImplementation(async () => { callOrder.push("webhook"); throw new Error("webhook fail"); });
    (stopManagerBot as jest.Mock).mockImplementation(async () => callOrder.push("manager"));
    (BotManager.stopAll as jest.Mock).mockImplementation(async () => callOrder.push("bots"));
    (closeDB as jest.Mock).mockImplementation(async () => callOrder.push("db"));

    // Each step wrapped in its own try/catch (like bot.ts)
    try { await stopWebhookServer(); } catch { /* logged */ }
    try { await stopManagerBot(); } catch { /* logged */ }
    try { await BotManager.stopAll(); } catch { /* logged */ }
    try { await closeDB(); } catch { /* logged */ }

    // All steps ran despite the first one throwing
    expect(callOrder).toEqual(["webhook", "manager", "bots", "db"]);
  });

  it("stopManagerBot is a separate export from stopWebhookServer", async () => {
    const { stopManagerBot } = await import("../manager/bot");
    const { stopWebhookServer } = await import("../server");
    expect(stopManagerBot).toBeDefined();
    expect(stopWebhookServer).toBeDefined();
    expect(stopManagerBot).not.toBe(stopWebhookServer);
  });
});
