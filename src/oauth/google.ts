// src/oauth/google.ts
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { Env } from "../config/env.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export function oauthClient(env: Env): OAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function buildAuthUrl(env: Env, state: string): string {
  return oauthClient(env).generateAuthUrl({
    access_type: "offline", prompt: "consent", scope: [SCOPE], state,
  });
}

export async function exchangeAndStore(env: Env, code: string): Promise<{ email: string }> {
  const client = oauthClient(env);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("no refresh_token (re-consent with prompt=consent)");
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email!;
  // single-user bootstrap: ensure a user row id=1 exists, then store the account
  const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
  const [user] = await db().select().from(schema.users).limit(1);
  const userId = user?.id ?? (await db().insert(schema.users).values({}).returning())[0]!.id;
  const existing = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (existing[0]) {
    await db().update(schema.googleAccounts).set({ encRefreshToken: enc, email, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, existing[0].id));
  } else {
    await db().insert(schema.googleAccounts).values({ userId, email, encRefreshToken: enc, scope: SCOPE });
  }
  return { email };
}

export async function authedGmailFor(userId: number, env: Env): Promise<OAuth2Client> {
  const [acct] = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (!acct) throw new Error("no google account linked");
  const client = oauthClient(env);
  client.setCredentials({ refresh_token: decryptSecret(acct.encRefreshToken, env.TOKEN_ENC_KEY) });
  return client;
}
