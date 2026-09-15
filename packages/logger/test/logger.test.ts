import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../src/logger.js";
import { auditLog } from "../src/audit.js";

function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines: () => lines.map((l) => JSON.parse(l)) };
}

describe("createLogger", () => {
  it("emits JSON lines tagged with the service name", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger("test-service", { stream });
    logger.info("hello");
    const [entry] = lines();
    expect(entry.service).toBe("test-service");
    expect(entry.msg).toBe("hello");
  });

  it("redacts credentials, tokens, and passwords wherever they appear", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger("test-service", { stream });
    logger.info({
      credentials: { accessToken: "top-secret" },
      accessToken: "raw-token",
      refreshToken: "raw-refresh",
      password: "hunter2",
      meta: { accessToken: "nested-token", password: "nested-pw" },
      req: { headers: { authorization: "Bearer secret-jwt", cookie: "session=abc" } },
    });
    const [entry] = lines();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-refresh");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("nested-token");
    expect(serialized).not.toContain("nested-pw");
    expect(serialized).not.toContain("secret-jwt");
    expect(serialized).not.toContain("session=abc");
    expect(entry.credentials).toBe("[REDACTED]");
    expect(entry.accessToken).toBe("[REDACTED]");
  });

  it("defaults to info level and honors an explicit level", () => {
    const { stream } = captureStream();
    const logger = createLogger("test-service", { stream, level: "warn" });
    expect(logger.level).toBe("warn");
  });
});

describe("auditLog", () => {
  it("writes a structured audit record", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger("test-service", { stream });
    auditLog(logger, {
      action: "account.connected",
      actorUserId: "user-1",
      resourceType: "connected_account",
      resourceId: "acct-1",
      outcome: "success",
    });
    const [entry] = lines();
    expect(entry.audit).toBe(true);
    expect(entry.action).toBe("account.connected");
    expect(entry.actorUserId).toBe("user-1");
    expect(entry.outcome).toBe("success");
    expect(entry.msg).toBe("audit: account.connected");
  });

  it("never leaks a credential passed through meta", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger("test-service", { stream });
    auditLog(logger, {
      action: "auth.failed",
      outcome: "failure",
      meta: { reason: "expired token", accessToken: "should-not-appear" },
    });
    const serialized = JSON.stringify(lines()[0]);
    expect(serialized).not.toContain("should-not-appear");
  });
});
