import { describe, expect, it, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSecret, requireSecret } from "../src/secrets.js";

const ENV_VAR = "TEST_SECRET_XYZ";

afterEach(() => {
  delete process.env[ENV_VAR];
  delete process.env[`${ENV_VAR}_FILE`];
});

describe("readSecret", () => {
  it("returns undefined when neither form is set", () => {
    expect(readSecret(ENV_VAR)).toBeUndefined();
  });

  it("reads a plain env var", () => {
    process.env[ENV_VAR] = "plain-value";
    expect(readSecret(ENV_VAR)).toBe("plain-value");
  });

  it("prefers the _FILE convention over a plain env var when both are set", () => {
    const path = join(tmpdir(), `secret-${Date.now()}.txt`);
    writeFileSync(path, "file-value\n");
    process.env[ENV_VAR] = "plain-value";
    process.env[`${ENV_VAR}_FILE`] = path;
    try {
      expect(readSecret(ENV_VAR)).toBe("file-value");
    } finally {
      unlinkSync(path);
    }
  });

  it("throws a clear error when the _FILE path doesn't exist", () => {
    process.env[`${ENV_VAR}_FILE`] = "/no/such/file";
    expect(() => readSecret(ENV_VAR)).toThrow(/could not be read/);
  });
});

describe("requireSecret", () => {
  it("returns the value when set", () => {
    process.env[ENV_VAR] = "value";
    expect(requireSecret(ENV_VAR)).toBe("value");
  });

  it("throws an actionable error when unset", () => {
    expect(() => requireSecret(ENV_VAR)).toThrow(/Missing required secret "TEST_SECRET_XYZ"/);
  });
});
