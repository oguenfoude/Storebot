import { GrammyError } from "grammy";

import { isTokenFatal } from "../bot/manager";

function makeGrammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    `Call to 'getMe' failed!`,
    { ok: false, error_code: code, description, parameters: {} },
    "getMe",
    {}
  );
}

describe("Token Validation — Real isTokenFatal from BotManager", () => {
  it("returns true for 401 Unauthorized", () => {
    expect(isTokenFatal(makeGrammyError(401, "Unauthorized"))).toBe(true);
  });

  it("returns false for 409 Conflict", () => {
    expect(isTokenFatal(makeGrammyError(409, "Conflict: terminated by other getUpdates request"))).toBe(false);
  });

  it("returns false for 429 Too Many Requests", () => {
    expect(isTokenFatal(makeGrammyError(429, "Too Many Requests: retry after 30"))).toBe(false);
  });

  it("returns false for 500 Internal Server Error", () => {
    expect(isTokenFatal(makeGrammyError(500, "Internal Server Error"))).toBe(false);
  });

  it("returns false for plain Error objects", () => {
    expect(isTokenFatal(new Error("ECONNREFUSED"))).toBe(false);
    expect(isTokenFatal(new Error("fetch failed"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isTokenFatal(null)).toBe(false);
    expect(isTokenFatal(undefined)).toBe(false);
  });

  it("returns false for 403 Forbidden (bot can't be started by user)", () => {
    expect(isTokenFatal(makeGrammyError(403, "Forbidden: bot was blocked"))).toBe(false);
  });

  it("returns true only for 401 — non-401 codes pass through as non-fatal", () => {
    const fatalCodes = [401];
    const nonFatalCodes = [400, 403, 404, 409, 429, 500, 503];
    for (const code of nonFatalCodes) {
      expect(isTokenFatal(makeGrammyError(code, "some error"))).toBe(false);
    }
    expect(isTokenFatal(makeGrammyError(fatalCodes[0], "Unauthorized"))).toBe(true);
  });
});
