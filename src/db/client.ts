// src/db/client.ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
export function db() {
  return (_db ??= drizzle(neon(env().DATABASE_URL), { schema }));
}
export { schema };
