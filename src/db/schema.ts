// src/db/schema.ts
import { pgTable, serial, integer, text, timestamp, boolean, bigint, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

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
  action: text("action"),          // 'trash' | 'archive' | null  (learned cleanup action)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ slugUx: uniqueIndex("memories_user_slug_ux").on(t.userId, t.slug) }));

export const seenMessages = pgTable("seen_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  messageId: text("message_id").notNull(),
  surfaced: boolean("surfaced").notNull(),
  verdict: text("verdict").notNull(),    // 'important' | 'unimportant' | 'suspicious'
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Human-readable feed of what the poll did each cycle (auto-trash/archive, flagged
// sender). Distinct from action_log (which is undo bookkeeping keyed on messageIds).
export const pollActivity = pgTable("poll_activity", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),                    // 'trashed' | 'archived' | 'flagged'
  fromAddr: text("from_addr").notNull().default(""),
  subject: text("subject").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const actionLog = pgTable("action_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  runId: text("run_id").notNull(),
  messageIds: jsonb("message_ids").$type<string[]>().notNull(),
  action: text("action").notNull().default("trash"),  // 'trash' | 'archive'
  undone: boolean("undone").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
