import { describe, it, expect } from "vitest";
import { verifyTelegramInitData } from "./telegramAuth.ts";

const BOT_TOKEN = "123456:TEST-token-for-fixture-only";
// Generated once with Node's crypto module, following Telegram's documented
// WebApp initData algorithm: secret_key = HMAC_SHA256(key="WebAppData",
// data=bot_token); hash = HMAC_SHA256(key=secret_key, data=data_check_string).
const VALID_INIT_DATA =
  "auth_date=1700000000&query_id=AAHdF6IAAAAA0y9C7A&" +
  "user=%7B%22id%22%3A987654321%2C%22first_name%22%3A%22Ivan%22%2C%22username%22%3A%22ivan_test%22%7D&" +
  "hash=2dae458d5431f46aca7623a1aaa122afb0727c704542dccadd759ddb5296eddf";

describe("verifyTelegramInitData", () => {
  it("accepts a validly signed payload when freshness is not a concern", async () => {
    const result = await verifyTelegramInitData(VALID_INIT_DATA, BOT_TOKEN, Number.MAX_SAFE_INTEGER);
    expect(result.valid).toBe(true);
    expect(result.user?.id).toBe(987654321);
    expect(result.user?.username).toBe("ivan_test");
  });

  it("rejects the same payload as expired under the default max age", async () => {
    const result = await verifyTelegramInitData(VALID_INIT_DATA, BOT_TOKEN);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects a tampered field", async () => {
    const tampered = VALID_INIT_DATA.replace("ivan_test", "mallory");
    const result = await verifyTelegramInitData(tampered, BOT_TOKEN, Number.MAX_SAFE_INTEGER);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a payload with no hash", async () => {
    const noHash = "auth_date=1700000000&query_id=x";
    const result = await verifyTelegramInitData(noHash, BOT_TOKEN);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_hash");
  });
});
