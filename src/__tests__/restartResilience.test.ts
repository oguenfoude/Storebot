import { ObjectId } from "mongodb";
import { GrammyError } from "grammy";
import { Seller } from "../models/seller";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
process.env.TELEGRAM_ADMIN_IDS = "999999";

const mockDbCollection = jest.fn();

jest.mock("../db", () => ({
  connectToDB: jest.fn().mockResolvedValue({ collection: mockDbCollection }),
}));

jest.mock("../bot/handlers", () => ({
  attachHandlers: jest.fn(),
}));

jest.mock("../languages", () => ({
  t: jest.fn().mockReturnValue({
    adminPanel: {
      tokenInvalidNotify: "Your bot token for \"${username}\" has been revoked.",
    },
  }),
  template: jest.fn((str: string, vars: Record<string, string>) => {
    let r = str;
    for (const [k, v] of Object.entries(vars)) r = r.replace(`\${${k}}`, v);
    return r;
  }),
}));

jest.mock("../helpers/logger", () => ({
  __esModule: true,
  default: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      fatal: jest.fn(),
    }),
  },
}));

// Mock the grammY Bot class
const mockBotInstances: any[] = [];
jest.mock("grammy", () => {
  const actual = jest.requireActual("grammy");
  return {
    ...actual,
    Bot: jest.fn().mockImplementation((token: string) => {
      const bot: any = {
        token,
        api: {
          getMe: jest.fn().mockResolvedValue({ id: 123, is_bot: true, first_name: "Bot", username: "testbot" }),
          sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
        },
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        catch: jest.fn(),
      };
      mockBotInstances.push(bot);
      return bot;
    }),
  };
});

import { BotManager } from "../bot/manager";
import { connectToDB } from "../db";
import { attachHandlers } from "../bot/handlers";

