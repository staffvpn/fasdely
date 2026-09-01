import { ready, expand, getStartParam, showBackButton, hideBackButton, onBackButtonClick } from "./telegram.ts";
import { getMenu, type GetMenuResponse } from "./api.ts";
import { getErrorMessage } from "./errors.ts";
import { CartStore } from "./state.ts";
import { renderMenuScreen } from "./screens/menu.ts";
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
  const screen = renderMenuScreen(
    data,
    (productId) => {
      // Task 12 wires product-detail navigation here.
    },
    () => {
      // Task 13 wires cart navigation here.
    },
    cart
  );
  app.replaceChildren(screen);
}

boot();
