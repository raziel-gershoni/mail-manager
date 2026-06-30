import { Client, Receiver } from "@upstash/qstash";
import type { Env } from "../config/env.js";

export function buildDestination(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + path;
}

export async function enqueue(env: Env, path: "/api/worker", body: unknown): Promise<void> {
  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.publishJSON({ url: buildDestination(env.APP_BASE_URL, path), body });
}

export async function verifyQStash(env: Env, req: Request): Promise<unknown> {
  const signature = req.headers.get("upstash-signature") ?? "";
  const bodyText = await req.text();
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  const valid = await receiver.verify({ signature, body: bodyText });
  if (!valid) throw new Error("invalid qstash signature");
  return bodyText ? JSON.parse(bodyText) : {};
}
