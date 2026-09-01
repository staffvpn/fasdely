import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseStartCommand,
  buildMiniAppDeepLink,
  parseMenuCommand,
  parseCallbackData,
  buildProductListKeyboard,
  parsePriceReplyContext,
  type ProductListEntry,
} from "./logic.ts";

async function sendMessage(botToken: string, chatId: number, text: string, replyMarkup?: unknown) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
}

async function answerCallback(botToken: string, callbackQueryId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const update = await req.json();

  // --- existing /start deep-link handling ---
  const message = update.message;
  const startParsed = parseStartCommand(message?.text);
  if (startParsed && message?.chat?.id) {
    let responseText = "Добро пожаловать в FASDELY! Откройте меню, чтобы сделать заказ.";
    if (startParsed.payload) {
      const { data: location } = await db
        .from("locations")
        .select("name, status")
        .eq("qr_token", startParsed.payload)
        .maybeSingle();
      if (location && location.status === "active") {
        responseText = `Добро пожаловать в ${location.name}! Откройте меню, чтобы сделать заказ.`;
      }
    }
    await sendMessage(botToken, message.chat.id, responseText, {
      inline_keyboard: [[{ text: "Открыть меню", web_app: { url: buildMiniAppDeepLink(botUsername, startParsed.payload) } }]],
    });
    return new Response("ok", { status: 200 });
  }

  // --- self-serve: /меню ---
  if (parseMenuCommand(message?.text) && message?.from?.id && message?.chat?.id) {
    const { data: profile } = await db
      .from("profiles")
      .select("id, role, business_id, location_id")
      .eq("telegram_user_id", message.from.id)
      .eq("status", "active")
      .maybeSingle();

    if (!profile || !["staff", "business_owner"].includes(profile.role)) {
      await sendMessage(botToken, message.chat.id, "Эта команда доступна только сотрудникам подключённого кафе.");
      return new Response("ok", { status: 200 });
    }

    let locationId = profile.location_id as string | null;
    if (!locationId) {
      // business_owner with no single location: for MVP, require exactly one location or ask them to contact FASDELY.
      const { data: locations } = await db.from("locations").select("id, name").eq("business_id", profile.business_id);
      if (!locations || locations.length !== 1) {
        await sendMessage(botToken, message.chat.id, "У вас несколько точек — выбор точки для самообслуживания пока не поддержан ботом, напишите нам напрямую.");
        return new Response("ok", { status: 200 });
      }
      locationId = locations[0].id;
    }

    const { data: products } = await db
      .from("products")
      .select("id, name, base_price, product_location_overrides!left(location_id, price_override)")
      .eq("business_id", profile.business_id)
      .eq("status", "published")
      .limit(20);

    const { data: stops } = await db
      .from("stop_list")
      .select("scope_id")
      .eq("business_id", profile.business_id)
      .eq("scope_type", "product")
      .eq("location_id", locationId)
      .is("lifted_at", null);
    const stoppedIds = new Set((stops ?? []).map((s) => s.scope_id));

    const entries: ProductListEntry[] = (products ?? []).map((p: any) => {
      const override = (p.product_location_overrides ?? []).find((o: any) => o.location_id === locationId);
      const price = override?.price_override ?? p.base_price;
      return { id: p.id, name: p.name, priceLabel: `${price} ₽`, isStopped: stoppedIds.has(p.id) };
    });

    await sendMessage(botToken, message.chat.id, "Меню вашей точки:", buildProductListKeyboard(entries));
    return new Response("ok", { status: 200 });
  }

  // --- self-serve: price reply (guest replies to the bot's "введите цену" prompt) ---
  if (message?.reply_to_message && message?.from?.id && message?.chat?.id) {
    const productId = parsePriceReplyContext(message.reply_to_message.text);
    if (productId) {
      const newPrice = Number(message.text?.replace(",", "."));
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        await sendMessage(botToken, message.chat.id, "Не понял цену. Введите число, например 320.");
        return new Response("ok", { status: 200 });
      }
      const { data: profile } = await db
        .from("profiles")
        .select("location_id")
        .eq("telegram_user_id", message.from.id)
        .eq("status", "active")
        .maybeSingle();
      const locationId = profile?.location_id;
      if (!locationId) {
        await sendMessage(botToken, message.chat.id, "Не удалось определить вашу точку.");
        return new Response("ok", { status: 200 });
      }
      const { error } = await db.rpc("staff_set_price", {
        p_telegram_user_id: message.from.id,
        p_location_id: locationId,
        p_product_id: productId,
        p_new_price: newPrice,
      });
      await sendMessage(botToken, message.chat.id, error ? `Не удалось изменить цену: ${error.message}` : `Готово, новая цена: ${newPrice} ₽.`);
      return new Response("ok", { status: 200 });
    }
  }

  // --- self-serve: callback query (stop / unstop / price button) ---
  const callback = update.callback_query;
  if (callback?.data && callback?.from?.id) {
    const parsed = parseCallbackData(callback.data);
    if (parsed) {
      const { data: profile } = await db
        .from("profiles")
        .select("location_id")
        .eq("telegram_user_id", callback.from.id)
        .eq("status", "active")
        .maybeSingle();
      const locationId = profile?.location_id;

      if (!locationId) {
        await answerCallback(botToken, callback.id, "Не удалось определить вашу точку.");
        return new Response("ok", { status: 200 });
      }

      if (parsed.action === "price") {
        await sendMessage(botToken, callback.message.chat.id, `Введите новую цену\n\n#pid:${parsed.productId}`, { force_reply: true });
        await answerCallback(botToken, callback.id);
        return new Response("ok", { status: 200 });
      }

      const { error } = await db.rpc("staff_set_stop", {
        p_telegram_user_id: callback.from.id,
        p_location_id: locationId,
        p_product_id: parsed.productId,
        p_stop: parsed.action === "stop",
      });
      await answerCallback(botToken, callback.id, error ? `Ошибка: ${error.message}` : "Готово");
      return new Response("ok", { status: 200 });
    }
  }

  return new Response("ok", { status: 200 });
});
