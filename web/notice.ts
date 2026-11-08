import { tr } from "../src/i18n";

/** One transient notice; persistent save/access state remains in its existing controls. */
export function createNotice(host: HTMLElement, duration = 10000) {
 let timer: number | undefined;
 const hide = (): void => { window.clearTimeout(timer); host.hidden = true; };
 return (text: string, kind: "info" | "error" = "info"): void => {
  window.clearTimeout(timer);
  host.replaceChildren(); host.hidden = !text; host.dataset.kind = kind;
  if (!text) return;
  const icon = document.createElement("span"); icon.className = "cpo-notice-icon"; icon.textContent = kind === "error" ? "!" : "i"; icon.setAttribute("aria-hidden", "true");
  const message = document.createElement("span"); message.className = "cpo-notice-message"; message.textContent = text;
  const close = document.createElement("button"); close.type = "button"; close.className = "cpo-notice-close"; close.textContent = "×"; close.setAttribute("aria-label", tr("关闭提示", "Dismiss notification")); close.onclick = hide;
  host.append(icon, message, close);
  timer = window.setTimeout(hide, duration);
 };
}
