# Mail Manager

> An AI "Gmail secretary" that watches your inbox, decides what actually matters, and talks to you about it in plain language over Telegram.

![Next.js](https://img.shields.io/badge/Next.js_15-000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-8e75b2?style=flat-square&logo=googlegemini&logoColor=white)
![Drizzle](https://img.shields.io/badge/Drizzle_ORM-c5f74f?style=flat-square&logo=drizzle&logoColor=black)
![Neon Postgres](https://img.shields.io/badge/Neon_Postgres-00e599?style=flat-square&logo=postgresql&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6e9f18?style=flat-square&logo=vitest&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?style=flat-square&logo=vercel&logoColor=white)
[![demo · live](https://img.shields.io/badge/demo-live-2ea043?style=flat-square&logo=vercel&logoColor=white)](https://mail-manager-eight.vercel.app)

**🔗 Live demo:** https://mail-manager-eight.vercel.app  <!-- access is Telegram-bot based and owner-provisioned; the landing page is public but the assistant runs inside a Telegram chat -->

Mail Manager polls each linked Gmail account on a schedule, classifies incoming mail with learned rules and a Gemini pass, and sends a natural-language brief to Telegram — surfacing only what genuinely matters while routine mail flows into an activity log. You talk to it like a person ("what's new?", "clean my LinkedIn junk", "LinkedIn is never important") and an agentic tool-use loop searches and reads your mail, learns your preferences, and performs guarded, fully recoverable cleanup that always asks before it deletes.

<!-- Screenshot placeholder: leave exactly this HTML comment so the owner can drop an image in later:
     ![screenshot](docs/screenshot.png) -->

## ✨ Features
- **Scheduled inbox triage.** Every hour the bot syncs new mail via Gmail's history API, decides what is important, and delivers a written brief to Telegram — important mail notifies, routine mail goes to an activity log instead of pinging you.
- **Conversational control.** Ask questions and give instructions in plain language; the assistant searches, reads, and reasons over your inbox and replies conversationally rather than dumping a wall of buttons.
- **Learns your preferences.** Tell it "the bank is always important" or "crypto pitches are noise" and it remembers — as sender/domain rules or topic-based standing preferences that shape future triage.
- **Guarded, recoverable cleanup.** Ask it to clean a category and it proposes a vetted set and waits for your approval before trashing or archiving. Every destructive action is logged and reversible with a simple "undo."
- **Multi-user.** The owner provisions additional users with per-user OAuth consent URLs; each gets their own linked account, rules, and schedule.
- **Telegram Mini App** for settings — language, timezone, **active hours** and **active days**.
- **Bilingual.** Full English and Hebrew support, including right-to-left rendering.

## 🏗️ How it works

**Agentic tool-use loop with a wall-clock budget.** The heart of the app (`src/agent/loop.ts`) runs the LLM in a plan → call-tools → observe loop over a set of Gmail and memory tools. Because it executes inside Vercel's serverless worker with a hard ~60s cap, the loop is budgeted against the wall clock: it stops *planning* after `AGENT_BUDGET_MS` (45s), then forces exactly one bounded final-answer call so the owner always gets a reply instead of a silent timeout. Individual model calls race against a timeout sentinel, and even a thrown error falls through to the forced-final path — the owner is never left hanging. Everything the loop logs passes through a log-safe projection that keeps who/what plus a short preview and never dumps full message bodies or secrets.

**Structural defense against prompt injection.** The assistant reads untrusted content — the emails themselves — so a hostile message could try to talk the model into changing your standing preferences. That attack is closed off *structurally*, not with prompting alone. Standing preferences use a propose → confirm barrier scoped to a single owner turn: `propose_preference` can only ever write an inert `pending` row, and `confirm_preference` refuses any key proposed in the same turn and **fails closed** if the turn barrier isn't present. Making a preference live requires a separate, genuine owner turn — so no matter what an email says, a single injected turn can at most leave a dead pending row behind.

**Cleanup that biases toward keeping mail.** Destructive actions run through a guard (`src/cleanup/guard.ts`) that reads each candidate's full body and judges keep-vs-trash with a keep-on-uncertainty default; non-bulk and transactional mail is kept without even consulting the LLM. Body reads are capped per call, and overflow is reported rather than acted on, so nothing is ever trashed unread. Trash and archive are proposed to the owner, applied only on approval, recorded in an `action_log`, and reversible via undo.

**Classification: cheap rules first, LLM second.** For each new message (`src/notifier/classify.ts`) an explicit sender/domain rule always wins; only unruled mail reaches the Gemini importance pass, and an LLM error fails safe by treating the message as important-and-suspicious rather than silently dropping it.

**Correct, idempotent sync.** Polling captures Gmail's head history id *once* before listing so the cursor can't race past mail arriving mid-poll, and the cursor is only advanced after the brief is actually delivered — a failed send leaves the cursor un-advanced so the same mail is retried, never lost. The hourly brief runs only on your active days within your active hours, and the first run back catches up on everything that arrived in between. If a catch-up can't finish within one run, it briefs what it covered, ends with a ⚠️ warning, and continues at the next check, newest mail first — and if Gmail's history has expired in the meantime, it restarts from now and says so. Telegram updates are processed at most once per update id, and QStash deliveries are signature-verified before any work runs.

**Security throughout.** OAuth refresh tokens are encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`). The Telegram webhook is gated by a shared secret, and Mini App requests are authenticated by recomputing Telegram's `initData` HMAC and comparing with `timingSafeEqual` (`src/telegram/initdata.ts`). Google access is limited to the `gmail.modify` scope.

## 📎 Attachments & weekly reports

**Attachments: seen everywhere, read when it matters.** Every email's files — names, types and sizes — feed the importance check and both cleanup reviewers as one compact line (`invoice.pdf (PDF, 120 KB), contract.docx (Word, 45 KB) + 3 images`); images under 20 KB are dropped as noise, while large inline infographics count. Contents are read only for mail already judged important, so the brief can summarize them, or when you ask in chat ("what does the invoice say?"). PDFs, images (PNG, JPEG, WebP, HEIC) and text/CSV files can be read; anything else is listed as "can't open". Reads are capped at 7 files and 20 MB per email (documents first, then images largest first) and 10 files per brief, and each extract is bounded — 3,000 characters per file in the brief, 20,000 for one file asked about in chat, otherwise 35,000 shared — with Gemini asked for no more than that. File names and contents are untrusted data: summarized, never obeyed, never saved or forwarded.

**Weekly spam check: nothing leaves Spam without you.** On the first hourly check of each week — Sunday morning, or your first active hour of the week — the bot reviews the last 7 days of Spam (up to 300 emails) and reports what looks like real mail: a person, an order, a bill, an account notice. A sender you have a rule for is always listed, but still checked for phishing, since forged senders land in Spam; anything that looks like phishing is marked and needs your explicit OK. Reply "rescue 1 3" or "rescue all" (only the listed items) and it moves them to the inbox and teaches Gmail they aren't spam — undoable like any cleanup. The report buzzes only when there's something to look at.

**Weekly retrospect: a second look at what the bot did.** Right after the spam check comes the week in review: what was trashed, archived, rescued and undone, the top senders, and new or changed rules. The bot re-reads what it trashed or archived and lists anything that was plausibly a mistake under "⚠️ Worth a look" — it stays read-only until you reply "restore 1" or "restore all". An 🛠 Ops section lists the week's operational issues: an unfinished catch-up, an expired Gmail cursor, a needed reconnect, a failed hourly check, chat reply or weekly report. Both reports are marked done only once they're sent: a run that fails (a Gemini outage included) retries the next hour, up to 3 times a week, then tells you it couldn't — a week is never closed silently. Sender, subject and reason text is defanged (`paypa1[.]com`, `a[at]b[.]com`) so nothing in a report can be tapped.

## 🛠️ Tech stack
**Frontend:** Next.js 15 (App Router), React 19 — public landing page and a Telegram Mini App for settings, with English/Hebrew i18n and RTL.
**Backend / API:** Next.js route handlers on Vercel serverless; grammY for the Telegram bot.
**Data:** Neon Postgres via Drizzle ORM (migrations with drizzle-kit).
**AI:** Google Gemini via `@google/genai` for classification and the agentic tool loop.
**Email:** Gmail API (`googleapis`, `gmail.modify`) with cursor-based history sync.
**Infra:** Upstash QStash for the scheduled poll cron and signed job delivery; Vercel for hosting and deploy-time migrations.

## 🚀 Getting started

### Prerequisites
- Node.js >= 20
- A Neon Postgres database
- A Google Cloud OAuth client (Web) with the Gmail API enabled and the `gmail.modify` scope
- A Telegram bot (via @BotFather) and your numeric Telegram user id
- An Upstash QStash project
- A Google Gemini API key

### Environment variables
Copy `.env.example` and fill in your own values. **Never commit real secrets.**

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `TOKEN_ENC_KEY` | 32-byte base64 key for encrypting OAuth refresh tokens (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI (`https://<app>/api/oauth/callback`) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_OWNER_ID` | Your numeric Telegram user id |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret used to verify the Telegram webhook |
| `QSTASH_TOKEN` | Upstash QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key |
| `QSTASH_NEXT_SIGNING_KEY` | QStash next signing key |
| `QSTASH_URL` | Optional — region-specific QStash endpoint; omit to use the default |
| `APP_BASE_URL` | Deployed app base URL (`https://<app>`) |
| `SETUP_SECRET` | Random secret authorizing `POST /api/setup` |
| `OWNER_TZ` | Optional — IANA timezone for the agent's sense of "today"; defaults to UTC |

### Install & run
```bash
npm install

# generate SQL migrations from the schema, then apply them to your database
npm run db:generate
npm run db:migrate

# run locally
npm run dev

# production build / start
npm run build
npm start

# typecheck
npm run typecheck
```

After the first deploy (and whenever `APP_BASE_URL` or the poll cadence changes), run once to create the QStash poll schedule and register the Telegram webhook — both operations are idempotent, and the schedule step re-creates the cron if it has drifted from `POLL_CRON`:
```bash
curl -X POST https://<app>/api/setup -H 'Authorization: Bearer <SETUP_SECRET>'
```

## 🧪 Testing
Tested with **Vitest** — 87 test files spanning the agent loop, cleanup guard, classification, sync/idempotency, crypto, OAuth, Telegram/Mini App auth, database adapters, and i18n (roughly a 1:1 test-to-source ratio). No live services are required.

```bash
npm test          # run the full suite once
npm run test:watch
```

## 📦 Deployment
Deploys to **Vercel**. The `vercel-build` script runs Drizzle migrations before building, so schema changes ship with the deploy and a failed migration blocks it. The recurring inbox poll runs as an **Upstash QStash** cron (hourly, on the hour) that hits the app's poll endpoint with a signature-verified request.

## 📄 License
Shared publicly as a portfolio project.