function makeSeller(overrides: Partial<Seller> = {}): Seller {
  return {
    _id: new ObjectId(),
    telegramId: "123456789",
    botToken: "fake:token1234567890123456789012345678",
    botUsername: "TestBot",
    status: "active",
    maxProducts: 3,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("Restart Resilience — Real BotManager", () => {
  let mockSellersCollection: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBotInstances.length = 0;

    mockSellersCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      findOne: jest.fn(),
    };
    mockDbCollection.mockReturnValue(mockSellersCollection);

    (connectToDB as jest.Mock).mockResolvedValue({ collection: mockDbCollection });
  });

  afterEach(async () => {
    await BotManager.stopAll();
    mockBotInstances.length = 0;
  });

  it("bootAll loads active and trial sellers from DB", async () => {
    const seller1 = makeSeller({ _id: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), status: "active" });
    const seller2 = makeSeller({ _id: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"), status: "trial" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([seller1, seller2]) });

    await BotManager.bootAll();

    expect(mockSellersCollection.find).toHaveBeenCalledWith({ status: { $in: ["active", "trial"] } });
    expect(BotManager.runningCount).toBe(2);
    expect(BotManager.getBot("aaaaaaaaaaaaaaaaaaaaaaaa")).toBeTruthy();
    expect(BotManager.getBot("bbbbbbbbbbbbbbbbbbbbbbbb")).toBeTruthy();
  });

  it("skips sellers without _id or botToken", async () => {
    const badSeller = makeSeller({ _id: undefined, botToken: "" });
    const goodSeller = makeSeller({ _id: new ObjectId("cccccccccccccccccccccccc"), botUsername: "GoodBot" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([badSeller, goodSeller]) });

    await BotManager.bootAll();

    expect(BotManager.runningCount).toBe(1);
    expect(BotManager.getBot("cccccccccccccccccccccccc")).toBeTruthy();
  });

  it("handles empty seller list gracefully (primaryBot stays null)", async () => {
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    await BotManager.bootAll();

    expect(BotManager.runningCount).toBe(0);
    expect(BotManager.getPrimaryBot()).toBeNull();
  });

  it("does not double-boot an already running seller", async () => {
    const seller = makeSeller({ _id: new ObjectId("dddddddddddddddddddddddd"), botUsername: "TestBot" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([seller]) });

    await BotManager.bootAll();
    expect(BotManager.runningCount).toBe(1);

    // Second boot attempt — mock returns the same seller
    await BotManager.bootAll();
    expect(BotManager.runningCount).toBe(1);
    expect(mockBotInstances.length).toBe(1);
  });

  it("stopSeller removes from map and stops the bot", async () => {
    const seller = makeSeller({ _id: new ObjectId("eeeeeeeeeeeeeeeeeeeeeeee"), botUsername: "StopBot" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([seller]) });

    await BotManager.bootAll();
    expect(BotManager.runningCount).toBe(1);

    await BotManager.stopSeller("eeeeeeeeeeeeeeeeeeeeeeee");
    expect(BotManager.runningCount).toBe(0);
    expect(mockBotInstances[0].stop).toHaveBeenCalled();
  });

  it("restartSeller stops then reboots", async () => {
    const seller = makeSeller({ _id: new ObjectId("ffffffffffffffffffffffff"), botUsername: "RestartBot" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([seller]) });

    await BotManager.bootAll();
    expect(BotManager.runningCount).toBe(1);

    await BotManager.restartSeller(seller);
    expect(BotManager.runningCount).toBe(1);
    expect(BotManager.getBot("ffffffffffffffffffffffff")).toBeTruthy();
  });

  it("bootSeller with revoked token marks seller token_invalid", async () => {
    const seller = makeSeller({ _id: new ObjectId("111111111111111111111111"), botToken: "revoked:token", botUsername: "RevokedBot" });

    // Make getMe throw 401 for this token
    const testBot = mockBotInstances[mockBotInstances.length - 1];
    // getMe is mocked on each instance. We need to override for the revoked one.
    mockBotInstances.length = 0; // reset

    // Re-create bot with getMe throwing 401
    (jest.requireMock("grammy").Bot as jest.Mock).mockImplementationOnce((token: string) => {
      const bot: any = {
        token,
        api: {
          getMe: jest.fn().mockRejectedValue(
            new GrammyError(
              `Call to 'getMe' failed!`,
              { ok: false, error_code: 401, description: "Unauthorized", parameters: {} },
              "getMe",
              {}
            )
          ),
          sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
        },
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        catch: jest.fn(),
      };
      return bot;
    });

    const result = await BotManager.bootSeller(seller);
    expect(result).toBe(false);
    expect(mockSellersCollection.updateOne).toHaveBeenCalledWith(
      { _id: seller._id },
      { $set: { status: "token_invalid" } }
    );
  });

  it("isolation: stopping one seller does not affect others", async () => {
    const sellers = [
      makeSeller({ _id: new ObjectId("222222222222222222222222"), botUsername: "S1" }),
      makeSeller({ _id: new ObjectId("333333333333333333333333"), botUsername: "S2" }),
      makeSeller({ _id: new ObjectId("444444444444444444444444"), botUsername: "S3" }),
    ];
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue(sellers) });

    await BotManager.bootAll();
    expect(BotManager.runningCount).toBe(3);

    await BotManager.stopSeller("333333333333333333333333");
    expect(BotManager.runningCount).toBe(2);
    expect(BotManager.getBot("222222222222222222222222")).toBeTruthy();
    expect(BotManager.getBot("444444444444444444444444")).toBeTruthy();
    expect(BotManager.getBot("333333333333333333333333")).toBeUndefined();
  });

  it("attachHandlers is called for each booted seller", async () => {
    const seller = makeSeller({ _id: new ObjectId("555555555555555555555555"), botUsername: "HandlerBot" });
    mockSellersCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([seller]) });

    (attachHandlers as jest.Mock).mockClear();
    await BotManager.bootAll();
    expect(attachHandlers).toHaveBeenCalledTimes(1);
    expect(attachHandlers).toHaveBeenCalledWith(expect.anything(), seller._id);
  });
});
