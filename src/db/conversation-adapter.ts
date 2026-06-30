import { asc, eq } from "drizzle-orm";
import { db, schema } from "./client.js";
import type { ConversationRepo, ConversationState, Turn, Role } from "../conversation/store.js";

const WINDOW_ROWS = 40;

export function dbConversationRepo(): ConversationRepo {
  return {
    async load(userId): Promise<ConversationState> {
      const [conv] = await db().select().from(schema.conversations).where(eq(schema.conversations.userId, userId)).limit(1);
      const rows = await db().select().from(schema.messages)
        .where(eq(schema.messages.userId, userId)).orderBy(asc(schema.messages.createdAt));
      const window: Turn[] = rows.slice(-WINDOW_ROWS).map(r => ({ role: r.role as Role, content: r.content, toolNote: r.toolNote }));
      return { summary: conv?.runningSummary ?? "", window };
    },
    async appendTurn(userId, turn) {
      await db().insert(schema.conversations).values({ userId, runningSummary: "" }).onConflictDoNothing({ target: schema.conversations.userId });
      await db().insert(schema.messages).values({ userId, role: turn.role, content: turn.content, toolNote: turn.toolNote ?? "" });
    },
    async replaceState(userId, state) {
      await db().insert(schema.conversations).values({ userId, runningSummary: state.summary })
        .onConflictDoUpdate({ target: schema.conversations.userId, set: { runningSummary: state.summary, updatedAt: new Date() } });
      // window trimming is best-effort; raw rows are retained for audit, load() re-windows by WINDOW_ROWS.
    },
  };
}
