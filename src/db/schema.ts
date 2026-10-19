// src/db/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, boolean, bigint, uniqueIndex, index, jsonb, primaryKey } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const googleAccounts = pgTable("google_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  encRefreshToken: text("enc_refresh_token").notNull(),
  scope: text("scope").notNull(),
  needsReconnect: boolean("needs_reconnect").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const telegramLinks = pgTable("telegram_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
}, (t) => ({ tgUserUx: uniqueIndex("telegram_links_tg_user_ux").on(t.telegramUserId) }));

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),   // null → fall back to createdAt + OAUTH_STATE_TTL_MS
});

export const userSettings = pgTable("user_settings", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  timezone: text("timezone"),                                  // null → fall back to OWNER_TZ / UTC
  digestStartHour: integer("digest_start_hour").notNull().default(0),
  digestEndHour: integer("digest_end_hour").notNull().default(24),   // 0–24 = always-on
  paused: boolean("paused").notNull().default(false),
  activeDays: integer("active_days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'::integer[]`), // 0 = Sunday … 6 = Saturday
  language: text("language"),                                  // null → "en"
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  description: text("description").notNull(),
  body: text("body").notNull().default(""),
  scope: text("scope").notNull(), // 'sender' | 'domain' | 'global'
  matchType: text("match_type"),  // 'sender' | 'domain' | null
  matchValue: text("match_value"),
  verdict: text("verdict"),        // 'important' | 'unimportant' | null
  action: text("action"),          // 'trash' | 'archive' | 'review' | 'review_archive' | 'keep' | null (learned cleanup action)
  pending: boolean("pending").notNull().default(false), // standing preferences start inert until the owner confirms
  // First insert. A re-upsert never touches it (only updated_at), so the weekly retrospect
  // can tell a new rule from a changed one. Pre-0018 rows were backfilled from updated_at.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ slugUx: uniqueIndex("memories_user_slug_ux").on(t.userId, t.slug) }));

export const seenMessages = pgTable("seen_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  messageId: text("message_id").notNull(),
  surfaced: boolean("surfaced").notNull(),
  verdict: text("verdict").notNull(),    // 'important' | 'unimportant' | 'suspicious' | 'skipped' (gone/self-sent)
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ msgUx: uniqueIndex("seen_user_msg_ux").on(t.userId, t.messageId) }));

export const syncState = pgTable("sync_state", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  lastHistoryId: text("last_history_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  runningSummary: text("running_summary").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),        // 'user' | 'assistant' | 'brief'
  content: text("content").notNull(),
  toolNote: text("tool_note").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  messageIds: jsonb("message_ids").$type<string[]>().notNull(),
  summary: text("summary").notNull().default(""),
  status: text("status").notNull().default("pending"), // 'pending' | 'confirmed' | 'expired'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const processedUpdates = pgTable("processed_updates", {
  updateId: text("update_id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(), // when the CURRENT attempt claimed it
  // Null while a worker is still running. Set once the turn finished, which seals
  // the update forever: a late duplicate must never re-answer or re-act. Without
  // this, the stale-claim takeover would also expire real duplicate protection.
  completedAt: timestamp("completed_at"),
});

// Couples a sent digest (Telegram message id) to the exact Gmail messages it was
// about, so a reply to that digest resolves to precise ids (no LLM guessing).
export const messageRefs = pgTable("message_refs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }).notNull(),
  refs: jsonb("refs").$type<{ id: string; from: string; subject: string; kind: string }[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ msgUx: uniqueIndex("message_refs_user_msg_ux").on(t.userId, t.telegramMessageId) }));

// Human-readable feed of what the poll did each cycle (auto-trash/archive, flagged
// sender). Distinct from action_log (which is undo bookkeeping keyed on messageIds).
export const pollActivity = pgTable("poll_activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),                    // 'trashed' | 'archived' | 'flagged'
  fromAddr: text("from_addr").notNull().default(""),
  subject: text("subject").notNull().default(""),
  messageId: text("message_id"),                       // Gmail id of a trashed/archived message; null for flagged rows and rows before 0018
  source: text("source"),                              // why: 'guarded' | 'plain' | 'pref' | 'chat'; null for flagged rows and rows before 0018
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const actionLog = pgTable("action_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  runId: text("run_id").notNull(),
  messageIds: jsonb("message_ids").$type<string[]>().notNull(),
  action: text("action").notNull().default("trash"),  // 'trash' | 'archive' | 'unspam'
  undone: boolean("undone").notNull().default(false),
  undoneAt: timestamp("undone_at"),                    // set by undo_last; null if never undone (or undone before this column existed)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// The weekly jobs' bookkeeping: per user and job, the week key ("YYYY-MM-DD" of that
// week's Sunday in the user's timezone) of the last report actually SENT. Its own table,
// not user_settings, so settings literals and their tests stay untouched.
export const weeklyRuns = pgTable("weekly_runs", {
  userId: integer("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),                                        // 'spam' | 'retro'
  week: text("week").notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(), // when that report was sent
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.kind] }) }));

// Operational issues for the weekly retrospect (see src/ops/events.ts). Written only
// through recordOpsEvent, which never throws; pruned to 30 days by the retrospect run.
export const opsEvents = pgTable("ops_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),                                // 'poll_incomplete' | 'cursor_expired' | 'reconnect_needed' | 'poll_errored' | 'worker_failed'
  detail: jsonb("detail").$type<Record<string, unknown>>(),   // small context (counts, an error message); null when there is none
  at: timestamp("at").defaultNow().notNull(),
}, (t) => ({ userAtIx: index("ops_events_user_at_ix").on(t.userId, t.at) }));
