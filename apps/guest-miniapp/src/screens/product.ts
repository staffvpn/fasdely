import { h, formatPrice, svgIcon } from "../dom.ts";
import type { GetMenuResponse } from "../api.ts";

export function renderProductScreen(
  product: GetMenuResponse["products"][number],
  onAddToCart: (quantity: number) => void,
  onBack: () => void
): HTMLElement {
  let quantity = 1;

  const backBtn = h("div", { class: "icon-btn pd-hero__back" }, [svgIcon("back")]);
  backBtn.addEventListener("click", onBack);
  const heroChildren: HTMLElement[] = [backBtn];
  if (product.image_url) heroChildren.unshift(h("img", { src: product.image_url, alt: product.name }));
  const hero = h("div", { class: "pd-hero" }, heroChildren);

  const qtyLabel = h("span", {}, [String(quantity)]);
  const minusBtn = h("span", { class: "qty__btn" }, [svgIcon("minus")]);
  const plusBtn = h("span", { class: "qty__btn" }, [svgIcon("plus")]);
  minusBtn.addEventListener("click", () => {
    if (quantity > 1) quantity -= 1;
    qtyLabel.textContent = String(quantity);
    updateAddButton();
  });
  plusBtn.addEventListener("click", () => {
    quantity += 1;
    qtyLabel.textContent = String(quantity);
    updateAddButton();
  });

  const addBtn = h("div", { class: "btn btn--block" }, [`Добавить в корзину — ${formatPrice(product.price)}`]);
  function updateAddButton() {
    addBtn.textContent = `Добавить в корзину — ${formatPrice(product.price * quantity)}`;
  }
  addBtn.addEventListener("click", () => onAddToCart(quantity));

  const body = h("div", { class: "pd-body" }, [
    h("div", { class: "pd-title" }, [product.name]),
    h("div", { class: "pd-price" }, [formatPrice(product.price)]),
    h("div", { class: "pd-desc" }, [product.description ?? ""]),
    h("div", { class: "qty" }, [minusBtn, qtyLabel, plusBtn]),
  ]);

  const scroller = h("div", { class: "scroller" }, [body]);
  const sticky = h("div", { class: "sticky-cta" }, [addBtn]);

  return h("div", { class: "screen" }, [hero, scroller, sticky]);
}
