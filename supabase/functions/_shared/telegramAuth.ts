export interface TelegramInitDataResult {
  valid: boolean;
  reason?: "missing_hash" | "bad_signature" | "expired" | "bad_user_payload";
  data?: Record<string, string>;
  user?: { id: number; first_name?: string; username?: string };
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): Promise<TelegramInitDataResult> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing_hash" };
  params.delete("hash");

  const data: Record<string, string> = {};
  const pairs: string[] = [];
  for (const key of Array.from(params.keys()).sort()) {
    const value = params.get(key)!;
    data[key] = value;
    pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const computedHex = toHex(await hmacSha256(secretKey, dataCheckString));

  if (computedHex !== hash) {
    return { valid: false, reason: "bad_signature" };
  }

  const authDate = Number(data["auth_date"]);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { valid: false, reason: "expired" };
  }

  let user: TelegramInitDataResult["user"];
  if (data["user"]) {
    try {
      const parsed = JSON.parse(data["user"]);
      user = { id: parsed.id, first_name: parsed.first_name, username: parsed.username };
    } catch {
      return { valid: false, reason: "bad_user_payload" };
    }
  }

  return { valid: true, data, user };
}
