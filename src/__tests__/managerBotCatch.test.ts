import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
process.env.TELEGRAM_ADMIN_IDS = "999999";

jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../helpers/logger", () => {
  const mkLogger = (): any => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockImplementation(() => mkLogger()),
  });
  return { __esModule: true, default: mkLogger() };
});

describe("Manager Bot — bot.catch() Handler", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("createManagerBot() attaches bot.catch() when token is set", async () => {
    process.env.MANAGER_BOT_TOKEN = "test:token-abcd-efgh-ijkl-mnop-qrstuvwxy";
    jest.resetModules();

    const catchSpy = jest.fn();
    const mockBotInstance: any = {
      catch: catchSpy,
      start: jest.fn(),
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    };

    jest.doMock("grammy", () => ({
      Bot: jest.fn().mockImplementation(() => mockBotInstance),
    }));
    jest.doMock("../manager/handlers", () => ({
      attachManagerHandlers: jest.fn(),
    }));
    jest.doMock("fs", () => ({
      appendFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
    }));

    const { createManagerBot } = await import("../manager/bot");
    const bot = createManagerBot();
    expect(bot).not.toBeNull();
    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it("createManagerBot returns null when MANAGER_BOT_TOKEN is unset", async () => {
    const prev = process.env.MANAGER_BOT_TOKEN;
    delete process.env.MANAGER_BOT_TOKEN;
    jest.resetModules();

    jest.doMock("fs", () => ({
      appendFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
    }));

    const { createManagerBot } = await import("../manager/bot");
    expect(createManagerBot()).toBeNull();

    if (prev !== undefined) process.env.MANAGER_BOT_TOKEN = prev;
  });
});

describe("Manager Bot Lifecycle — startManagerBot / stopManagerBot", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
    process.env.TELEGRAM_ADMIN_IDS = "999999";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("startManagerBot does nothing when token is unset", async () => {
    delete process.env.MANAGER_BOT_TOKEN;

    const mockBot: any = {
      catch: jest.fn(),
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock("grammy", () => ({
      Bot: jest.fn().mockImplementation(() => mockBot),
    }));
    jest.doMock("../manager/handlers", () => ({
      attachManagerHandlers: jest.fn(),
    }));
    jest.doMock("fs", () => ({
      appendFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
    }));

    const { startManagerBot } = await import("../manager/bot");
    await startManagerBot();

    // Bot should NOT have been started since no token
    expect(mockBot.start).not.toHaveBeenCalled();
  });

  it("startManagerBot calls bot.start() when token is set", async () => {
    process.env.MANAGER_BOT_TOKEN = "test:token-1234-5678-9012-3456-7890abcd";

    const startMock = jest.fn().mockResolvedValue(undefined);
    const catchSpy = jest.fn();
    const mockBot: any = {
      catch: catchSpy,
      start: startMock,
      stop: jest.fn().mockResolvedValue(undefined),
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    };

    jest.doMock("grammy", () => ({
      Bot: jest.fn().mockImplementation(() => mockBot),
    }));
    jest.doMock("../manager/handlers", () => ({
      attachManagerHandlers: jest.fn(),
    }));
    jest.doMock("fs", () => ({
      appendFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
    }));

    const { startManagerBot } = await import("../manager/bot");
    await startManagerBot();

    expect(startMock).toHaveBeenCalled();
    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it("stopManagerBot does nothing when no bot is running", async () => {
    process.env.MANAGER_BOT_TOKEN = "test:token-1234-5678-9012-3456-7890abcd";

    const stopMock = jest.fn().mockResolvedValue(undefined);
    const mockBot: any = {
      catch: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: stopMock,
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    };

    jest.doMock("grammy", () => ({
      Bot: jest.fn().mockImplementation(() => mockBot),
    }));
    jest.doMock("../manager/handlers", () => ({
      attachManagerHandlers: jest.fn(),
    }));
    jest.doMock("fs", () => ({
      appendFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
    }));

    const { stopManagerBot } = await import("../manager/bot");
    await stopManagerBot(); // No bot started, should be a no-op

    expect(stopMock).not.toHaveBeenCalled();
  });
});
