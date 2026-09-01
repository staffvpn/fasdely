const MESSAGES: Record<string, string> = {
  network_error: "Нет интернета. Проверьте подключение и попробуйте снова.",
  location_not_found: "Сейчас не принимаем заказы в этом заведении.",
  location_closed: "Сейчас не принимаем заказы. Загляните позже.",
  product_not_found: "Этот товар закончился. Уберём его из заказа?",
  product_unavailable: "Этот товар закончился. Уберём его из заказа?",
  modifier_not_found: "Этот вариант товара сейчас недоступен.",
  invalid_quantity: "Проверьте количество товара.",
  empty_cart: "Корзина пуста.",
  unauthorized: "Не удалось подтвердить, что это вы. Откройте меню заново из Telegram.",
  forbidden: "Это не ваш заказ.",
  order_not_found: "Заказ не найден.",
  not_cancellable: "Отмена уже недоступна — заказ готовится.",
  already_handled: "Заказ уже обработан.",
};

const TIME_REASONS: Record<string, string> = {
  too_soon: "Выберите время позже — на подготовку нужно больше времени.",
  outside_hours: "Выбранное время вне часов работы.",
  location_closed: "Сейчас не принимаем заказы. Загляните позже.",
};

export function getErrorMessage(error: string, reason?: string): string {
  if (error === "invalid_time" && reason && TIME_REASONS[reason]) return TIME_REASONS[reason];
  return MESSAGES[error] ?? "Что-то пошло не так. Попробуйте ещё раз.";
}
