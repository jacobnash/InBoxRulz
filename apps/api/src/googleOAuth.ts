import { OAuth2Client } from "google-auth-library";

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string;
  expiryDate?: number;
  clientId: string;
  clientSecret: string;
  email?: string;
}

/** Injected into ApiDeps so routes/tests never depend on a live Google
 * OAuth client — mirrors how IdTokenVerifier (auth.ts) and MailConnector
 * are injected elsewhere in this app. createGoogleOAuth is the real
 * implementation; tests supply a fake buildAuthUrl/exchangeCode pair. */
export interface GoogleOAuth {
  buildAuthUrl: (state: string) => string;
  exchangeCode: (code: string) => Promise<GoogleTokenSet>;
}

// gmail.modify covers everything GmailConnector does (list, label
// create/apply, archive, trash, mark read) except permanent delete, which
// this app never does. userinfo.email is only so the callback can show
// the account's real address instead of asking the user to type it.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function createGoogleOAuth(config: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleOAuth {
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });

  return {
    buildAuthUrl: (state) =>
      client.generateAuthUrl({
        // Without both of these, Google only returns a refresh token on
        // a user's *first ever* consent for this app — offline+consent
        // forces one every time, which this flow depends on since it
        // stores the refresh token immediately.
        access_type: "offline",
        prompt: "consent",
        scope: GMAIL_SCOPES,
        state,
      }),

    exchangeCode: async (code) => {
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token || !tokens.access_token) {
        throw new Error(
          "Google did not return a refresh token — this account may have already granted consent " +
            "once before; revoke access at https://myaccount.google.com/permissions and try again.",
        );
      }

      let email: string | undefined;
      if (tokens.id_token) {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
        email = ticket.getPayload()?.email;
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ?? undefined,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        email,
      };
    },
  };
}
