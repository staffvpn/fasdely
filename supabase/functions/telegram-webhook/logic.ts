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
