import { h, formatPrice, svgIcon } from "../dom.ts";
import { getOrder, cancelOrder, type OrderDetail, type OrderItemView } from "../api.ts";
import { getErrorMessage } from "../errors.ts";

const TERMINAL_STATUSES = new Set(["handed_out", "cancelled_by_guest", "cancelled_by_establishment", "expired"]);
const CANCELLABLE_STATUSES = new Set(["new", "waiting_confirmation", "accepted"]);

const STEPS: { status: string; label: string }[] = [
  { status: "accepted", label: "Принят" },
  { status: "preparing", label: "Готовится" },
  { status: "ready", label: "Готов" },
  { status: "handed_out", label: "Выдан" },
];

function stepState(stepStatus: string, currentStatus: string): "done" | "current" | "pending" {
  const order = STEPS.map((s) => s.status);
  const stepIdx = order.indexOf(stepStatus);
  const currentIdx = order.indexOf(currentStatus);
  if (currentIdx < 0) return "pending";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}

export function renderTrackingScreen(orderId: string, onBackToMenu: () => void): { element: HTMLElement; stopPolling: () => void } {
  const header = h("div", { class: "app-header" }, [h("div", { class: "app-header__name" }, [`Заказ`])]);
  const body = h("div", { class: "scroller" }, [h("div", {}, ["Загрузка…"])]);
  const element = h("div", { class: "screen" }, [header, body]);

  let stopped = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function renderOrder(order: OrderDetail, items: OrderItemView[]) {
    header.replaceChildren(h("div", { class: "app-header__name" }, [`Заказ №${order.order_number}`]));

    const trackList = h(
      "div",
      { class: "track-list" },
      STEPS.map((step) => {
        const state = stepState(step.status, order.status);
        const stateClass = state === "pending" ? "" : ` is-${state}`;
        const dot = h("div", { class: "track-dot" }, state === "done" ? [svgIcon("check")] : []);
        return h("div", { class: `track-item${stateClass}` }, [dot, h("div", {}, [h("div", { class: "track-label" }, [step.label])])]);
      })
    );

    const ticket = h("div", { class: "ticket" }, [
      ...items.map((i) =>
        h("div", { class: "t-line" }, [h("span", {}, [`${i.quantity}× ${i.product_name_snapshot}`]), h("span", { class: "leader" }, []), h("span", { class: "price" }, [formatPrice(i.line_total)])])
      ),
      h("div", { class: "t-total" }, [h("span", {}, ["ИТОГО"]), h("span", {}, [formatPrice(order.total)])]),
      h("span", { class: "pay-pill" }, [svgIcon("card"), "Оплата в кафе"]),
    ]);

    const children: (Node | string)[] = [trackList, ticket];

    if (["cancelled_by_guest", "cancelled_by_establishment"].includes(order.status)) {
      children.push(h("div", { class: "cancel-note" }, ["Заказ отменён"]));
    } else if (CANCELLABLE_STATUSES.has(order.status)) {
      const cancelBtn = h("div", { class: "btn btn--secondary btn--block" }, ["Отменить заказ"]);
      cancelBtn.addEventListener("click", async () => {
        if (!confirm("Точно отменить заказ?")) return;
        cancelBtn.textContent = "Отменяем...";
        try {
          const result = await cancelOrder(order.id);
          if (result.ok) {
            load();
          } else {
            cancelBtn.textContent = "Отменить заказ";
            alert(getErrorMessage(result.error, result.reason));
          }
        } catch {
          cancelBtn.textContent = "Отменить заказ";
          alert(getErrorMessage("network_error"));
        }
      });
      children.push(cancelBtn);
    } else {
      children.push(h("div", { class: "cancel-note" }, ["Отмена недоступна — заказ уже готовится"]));
    }

    const backToMenuBtn = h("div", { class: "btn btn--secondary btn--block" }, ["К меню"]);
    backToMenuBtn.addEventListener("click", onBackToMenu);
    children.push(backToMenuBtn);

    body.replaceChildren(...children.map((c) => (typeof c === "string" ? h("div", {}, [c]) : c)));

    if (TERMINAL_STATUSES.has(order.status)) stopPolling();
  }

  async function load() {
    let result;
    try {
      result = await getOrder(orderId);
    } catch {
      if (stopped) return;
      body.replaceChildren(h("div", {}, [getErrorMessage("network_error")]));
      return;
    }
    if (stopped) return;
    if (!result.ok) {
      body.replaceChildren(h("div", {}, [getErrorMessage(result.error, result.reason)]));
      return;
    }
    renderOrder(result.data.order, result.data.items);
  }

  function stopPolling() {
    stopped = true;
    if (intervalId) clearInterval(intervalId);
  }

  load();
  intervalId = setInterval(load, 6000);

  return { element, stopPolling };
}
