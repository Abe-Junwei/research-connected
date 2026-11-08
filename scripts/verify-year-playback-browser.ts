import { mountGraphChrome } from "../src/graph-chrome";
import { yearHistogram } from "../src/year-histogram";

export function verifyYearPlayback(): void {
 const host = document.createElement("div"), tabs = document.createElement("div"), panel = document.createElement("div");
 document.body.append(host, tabs, panel);
 const values: (number | null)[] = [];
 const originalInterval = window.setInterval, originalClear = window.clearInterval;
 let tick: (() => void) | undefined;
 window.setInterval = ((callback: TimerHandler) => { tick = callback as () => void; return 1; }) as typeof window.setInterval;
 window.clearInterval = (() => {}) as typeof window.clearInterval;
 const chrome = mountGraphChrome(host, { layouts: ["temporal"], layout: "temporal", noteButton: false, tabsHost: tabs, tabPanel: panel, onExport() {}, onLayout() {}, onTab() {}, onScrub(year) { values.push(year); } });
 try {
  chrome.showSample(yearHistogram([2000, 2002, 2005]), null);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="播放时间视图"], [aria-label="Play timeline"]');
  if (!button) throw new Error("Missing playback button");
  button.click(); tick?.(); tick?.();
  if (JSON.stringify(values) !== JSON.stringify([2000, 2002, null])) throw new Error(`Unexpected years: ${JSON.stringify(values)}`);
  const bars = host.querySelectorAll<HTMLElement>(".cpo-year-bar");
  if (!bars[0]?.dataset.hint?.includes("2000") || !bars[1]?.dataset.hint?.includes("0")) throw new Error("Missing year or count hint");
 } finally { chrome.destroy(); host.remove(); tabs.remove(); panel.remove(); window.setInterval = originalInterval; window.clearInterval = originalClear; }
}
