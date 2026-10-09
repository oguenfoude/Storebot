import http from "http";

jest.mock("../db", () => ({
  connectToDB: jest.fn().mockResolvedValue({
    collection: jest.fn(),
    command: jest.fn().mockResolvedValue({ ok: 1 }),
  }),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    restartSeller: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../helpers/logger", () => {
  const mkLogger: any = () => {
    const logger: any = jest.fn();
    logger.child = jest.fn().mockImplementation(() => mkLogger());
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
    logger.fatal = jest.fn();
    return logger;
  };
  return { __esModule: true, default: mkLogger() };
});

const TEST_PORT = 3999;
let server: http.Server | null = null;

function startTestServer(deleteSecret = false): Promise<number> {
  return new Promise((resolve) => {
    process.env.WEBHOOK_PORT = String(TEST_PORT);
    const { startWebhookServer } = require("../server");
    // dotenv.config() inside server.ts may have re-loaded NOWPAYMENTS_IPN_SECRET
    // from .env; delete it AFTER require so the request-time check sees it missing.
    if (deleteSecret) delete process.env.NOWPAYMENTS_IPN_SECRET;
    startWebhookServer();
    // wait for the server to start
    setTimeout(() => resolve(TEST_PORT), 500);
  });
}

function stopTestServer(): Promise<void> {
  const { stopWebhookServer } = require("../server");
  return stopWebhookServer();
}

function postIPN(payload: string, signature?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: TEST_PORT,
        path: "/api/webhook/nowpayments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "x-nowpayments-sig": signature } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function getURL(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "localhost", port: TEST_PORT, path, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("IPN Webhook Rejection — Real HTTP Server", () => {
  const originalEnv = process.env;

  describe("IPN secret not configured", () => {
    beforeAll(async () => {
      process.env = { ...originalEnv };
      delete process.env.NOWPAYMENTS_IPN_SECRET;
      delete process.env.WEBHOOK_PORT;
      process.env.API_KEY_ENCRYPTION_SECRET = "test-secret";
      jest.resetModules();
      await startTestServer(true);
    });

    afterAll(async () => {
      await stopTestServer();
      process.env = originalEnv;
    });

    it("rejects with 501 when secret is missing", async () => {
      const res = await postIPN('{"id":123,"status":"finished"}', "any_sig");
      expect(res.status).toBe(501);
      expect(JSON.parse(res.body)).toEqual({ error: "IPN not configured" });
    });
  });

  describe("IPN secret configured", () => {
    beforeAll(async () => {
      process.env = { ...originalEnv };
      process.env.NOWPAYMENTS_IPN_SECRET = "test_ipn_secret";
      process.env.API_KEY_ENCRYPTION_SECRET = "test-secret";
      delete process.env.WEBHOOK_PORT;
      jest.resetModules();
      await startTestServer();
    });

    afterAll(async () => {
      await stopTestServer();
      process.env = originalEnv;
    });

    it("rejects with 401 when signature is missing", async () => {
      const res = await postIPN('{"id":123,"status":"finished"}');
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: "Missing signature" });
    });

    it("rejects with 401 when signature is invalid", async () => {
      const res = await postIPN('{"id":123,"status":"finished"}', "invalid_signature");
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: "Invalid signature" });
    });
  });

  describe("Server health check and 404", () => {
    beforeAll(async () => {
      process.env = { ...originalEnv };
      process.env.API_KEY_ENCRYPTION_SECRET = "test-secret";
      process.env.NOWPAYMENTS_IPN_SECRET = "test_secret";
      delete process.env.WEBHOOK_PORT;
      jest.resetModules();
      await startTestServer();
    });

    afterAll(async () => {
      await stopTestServer();
      process.env = originalEnv;
    });

    it("GET /health returns 200 with status object", async () => {
      const res = await getURL("/health");
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
      expect(body.checks).toBeDefined();
      expect(body.checks.mongodb).toBeDefined();
      expect(body.checks.ipnSecret).toBeDefined();
    });

    it("GET /unknown returns 404", async () => {
      const res = await getURL("/nonexistent");
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: "Not found" });
    });
  });
});
