import { h, formatPrice, svgIcon } from "../dom.ts";
import type { GetMenuResponse } from "../api.ts";
import type { CartStore } from "../state.ts";

export function renderMenuScreen(
  data: GetMenuResponse,
  onSelectProduct: (productId: string) => void,
  onContinue: () => void,
  cart: CartStore
): HTMLElement {
  const header = h("div", { class: "app-header" }, [
    h("div", { class: "app-header__top" }, [
      h("div", {}, [
        h("div", { class: "app-header__name" }, [data.location.name]),
        h("div", { class: "app-header__meta" }, [h("span", { class: "dot" }, []), "Открыто"]),
      ]),
      h("div", { class: "icon-btn" }, [svgIcon("search")]),
    ]),
  ]);

  const grid = h(
    "div",
    { class: "p-grid" },
    data.products.map((p) => {
      const card = h("div", { class: "p-card" }, [
        h("div", { class: "p-card__img" }, p.image_url ? [h("img", { src: p.image_url })] : []),
        h("div", { class: "p-card__body" }, [
          h("div", { class: "p-card__name" }, [p.name]),
          h("div", { class: "p-card__desc" }, [p.description ?? ""]),
          h("div", { class: "p-card__price" }, [formatPrice(p.price)]),
        ]),
      ]);
      card.addEventListener("click", () => onSelectProduct(p.id));
      return card;
    })
  );

  const scroller = h("div", { class: "scroller" }, [grid]);

  const cartTotal = cart.getTotal();
  const cartCount = cart.getLines().reduce((sum, l) => sum + l.quantity, 0);
  const continueBtn = h("div", { class: "btn" }, ["Далее"]);
  continueBtn.addEventListener("click", onContinue);
  const sticky = h("div", { class: "sticky-cta" }, [
    h("div", { class: "sticky-cta__info" }, [
      `Корзина · ${cartCount} товар${cartCount === 1 ? "" : "а"}`,
      h("br", {}, []),
      h("span", { class: "sticky-cta__price" }, [formatPrice(cartTotal)]),
    ]),
    continueBtn,
  ]);

  const screen = h("div", { class: "screen" }, [header, scroller]);
  if (cartCount > 0) screen.append(sticky);
  return screen;
}
