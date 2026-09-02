import { h, formatPrice, svgIcon } from "../dom.ts";
import type { CartStore } from "../state.ts";
import { createOrder } from "../api.ts";
import { getErrorMessage } from "../errors.ts";

export function renderCheckoutScreen(
  cart: CartStore,
  locationId: string,
  onOrderPlaced: (orderId: string) => void,
  onError: (message: string) => void,
  onBack: () => void
): HTMLElement {
  let orderType: "dine_in" | "takeaway" = "dine_in";
  const requestedTimeMode: "asap" = "asap";
  let comment = "";

  const dineInOpt = h("div", { class: "co-opt is-on" }, [h("div", { class: "co-opt__label" }, ["Здесь"]), h("div", { class: "co-opt__sub" }, ["Я поем здесь"])]);
  const takeawayOpt = h("div", { class: "co-opt" }, [h("div", { class: "co-opt__label" }, ["С собой"]), h("div", { class: "co-opt__sub" }, ["Возьму с собой"])]);
  dineInOpt.addEventListener("click", () => {
    orderType = "dine_in";
    dineInOpt.classList.add("is-on");
    takeawayOpt.classList.remove("is-on");
  });
  takeawayOpt.addEventListener("click", () => {
    orderType = "takeaway";
    takeawayOpt.classList.add("is-on");
    dineInOpt.classList.remove("is-on");
  });

  const asapChip = h("div", { class: "chip is-active" }, ["Как можно скорее"]);

  const commentField = h("textarea", { class: "co-field", placeholder: "Что-нибудь важное для нас? Например: без сахара" }, []) as HTMLTextAreaElement;
  commentField.addEventListener("input", () => {
    comment = commentField.value;
  });

  const placeBtn = h("div", { class: "btn btn--block" }, ["Оформить заказ"]);
  placeBtn.addEventListener("click", async () => {
    placeBtn.textContent = "Оформляем...";
    try {
      const result = await createOrder({
        locationId,
        orderType,
        requestedTimeMode,
        comment: comment || null,
        idempotencyKey: crypto.randomUUID(),
        items: cart.getLines().map((l) => ({ product_id: l.productId, quantity: l.quantity, modifier_ids: l.modifierIds })),
      });
      if (!result.ok) {
        placeBtn.textContent = "Оформить заказ";
        onError(getErrorMessage(result.error, result.reason));
        return;
      }
      cart.clear();
      cart.save();
      onOrderPlaced(result.data.order.id);
    } catch {
      placeBtn.textContent = "Оформить заказ";
      onError(getErrorMessage("network_error"));
    }
  });

  const body = h("div", { class: "scroller" }, [
    h("div", { class: "co-toggle" }, [dineInOpt, takeawayOpt]),
    h("div", { class: "mod-group__title" }, ["Время"]),
    h("div", { class: "co-time" }, [asapChip]),
    h("div", { class: "mod-group__title" }, ["Комментарий"]),
    commentField,
    h("div", { class: "ticket" }, [
      ...cart.getLines().map((l) =>
        h("div", { class: "t-line" }, [h("span", {}, [`${l.quantity}× ${l.name}`]), h("span", { class: "leader" }, []), h("span", { class: "price" }, [formatPrice(l.unitPrice * l.quantity)])])
      ),
      h("div", { class: "t-total" }, [h("span", {}, ["ИТОГО"]), h("span", {}, [formatPrice(cart.getTotal())])]),
      h("span", { class: "pay-pill" }, [svgIcon("card"), "Оплата в кафе"]),
    ]),
  ]);

  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, ["Оформление"])]);
  const sticky = h("div", { class: "sticky-cta" }, [placeBtn]);
  return h("div", { class: "screen" }, [header, body, sticky]);
}
