import { createContributorLookup } from "../src/contributors";
import { paintAuthorChips } from "../src/detail-cards";
import { bindLanguage } from "../src/i18n";
import { readHostLanguage } from "../src/host-language";
import { toPaper, type GetJson } from "../src/openalex";

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 100; index++) {
		if (predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	throw new Error("Contributor lookup timed out");
}

export async function verifyContributorsBrowser(): Promise<void> {
	const host = document.createElement("div"); document.body.append(host);
	try {
		bindLanguage(() => "zh-CN");
		const book = toPaper({ id: "W2596888301", display_name: "Evidential Systems of Tibetan Languages", doi: "10.1515/9783110473742", type: "book", authorships: [] }, "seed")!;
		let calls = 0, fail = true, completed = 0;
		const get: GetJson = async () => {
			calls++;
			if (fail) throw new Error("offline");
			return { message: { DOI: "10.1515/9783110473742", editor: [{ given: "Lauren", family: "Gawne" }, { given: "Nathan W.", family: "Hill" }] } };
		};
		const lookup = createContributorLookup(get, () => "");
		const found = (metadata: { editors: string[] }): void => { completed++; book.editorList = metadata.editors; host.replaceChildren(); paintAuthorChips(host, book); };
		paintAuthorChips(host, book);
		lookup(host, book, false, found);
		check(host.textContent!.includes("署名待查") && !host.textContent!.includes("作者信息缺失"), "unqueried contributors are pending, not missing");
		check(calls === 0 && host.querySelector("button")?.textContent === "查询作者 / 编者", "manual mode makes no request");
		host.querySelector("button")!.click();
		check(host.textContent!.includes("正在查询署名") && !host.textContent!.includes("作者信息缺失"), "in-flight lookup never flashes a missing-author conclusion");
		await until(() => host.textContent!.includes("重试署名查询"));
		check(host.textContent!.includes("offline") && !host.textContent!.includes("未提供"), "network errors stay distinct from missing contributors");
		fail = false;
		host.querySelector("button")!.click();
		// Simulate a detail redraw while the same DOI is in flight.
		host.replaceChildren(); lookup(host, book, true, found);
		await until(() => host.textContent!.includes("Nathan W. Hill（编）"));
		check(calls === 2 && completed === 1, "retry bypasses failure cache, redraw shares the pending request");
		check(!host.textContent!.includes("作者信息缺失"), "editors replace the missing-author placeholder");
		const missing = { ...book, editorList: undefined, doiUrl: "https://doi.org/10.1234/no-contributors" };
		const missingLookup = createContributorLookup(async () => ({ message: { DOI: "10.1234/no-contributors" } }), () => "");
		let misses = 0;
		const onMissing = (): void => {
			misses++;
			host.replaceChildren(); paintAuthorChips(host, missing);
			missingLookup(host, missing, true, onMissing);
		};
		host.replaceChildren(); paintAuthorChips(host, missing);
		missingLookup(host, missing, true, onMissing);
		await until(() => host.textContent!.includes("作者信息缺失"));
		await new Promise(resolve => setTimeout(resolve, 20));
		check(misses === 1 && missing.contributorLookup === "missing", "confirmed absence is recorded once without a redraw loop");
		book.authorList = ["Original Author"];
		book.authors = "Original Author";
		host.replaceChildren(); paintAuthorChips(host, book);
		check(host.textContent!.includes("Original Author") && host.textContent!.includes("（编）"), "authors and editors render separately");
		bindLanguage(() => "en");
		book.editorList = ["A", "B", "C", "D", "E", "F"];
		host.replaceChildren(); paintAuthorChips(host, book);
		const more = host.querySelector<HTMLButtonElement>(".cpo-author-more")!;
		check(more.getAttribute("aria-label")?.includes("editors"), "editor expansion has an accessible role label");
		more.click();
		check(more.getAttribute("aria-expanded") === "true" && host.textContent!.includes("F (eds.)"), "editor expansion retains role");
	} finally { host.remove(); bindLanguage(readHostLanguage); }
}
