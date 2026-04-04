let lastFeedbackTrigger: HTMLElement | null = null;

export function rememberFeedbackTrigger(element: HTMLElement | null) {
  lastFeedbackTrigger = element;
}

export function focusLastFeedbackTrigger() {
  lastFeedbackTrigger?.focus();
}
