interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  themeParams?: Record<string, string>;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  ready(): void;
  expand(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp {
  const app = window.Telegram?.WebApp;
  if (!app) throw new Error("Telegram WebApp SDK not available — this page must be opened inside Telegram");
  return app;
}

export function getInitData(): string {
  return webApp().initData;
}

export function getStartParam(): string | null {
  return webApp().initDataUnsafe.start_param ?? null;
}

let currentBackHandler: (() => void) | null = null;

export function onBackButtonClick(handler: () => void): void {
  const app = webApp();
  if (currentBackHandler) app.BackButton.offClick(currentBackHandler);
  app.BackButton.onClick(handler);
  currentBackHandler = handler;
}

export function showBackButton(): void {
  webApp().BackButton.show();
}

export function hideBackButton(): void {
  webApp().BackButton.hide();
}

export function ready(): void {
  webApp().ready();
}

export function expand(): void {
  webApp().expand();
}

export function parseThemeParams(raw: Record<string, string> | undefined): { bg: string; text: string } | null {
  if (!raw || !raw.bg_color || !raw.text_color) return null;
  return { bg: raw.bg_color, text: raw.text_color };
}
