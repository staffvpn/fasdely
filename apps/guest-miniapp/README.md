# FASDELY Guest Mini App

Telegram Mini App for guest ordering. Part of FASDELY sub-project 2.
Design: `docs/superpowers/specs/2026-08-31-guest-miniapp-design.md`.

## Development

npm install
npm run dev    # local dev server (Telegram SDK calls will throw outside Telegram — expected)
npm test       # vitest
npm run build  # production build to dist/

## Deployment

Deploy `dist/` to Cloudflare Pages (connect this repo, build command `npm run build` with base
directory `apps/guest-miniapp`, output directory `dist`).

## Manual End-to-End Checklist (required before this sub-project is done)

No automated UI test replaces real Telegram testing — the design spec is explicit about this.
Before considering sub-project 2 complete, verify inside a real Telegram client:

- [ ] QR/direct link opens the Mini App to the correct location's menu (not a different café's)
- [ ] Product detail → add to cart → cart shows the item with working +/- and remove
- [ ] Checkout: dine-in/takeaway toggle, ASAP works, comment is preserved into the order
- [ ] Order placement succeeds, confirmation screen shows the real order number and total
- [ ] Tracking screen polls and reflects a status change made via `update-order-status` (test by
      changing the order's status directly, e.g. through Supabase, while the tracking screen is open)
- [ ] Cancel button appears only while cancellable, disappears once preparing
- [ ] Telegram `BackButton` correctly steps back through every screen, never skips or dead-ends
- [ ] Bot `/меню` (as a seeded staff/owner account) lists the location's products with working
      stop/unstop and price-edit buttons; verify the resulting `audit_log` row has the real actor
- [ ] Every error condition in the design spec's Error Handling table produces its documented message,
      not a blank screen or raw error code

## Manual Secrets/Setup Steps (carried over from Backend Foundation, still pending)

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` must be set to real
  values in Supabase Edge Function secrets (currently placeholders).
- Webhook must be registered with Telegram's `setWebhook` API.
- The Mini App's launch URL must be configured in @BotFather to point at the deployed
  Cloudflare Pages URL.
- A FASDELY operator must set `profiles.telegram_user_id` for each staff/owner account that
  should have self-serve access.
