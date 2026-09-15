import { readFileSync } from "node:fs";

/**
 * Reads a secret from the environment, supporting both a plain `<NAME>`
 * env var and the Docker/Compose "secrets" file convention (`<NAME>_FILE`
 * pointing at a file whose contents are the secret).
 *
 * Why this matters on a VPS/self-managed host with no cloud secrets
 * manager or KMS: a plain env var is readable by anything that can see
 * `/proc/<pid>/environ` or run `docker inspect`; a file mounted via
 * Docker/Swarm secrets (or just a chmod-600 file outside the image) is
 * not. Supporting both means a deployment can upgrade how it handles
 * secrets without any code change — swap `CREDENTIALS_ENCRYPTION_KEY` for
 * `CREDENTIALS_ENCRYPTION_KEY_FILE` in the environment, nothing else moves.
 */
export function readSecret(name: string): string | undefined {
  const fileVar = `${name}_FILE`;
  const filePath = process.env[fileVar];
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch (err) {
      throw new Error(`${fileVar} points at "${filePath}", which could not be read: ${String(err)}`);
    }
  }
  const value = process.env[name];
  return value ? value.trim() || undefined : undefined;
}

/** Same as `readSecret`, but fails fast with an actionable message instead
 * of letting a missing secret surface as a confusing error deep inside
 * whatever consumes it later (e.g. a cryptic AES key-length error). */
export function requireSecret(name: string): string {
  const value = readSecret(name);
  if (!value) {
    throw new Error(
      `Missing required secret "${name}". Set the ${name} environment variable, or ${name}_FILE ` +
        `to point at a file containing it (Docker/Compose secrets convention).`,
    );
  }
  return value;
}
