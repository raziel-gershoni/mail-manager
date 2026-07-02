import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../../src/telegram/initdata.js";

const TOKEN = "123456:test-bot-token";
const NOW = new Date("2026-07-02T12:00:00Z");

// Build a valid initData string the same way Telegram does (independent of the impl's code).
function makeInitData(fields: Record<string, string>, token: string): string {
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const authDate = String(Math.floor(NOW.getTime() / 1000));
const userField = JSON.stringify({ id: 555, first_name: "O" });

describe("verifyInitData", () => {
  it("accepts a valid signature and extracts the telegram user id", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField, query_id: "q1" }, TOKEN);
    expect(verifyInitData(initData, TOKEN, NOW)).toEqual({ telegramUserId: 555 });
  });
  it("rejects a tampered field (hash no longer matches)", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField }, TOKEN);
    const tampered = initData.replace("555", "999"); // changes user, not hash
    expect(verifyInitData(tampered, TOKEN, NOW)).toBeNull();
  });
  it("rejects a signature made with a different bot token", () => {
    const initData = makeInitData({ auth_date: authDate, user: userField }, "999999:other-token");
    expect(verifyInitData(initData, TOKEN, NOW)).toBeNull();
  });
  it("rejects stale initData (auth_date older than 15 min)", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 16 * 60);
    const initData = makeInitData({ auth_date: old, user: userField }, TOKEN);
    expect(verifyInitData(initData, TOKEN, NOW)).toBeNull();
  });
  it("rejects missing hash / missing user / empty input", () => {
    expect(verifyInitData("", TOKEN, NOW)).toBeNull();
    expect(verifyInitData(new URLSearchParams({ auth_date: authDate, user: userField }).toString(), TOKEN, NOW)).toBeNull(); // no hash
    const noUser = makeInitData({ auth_date: authDate }, TOKEN);
    expect(verifyInitData(noUser, TOKEN, NOW)).toBeNull();
  });
});
