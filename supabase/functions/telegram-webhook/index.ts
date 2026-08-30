import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseStartCommand, buildMiniAppDeepLink } from "./logic.ts";

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();
  const message = update.message;
  const parsed = parseStartCommand(message?.text);

  if (parsed && message?.chat?.id) {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME")!;
    let responseText = "Добро пожаловать в FASDELY! Откройте меню, чтобы сделать заказ.";

    if (parsed.payload) {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: location } = await db
        .from("locations")
        .select("name, status")
        .eq("qr_token", parsed.payload)
        .maybeSingle();
      if (location && location.status === "active") {
        responseText = `Добро пожаловать в ${location.name}! Откройте меню, чтобы сделать заказ.`;
      }
    }

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: responseText,
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть меню", web_app: { url: buildMiniAppDeepLink(botUsername, parsed.payload) } }]],
        },
      }),
    });
  }

  return new Response("ok", { status: 200 });
});
