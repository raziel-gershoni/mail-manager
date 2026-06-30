// src/db/schema.ts
import { pgTable, serial, integer, text, timestamp, boolean, bigint, uniqueIndex } from "drizzle-orm/pg-core";

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const telegramLinks = pgTable("telegram_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
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
