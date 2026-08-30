# FASDELY Design Tokens

Reference for sub-projects 2-4 (guest Mini App, staff app, admin dashboard).
Visual rationale and mockups: `docs/design/fasdely-design-system.html`
(published as an Artifact — ask for the link if it's not in this
conversation).

## Direction

Signature element: the **order ticket** motif (dashed perforation edges,
dot-leaders between item name and price, tabular monospace numerals) —
used only where a screen actually shows an order: cart, checkout summary,
order confirmation, order tracking, and staff order cards. Not used
anywhere else (buttons, nav, product cards) — the brief's "don't overdesign"
constraint (product prompt section 49) means the risk stays spent in one
place.

## Color

| Token | Hex | Use |
|---|---|---|
| Ink | `#1B1310` | Dark surfaces (staff board, admin sidebar), primary text on light |
| Paper | `#FAF6F1` | Guest app background |
| Coral | `#FF5A44` | Primary CTA, prices, active states — the brand accent |
| Coral Deep | `#E14430` | Coral text-on-light (badges, price highlight) |
| Pine | `#1F6F54` | Ready / success / positive status — semantic, not decorative |
| Amber | `#C97F14` | Preparing / attention / seasonal — semantic, not decorative |

Neutrals are derived from Ink at reduced opacity (`rgba(27,19,16,.7 / .45 / .14 / .08)`)
rather than a separate grey scale, so everything stays tied to the one ink hue.

Deliberately avoided: cream-background + terracotta-accent (generic
AI-design default), and black-background + single neon accent (reads as
generic "food delivery app," and doesn't leave room for pine/amber to carry
order-status meaning).

## Type

| Role | Face | Weight | Notes |
|---|---|---|---|
| Display | Unbounded | 700 | Screen titles, establishment name — full Cyrillic support |
| Body | Manrope | 400 / 700 | All body/UI text — full Cyrillic support, reads well small |
| Mono | JetBrains Mono | 500 | Prices, order numbers, timestamps, admin table numerics — full Cyrillic support |

Sans-serif only, per product prompt section 41. All three faces were
verified to carry the Cyrillic Unicode range (`U+0400-045F`) — required
since the product is Russian-language throughout, including UI chrome.

Use `font-variant-numeric: tabular-nums` on any run of digits that lines up
in a column (prices in a cart, admin table numerics).

## Component names introduced (for later sub-projects to reuse, not rebuild)

- **Ticket** (`.ticket`) — dashed-edge card with dot-leader line items and a
  dashed-rule total. Cart, checkout, confirmation, tracking.
- **Order card** (`.o-card`) — staff board card: number, time, order-type
  chip, items, comment callout, total, one large primary action.
- **Product card** (`.p-card`) — badge, name, short description, tabular
  price.
- **KPI tile** (`.kpi`) — label + tabular-mono value, used in admin overview.
- **Status pill** (`.status-pill`) — semantic color (pine = active, amber =
  trial), never color alone — always paired with a text label.

## Scope of this pass

This covers tokens + one representative screen per key guest/staff/admin
scenario — enough to validate direction. Product editor, seasonal
collection manager, promotions, and full analytics screens are not built
yet; when sub-projects 2-4 reach them, build on these same tokens and
components rather than introducing new ones.
