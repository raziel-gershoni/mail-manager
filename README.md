# mail-manager

Gmail-to-Telegram notification bot. Polls Gmail history, classifies emails with Gemini, and surfaces important messages via Telegram with inline action buttons.

## One-time setup

1. Neon: create DB, set DATABASE_URL. Run `npm run db:generate && npm run db:migrate`.
2. Google Cloud: create OAuth client (Web), add redirect https://<app>/api/oauth/callback,
   enable Gmail API, add the gmail.modify scope, and PUBLISH the consent screen to
   "In production" (unverified is fine for one user) so the refresh token does not expire.
3. Generate TOKEN_ENC_KEY: `openssl rand -base64 32`.
4. Telegram: create a bot via @BotFather, get TELEGRAM_BOT_TOKEN; get your numeric id
   (TELEGRAM_OWNER_ID) from @userinfobot; pick a random TELEGRAM_WEBHOOK_SECRET.
5. Upstash: create QStash, copy QSTASH_TOKEN + both signing keys.
6. Set all env vars in Vercel (including SETUP_SECRET — pick a random string) and deploy.
   Migrations auto-apply on deploy via the `vercel-build` script (`tsc --noEmit && drizzle-kit migrate`,
   typechecked first so a type error fails fast before touching the database);
   this requires DATABASE_URL to be set as a Production env var (Vercel exposes it at build time)
   with build-time network access to Neon. A failed migration or type error blocks the deploy.
   `drizzle-kit migrate` is idempotent, so re-deploys are safe.
7. After the first deploy (and whenever APP_BASE_URL changes), run once:
   `curl -X POST https://<app>/api/setup -H 'Authorization: Bearer <SETUP_SECRET>'`
   This idempotently creates the 30-min QStash poll schedule (→ /api/poll) and registers the
   Telegram webhook (→ /api/telegram). Safe to re-run.
   Re-running `/api/setup` is idempotent (it skips an already-existing poll schedule), but avoid
   firing it concurrently — two overlapping calls could each create the schedule before either
   sees it. Run it once, sequentially.

## Verify

- [ ] Visit https://<app>/api/oauth/callback flow via the auth URL (log it from buildAuthUrl); see "Connected <email>".
- [ ] Run `npm run db:migrate` to apply the conversations + messages migration before deploying.
- [ ] Run `npm run db:migrate` for the proposals/action_log migration (cleanup flow).
- [ ] Manually trigger the QStash schedule once → first run sets the cursor, no Telegram message.
- [ ] Send yourself a new email → trigger the schedule → receive a natural-language brief (not a button list).
- [ ] Message the bot in plain language ("what's new?", "anything from the bank?", "linkedin is never important"); confirm it replies conversationally, that `search`/`read` answer inbox questions, and that a stated preference shows up next time.
- [ ] Confirm the 30-min poll posts a natural-language brief (not a button list).
- [ ] Send a Telegram message from a different account → bot ignores it (allowlist).
- [ ] Cleanup flow: message 'clean my linkedin junk' → the bot proposes a vetted set and asks before trashing; approve → it trashes (recoverable); 'undo' → it restores; confirm nothing trashes without your approval.

## Environment variables

| Variable | Description |
|---|---|
| DATABASE_URL | Neon PostgreSQL connection string |
| TOKEN_ENC_KEY | 32-byte base64 key for encrypting OAuth refresh tokens |
| GOOGLE_CLIENT_ID | Google OAuth2 client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth2 client secret |
| GOOGLE_REDIRECT_URI | OAuth redirect URI (https://<app>/api/oauth/callback) |
| GEMINI_API_KEY | Google Gemini API key |
| TELEGRAM_BOT_TOKEN | Telegram bot token from @BotFather |
| TELEGRAM_OWNER_ID | Your numeric Telegram user ID |
| TELEGRAM_WEBHOOK_SECRET | Random secret for webhook verification |
| QSTASH_TOKEN | Upstash QStash publish token |
| QSTASH_CURRENT_SIGNING_KEY | QStash current signing key |
| QSTASH_NEXT_SIGNING_KEY | QStash next signing key |
| APP_BASE_URL | Deployed Vercel app URL (https://<app>.vercel.app) |
| SETUP_SECRET | Random secret to authorize POST /api/setup (required only for /api/setup; optional elsewhere) |

## Development

```bash
npm install
npm test          # run unit tests (no live services needed)
npm run typecheck # TypeScript check
```
