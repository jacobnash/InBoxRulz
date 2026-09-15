import { OAuth2Client } from "google-auth-library";
import { decryptCredentials, type ConnectedAccountRecord } from "@inboxrulz/db";
import { GmailConnector, type MailConnector } from "@inboxrulz/mail-connector";

interface GmailCredentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiryDate?: number;
}

/**
 * Builds the right MailConnector for a connected account, decrypting its
 * credentials just for this call — nothing is cached or logged in
 * plaintext (spec section 9).
 *
 * Only Gmail is wired up today (spec build order item 1: "prove the
 * multi-provider abstraction early" with Gmail first). Outlook and IMAP
 * accounts are already representable in the data model and the
 * MailConnector interface; adding their adapters is the next slice of
 * work, not a redesign.
 */
export function createConnectorForAccount(
  account: ConnectedAccountRecord,
  masterKey?: string,
): MailConnector {
  switch (account.provider) {
    case "gmail": {
      const creds: GmailCredentials = JSON.parse(
        decryptCredentials(account.encryptedCredentials, masterKey),
      );
      const auth = new OAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret });
      auth.setCredentials({
        access_token: creds.accessToken,
        refresh_token: creds.refreshToken,
        expiry_date: creds.expiryDate,
      });
      return new GmailConnector({ auth });
    }
    case "outlook":
    case "icloud":
    case "fastmail":
    case "zoho":
    case "imap":
      throw new Error(
        `No MailConnector implementation for provider "${account.provider}" yet — Gmail is the only one wired up so far.`,
      );
  }
}
