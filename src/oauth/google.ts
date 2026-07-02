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

export async function ensureBootstrapUser(): Promise<number> {
  const [user] = await db().select().from(schema.users).limit(1);
  return user?.id ?? (await db().insert(schema.users).values({}).returning())[0]!.id;
}

export async function exchangeAndStore(env: Env, code: string, userId: number): Promise<{ email: string }> {
  const client = oauthClient(env);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("no refresh_token (re-consent with prompt=consent)");
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new Error("could not resolve account email from gmail profile");
  const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
  const existing = await db().select().from(schema.googleAccounts).where(eq(schema.googleAccounts.userId, userId)).limit(1);
  if (existing[0]) {
    await db().update(schema.googleAccounts)
      .set({ encRefreshToken: enc, email, needsReconnect: false, updatedAt: new Date() })
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
  // Google occasionally rotates the refresh token; persist the new one so it never goes stale.
  client.on("tokens", (tokens) => {
    if (!tokens.refresh_token) return;
    const enc = encryptSecret(tokens.refresh_token, env.TOKEN_ENC_KEY);
    void db().update(schema.googleAccounts).set({ encRefreshToken: enc, updatedAt: new Date() })
      .where(eq(schema.googleAccounts.id, acct.id))
      .catch((e) => console.error("failed to persist rotated refresh token", e));
  });
  return client;
}
