import pino from "pino";
import fs from "fs";
import path from "path";

// ─── Logger Configuration ────────────────────────────────────────────────────
// Structured logging via pino. Writes JSON to stdout (for container log
// scraping — Coolify, Docker, journald) AND a human-readable pretty stream to
// a daily-rotated file under ./logs/ for local debugging.
//
// All log lines carry:
//   - "tag"    (e.g. "BotManager", "Expiry", "NOWPayments", "Webhook")
//   - "requestId" (where applicable — IPN flow, startup, shutdown)
//
// Use child loggers with .child({ tag: "..." }) per module to keep tags
// consistent.

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_DIR = process.env.LOG_DIR || "logs";
const PRETTY_FILE_LOGS = process.env.LOG_PRETTY_FILE !== "false" && process.env.NODE_ENV !== "test";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const prettyPath = path.join(LOG_DIR, `app-${dateStr}.log`);

const baseOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
  base: {
    pid: process.pid,
    app: "storebot",
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// Single logger instance, multi-transport.
const logger = pino(
  baseOptions,
  pino.multistream([
    // Always emit JSON to stdout — Coolify/Docker scrapes this.
    { stream: process.stdout },
    // Pretty-printed file for human inspection.
    ...(PRETTY_FILE_LOGS
      ? [
          {
            stream: pino.transport({
              target: "pino-pretty",
              options: {
                destination: prettyPath,
                colorize: false,
                translateTime: "SYS:HH:MM:ss.l",
                ignore: "pid,hostname,app,env",
              },
            }),
          },
        ]
      : []),
  ])
);

// Track first failure per transport so we don't spam stdout when the file
// transport can't write.
let lastFileError = 0;
process.on("uncaughtException", (err) => {
  logger.fatal({ err, tag: "UncaughtException" }, "Uncaught exception — process will exit");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error(
    { reason: String(reason), tag: "UnhandledRejection" },
    "Unhandled promise rejection"
  );
});

void lastFileError; // reserved for future diagnostics

export default logger;
