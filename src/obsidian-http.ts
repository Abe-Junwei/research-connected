import { requestUrl } from "obsidian";
import { explainStatus, OpenAlexError, type GetJson } from "./openalex";

/** Non-OpenAlex hosts routed through obsidianGetJson, so their errors name the right service. */
const SERVICE_NAME: Record<string, string> = {
	"api.semanticscholar.org": "Semantic Scholar",
	"api.opencitations.net": "OpenCitations",
};

function serviceName(url: string): string {
	try {
		return SERVICE_NAME[new URL(url).hostname] ?? "OpenAlex";
	} catch {
		return "OpenAlex";
	}
}

function explainGet(url: string, status: number | undefined): string {
	const name = serviceName(url);
	if (name === "OpenAlex") return explainStatus(status);
	if (status === 401 || status === 403) return `${name} 拒绝了 API 密钥。请在设置里检查。`;
	if (status === 429 || status === 402 || status === 409) {
		return `${name} 额度已用完或请求过快。可在设置中填写 API 密钥，或稍后再试。`;
	}
	if (status) return `${name} 请求失败（HTTP ${status}）。`;
	return `无法连接 ${name}。`;
}

/** OpenAlex GET via Obsidian's requestUrl so the embed and the pane share one path. */
export const obsidianGetJson: GetJson = async (url, init) => {
	let response;
	try {
		response = await bounded(requestUrl({
			url,
			method: "GET",
			headers: init.headers,
			throw: false,
		}), 30000);
	} catch {
		throw new OpenAlexError(explainGet(url, undefined));
	}
	if (response.status >= 400) {
		throw new OpenAlexError(explainGet(url, response.status), response.status);
	}
	try {
		return response.json;
	} catch {
		throw new OpenAlexError(`${serviceName(url)} 返回了无法解析的内容。`, response.status);
	}
};

export const obsidianPostJson = async (
	url: string,
	init: { headers: Record<string, string>; body: string },
): Promise<unknown> => {
	const service = postServiceName(url);
	let response;
	try {
		response = await bounded(requestUrl({
			url,
			method: "POST",
			headers: init.headers,
			body: init.body,
			throw: false,
		}), 60000);
	} catch {
		throw new OpenAlexError(`无法连接 ${service}。`);
	}
	if (response.status >= 400) throw new OpenAlexError(`${service} 请求失败（HTTP ${response.status}）。`, response.status);
	try {
		return response.json;
	} catch {
		throw new OpenAlexError(`${service} 返回了无法解析的内容。`, response.status);
	}
};

/** POST targets are Semantic Scholar or the configured LLM; unknown hosts are the LLM. */
function postServiceName(url: string): string {
	try {
		return SERVICE_NAME[new URL(url).hostname] ?? "LLM 服务";
	} catch {
		return "LLM 服务";
	}
}

/** requestUrl cannot physically abort; timeout bounds waiting and callers discard stale results. */
async function bounded<T>(request: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([request, new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("请求超时")), ms);
		})]);
	} finally { if (timer) clearTimeout(timer); }
}
