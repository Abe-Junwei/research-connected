import { tr } from "./i18n";

export function mountOperationNotice(root: HTMLElement) {
 const host = createDiv();
 host.className = "cpo-operation-notice";
 host.hidden = true;
 host.setAttribute("role", "status");
 host.setAttribute("aria-live", "polite");
 root.append(host);
 let timer: number | undefined;
 const hide = (): void => { window.clearTimeout(timer); host.hidden = true; };
 return {
  show(text: string, error = false): void {
   window.clearTimeout(timer);
   host.replaceChildren();
   host.hidden = !text;
   host.classList.toggle("is-error", error);
   if (!text) return;
   const message = createSpan(); message.textContent = text;
   const close = createEl("button");
   close.type = "button";
   close.textContent = "×";
   close.setAttribute("aria-label", tr("关闭提示", "Dismiss notification"));
   close.onclick = hide;
   host.append(message, close);
   if (!error) timer = window.setTimeout(hide, 10000);
  },
  destroy(): void { window.clearTimeout(timer); host.remove(); },
 };
}
