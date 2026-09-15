import type { ConnectedAccountRecord } from "@inboxrulz/db";

/** Never serialize `encryptedCredentials` back to a client, sealed or not —
 * there's no reason a dashboard response needs it (spec section 9). */
export function serializeAccount(account: ConnectedAccountRecord) {
  const { encryptedCredentials: _encryptedCredentials, ...rest } = account;
  return rest;
}
