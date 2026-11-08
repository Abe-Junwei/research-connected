declare const __WEB_BUILD__: string;
let compatible = true;

export async function requireCompatibleClient(): Promise<void> {
	await checkVersion();
	if (!compatible) throw new Error("网页版本需要更新；已保存图谱仍可查看和复制。请完成或取消任务后更新。");
}

let banner: HTMLElement | null = null;
let busy: () => boolean = () => false;
async function checkVersion(): Promise<void> {
	try {
		const response = await window.fetch("/api/version", { cache: "no-store", signal: AbortSignal.timeout(10000) });
		if (!response.ok) return;
		const version = await response.json() as { build: string; minClientApi: number };
		compatible = version.minClientApi <= 2;
		if (!banner) return;
		if (version.build === __WEB_BUILD__) { banner.hidden = true; return; }
		banner.hidden = false;
		banner.textContent = compatible ? "有新版本。请在任务完成、图谱自动保存后更新。" : "当前网页版本已不兼容。已保存图谱仍可查看和复制；请确认自动保存后更新。";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "cpo-text-btn";
		button.textContent = busy() ? "请先完成或取消任务" : "更新网页";
		button.disabled = busy();
		button.onclick = () => {
			if (busy()) return;
			// A new release URL bypasses HTML cached at the browser and edge.
			const target = new URL(window.location.href);
			target.searchParams.set("v", version.build);
			window.location.replace(target.href);
		};
		banner.append(button);
	} catch { /* Keep local projects accessible when version checking is offline. */ }
}

export function watchVersion(isBusy: () => boolean): void {
	busy = isBusy;
	banner = document.createElement("div");
	banner.id = "cpo-web-update";
	banner.hidden = true;
	banner.setAttribute("role", "status");
	document.querySelector("#cpo-web-chrome")?.after(banner);
	void checkVersion();
	window.setInterval(() => { void checkVersion(); }, 30000);
	document.addEventListener("visibilitychange", () => { if (!document.hidden) void checkVersion(); });
}
