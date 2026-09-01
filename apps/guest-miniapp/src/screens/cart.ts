import { h, formatPrice, svgIcon } from "../dom.ts";
import type { CartStore } from "../state.ts";

export function renderCartScreen(
  cart: CartStore,
  onChange: () => void,
  onContinue: () => void,
  onBack: () => void
): HTMLElement {
  const rows = cart.getLines().map((line) => {
    const stepperMinus = h("span", { class: "cart-stepper__btn" }, [svgIcon("minus")]);
    const stepperPlus = h("span", { class: "cart-stepper__btn" }, [svgIcon("plus")]);
    const stepperN = h("span", { class: "cart-stepper__n" }, [String(line.quantity)]);
    stepperMinus.addEventListener("click", () => {
      cart.setQuantity(line.productId, line.modifierIds, line.quantity - 1);
      cart.save();
      onChange();
    });
    stepperPlus.addEventListener("click", () => {
      cart.setQuantity(line.productId, line.modifierIds, line.quantity + 1);
      cart.save();
      onChange();
    });

    const removeBtn = h("span", { class: "cart-row__remove" }, [svgIcon("close")]);
    removeBtn.addEventListener("click", () => {
      cart.remove(line.productId, line.modifierIds);
      cart.save();
      onChange();
    });

    return h("div", { class: "cart-row" }, [
      h("div", { class: "cart-row__main" }, [
        h("div", { class: "cart-row__name" }, [line.name]),
        ...(line.modifierLabel ? [h("div", { class: "cart-row__mods" }, [line.modifierLabel])] : []),
        h("div", { class: "cart-row__bottom" }, [
          h("div", { class: "cart-stepper" }, [stepperMinus, stepperN, stepperPlus]),
          h("span", { class: "cart-row__price" }, [formatPrice(line.unitPrice * line.quantity)]),
        ]),
      ]),
      removeBtn,
    ]);
  });

  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, ["Корзина"])]);
  const scroller = h("div", { class: "scroller" }, rows.length ? rows : [h("div", {}, ["Корзина пуста"])]);

  const continueBtn = h("div", { class: "btn" }, ["Продолжить"]);
  continueBtn.addEventListener("click", onContinue);
  const sticky = h("div", { class: "sticky-cta" }, [
    h("div", { class: "sticky-cta__info" }, ["Итого", h("br", {}, []), h("span", { class: "sticky-cta__price" }, [formatPrice(cart.getTotal())])]),
    continueBtn,
  ]);

  return h("div", { class: "screen" }, [header, scroller, sticky]);
}
