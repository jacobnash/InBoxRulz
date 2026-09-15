import pino, { type Logger, type LoggerOptions } from "pino";
import type { Writable } from "node:stream";

/**
 * Paths pino/fast-redact will censor wherever they appear in a logged
 * object, one level deep from the redaction root (fast-redact's wildcard
 * doesn't recurse arbitrarily, so both the bare field and its common
 * nesting under `meta`/`req.headers` are listed explicitly). Nothing that
 * matches these should ever reach stdout in the clear — spec section 9:
 * credentials are never logged in plaintext, and a bearer token is exactly
 * as sensitive as the credentials it authorizes access to.
 */
const REDACT_PATHS = [
  "credentials",
  "encryptedCredentials",
  "accessToken",
  "refreshToken",
  "password",
  "meta.credentials",
  "meta.encryptedCredentials",
  "meta.accessToken",
  "meta.refreshToken",
  "meta.password",
  "req.headers.authorization",
  "req.headers.cookie",
];

export interface CreateLoggerOptions {
  /** Overrides the destination stream — used by tests to capture output
   * instead of writing to real stdout. Defaults to process.stdout. */
  stream?: Writable;
  level?: string;
}

/** A structured-JSON-to-stdout logger, one per service. Every process in
 * this repo (apps/api, apps/worker) uses this instead of `console.*` so
 * logs are machine-parseable and safe to redirect straight into whatever
 * log collector a deployment points at stdout (spec section 9 / the
 * SOC2-readiness gap: no audit trail was the actual production gap, not
 * the collector — this makes "point a collector at stdout" sufficient). */
export function createLogger(service: string, options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.stream ? pino(pinoOptions, options.stream) : pino(pinoOptions);
}
