export interface ParsedStartCommand {
  command: "start";
  payload: string;
}

export function parseStartCommand(text: string | undefined): ParsedStartCommand | null {
  if (!text) return null;
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text.trim());
  if (!match) return null;
  return { command: "start", payload: match[1] ?? "" };
}

export function buildMiniAppDeepLink(botUsername: string, locationQrToken: string): string {
  return `https://t.me/${botUsername}/app?startapp=${encodeURIComponent(locationQrToken)}`;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export function parseMenuCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/меню(?:@\w+)?$/.test(text.trim());
}

export interface ParsedCallbackData {
  action: "stop" | "unstop" | "price";
  productId: string;
}

export function parseCallbackData(data: string): ParsedCallbackData | null {
  const match = /^(stop|unstop|price):(.+)$/.exec(data);
  if (!match) return null;
  return { action: match[1] as ParsedCallbackData["action"], productId: match[2] };
}

export interface ProductListEntry {
  id: string;
  name: string;
  priceLabel: string;
  isStopped: boolean;
}

export function buildProductListKeyboard(products: ProductListEntry[]): TelegramInlineKeyboard {
  return {
    inline_keyboard: products.map((p) => [
      { text: `${p.name} — ${p.priceLabel}`, callback_data: `price:${p.id}` },
      {
        text: p.isStopped ? "Включить" : "Стоп",
        callback_data: p.isStopped ? `unstop:${p.id}` : `stop:${p.id}`,
      },
    ]),
  };
}

export function parsePriceReplyContext(replyToText: string | undefined): string | null {
  if (!replyToText) return null;
  const match = /#pid:(\S+)/.exec(replyToText);
  return match ? match[1] : null;
}
