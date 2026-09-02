import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseStartCommand,
  buildMiniAppDeepLink,
  parseMenuCommand,
  parseCallbackData,
  buildProductListKeyboard,
  parsePriceReplyContext,
  isSelfServeRole,
  isGenuineBotPromptReply,
  staffErrorMessage,
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

async function editMessageReplyMarkup(botToken: string, chatId: number, messageId: number, replyMarkup: unknown) {
  await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup }),
  });
}

// Shared product-list-entry loader for a business+location: used both to render the
// initial /меню keyboard and to rebuild the keyboard after a stop/unstop toggle, so
// both flows always reflect the same current stopped-state.
async function fetchProductListEntries(db: any, businessId: string, locationId: string): Promise<ProductListEntry[]> {
  const { data: products } = await db
    .from("products")
    .select("id, name, base_price, product_location_overrides!left(location_id, price_override)")
    .eq("business_id", businessId)
    .eq("status", "published")
    .limit(20);

  const { data: stops } = await db
    .from("stop_list")
    .select("scope_id")
    .eq("business_id", businessId)
    .eq("scope_type", "product")
    .eq("location_id", locationId)
    .is("lifted_at", null);
  const stoppedIds = new Set((stops ?? []).map((s: any) => s.scope_id));

  return (products ?? []).map((p: any) => {
    const override = (p.product_location_overrides ?? []).find((o: any) => o.location_id === locationId);
    const price = override?.price_override ?? p.base_price;
    return { id: p.id, name: p.name, priceLabel: `${price} ₽`, isStopped: stoppedIds.has(p.id) };
  });
}

// Shared self-serve location resolution: use the staff member's own location_id if set;
// otherwise (business_owner with no single location assigned) fall back to the business's
// locations and auto-resolve only when there is exactly one. Used by all three self-serve
// entry points (/меню, callback-query, price-reply) so behavior is consistent everywhere a
// location_id is needed — a staff/owner account that resolves in one flow must resolve the
// same way in the others.
async function resolveLocationId(db: any, businessId: string, profileLocationId: string | null): Promise<string | null> {
  if (profileLocationId) return profileLocationId;
  const { data: locations } = await db.from("locations").select("id").eq("business_id", businessId);
  if (!locations || locations.length !== 1) return null;
  return locations[0].id;
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

    if (!profile || !isSelfServeRole(profile.role)) {
      await sendMessage(botToken, message.chat.id, "Эта команда доступна только сотрудникам подключённого кафе.");
      return new Response("ok", { status: 200 });
    }

    const locationId = await resolveLocationId(db, profile.business_id, profile.location_id);
    if (!locationId) {
      // business_owner with no single location: for MVP, require exactly one location or ask them to contact FASDELY.
      await sendMessage(botToken, message.chat.id, "У вас несколько точек — выбор точки для самообслуживания пока не поддержан ботом, напишите нам напрямую.");
      return new Response("ok", { status: 200 });
    }

    const entries = await fetchProductListEntries(db, profile.business_id, locationId);

    await sendMessage(botToken, message.chat.id, "Меню вашей точки:", buildProductListKeyboard(entries));
    return new Response("ok", { status: 200 });
  }

  // --- self-serve: price reply (staff replies to the bot's own "введите цену" prompt) ---
  if (message?.reply_to_message && message?.from?.id && message?.chat?.id) {
    const productId = parsePriceReplyContext(message.reply_to_message.text);
    if (productId && isGenuineBotPromptReply(message.reply_to_message)) {
      const rawPrice = message.text?.trim();
      const newPrice = rawPrice ? Number(rawPrice.replace(",", ".")) : NaN;
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        await sendMessage(botToken, message.chat.id, "Не понял цену. Введите число, например 320.");
        return new Response("ok", { status: 200 });
      }
      const { data: profile } = await db
        .from("profiles")
        .select("role, business_id, location_id")
        .eq("telegram_user_id", message.from.id)
        .eq("status", "active")
        .maybeSingle();

      if (!profile || !isSelfServeRole(profile.role)) {
        await sendMessage(botToken, message.chat.id, "Эта команда доступна только сотрудникам подключённого кафе.");
        return new Response("ok", { status: 200 });
      }

      const locationId = await resolveLocationId(db, profile.business_id, profile.location_id);
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
      await sendMessage(botToken, message.chat.id, error ? staffErrorMessage(error.message) : `Готово, новая цена: ${newPrice} ₽.`);
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
        .select("role, business_id, location_id")
        .eq("telegram_user_id", callback.from.id)
        .eq("status", "active")
        .maybeSingle();

      if (!profile || !isSelfServeRole(profile.role)) {
        await answerCallback(botToken, callback.id, "Эта команда доступна только сотрудникам подключённого кафе.");
        return new Response("ok", { status: 200 });
      }

      const locationId = await resolveLocationId(db, profile.business_id, profile.location_id);
      if (!locationId) {
        await answerCallback(botToken, callback.id, "Не удалось определить вашу точку.");
        return new Response("ok", { status: 200 });
      }

      if (parsed.action === "price") {
        if (!callback.message?.chat.id) return new Response("ok", { status: 200 });
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

      if (!error && callback.message?.chat.id && callback.message?.message_id) {
        const entries = await fetchProductListEntries(db, profile.business_id, locationId);
        await editMessageReplyMarkup(botToken, callback.message.chat.id, callback.message.message_id, buildProductListKeyboard(entries));
      }

      await answerCallback(botToken, callback.id, error ? staffErrorMessage(error.message) : "Готово");
      return new Response("ok", { status: 200 });
    }
  }

  return new Response("ok", { status: 200 });
});
