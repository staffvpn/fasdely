import { ready, expand, getStartParam, showBackButton, hideBackButton, onBackButtonClick } from "./telegram.ts";
import { getMenu, type GetMenuResponse } from "./api.ts";
import { getErrorMessage } from "./errors.ts";
import { CartStore } from "./state.ts";
import { renderMenuScreen } from "./screens/menu.ts";
import { renderProductScreen } from "./screens/product.ts";
import { renderCartScreen } from "./screens/cart.ts";
import { h } from "./dom.ts";

const app = document.getElementById("app")!;
const cart = CartStore.load();

function renderError(message: string) {
  app.replaceChildren(h("div", { class: "screen" }, [h("div", { class: "pd-body" }, [message])]));
}

async function boot() {
  ready();
  expand();

  const qrToken = getStartParam();
  if (!qrToken) {
    renderError("Не удалось определить заведение. Откройте FASDELY через QR-код в кафе.");
    return;
  }

  let result;
  try {
    result = await getMenu(qrToken);
  } catch {
    renderError(getErrorMessage("network_error"));
    return;
  }
  if (!result.ok) {
    renderError(getErrorMessage(result.error, result.reason));
    return;
  }

  showMenu(result.data);
}

function showMenu(data: GetMenuResponse) {
  hideBackButton();
  const screen = renderMenuScreen(data, (productId) => showProduct(data, productId), () => showCart(data), cart);
  app.replaceChildren(screen);
}

function showCart(menu: GetMenuResponse) {
  showBackButton();
  onBackButtonClick(() => showMenu(menu));
  const rerender = () => showCart(menu);
  const screen = renderCartScreen(
    cart,
    rerender,
    () => {
      // Task 14 wires checkout navigation here.
    },
    () => showMenu(menu)
  );
  app.replaceChildren(screen);
}

function showProduct(menu: GetMenuResponse, productId: string) {
  const product = menu.products.find((p) => p.id === productId);
  if (!product) return;
  showBackButton();
  onBackButtonClick(() => showMenu(menu));
  const screen = renderProductScreen(
    product,
    (quantity) => {
      cart.add({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity,
        modifierIds: [],
        modifierLabel: "",
      });
      cart.save();
      showMenu(menu);
    },
    () => showMenu(menu)
  );
  app.replaceChildren(screen);
}

boot();
