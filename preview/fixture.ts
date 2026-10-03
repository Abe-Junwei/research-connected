import type { GetJson } from "../src/openalex";
const seed = { id: "https://openalex.org/W1", display_name: "种子论文：表示学习", publication_year: 2015, doi: "https://doi.org/10.1234/seed", cited_by_count: 100, referenced_works: ["https://openalex.org/W2", "https://openalex.org/W4", "https://openalex.org/W5", "https://openalex.org/W9"] };
const prior = { id: "https://openalex.org/W2", display_name: "基础研究：优化方法", publication_year: 1990, doi: "https://doi.org/10.1234/prior", cited_by_count: 80, referenced_works: [] };
const later = { id: "https://openalex.org/W3", display_name: "后续研究：模型应用", publication_year: 2020, doi: "https://doi.org/10.1234/later", cited_by_count: 30, referenced_works: ["https://openalex.org/W1", "https://openalex.org/W2"] };
// W4：无年份的前置论文，进「年份未知」区。W5：与种子互引。W6：另一篇施引。W9：未收录的参考文献 id。
const undated = { id: "https://openalex.org/W4", display_name: "早期笔记：未标年份", doi: "https://doi.org/10.1234/undated", cited_by_count: 5, referenced_works: [] };
const mutual = { id: "https://openalex.org/W5", display_name: "互引工作：交叉验证", publication_year: 2018, doi: "https://doi.org/10.1234/mutual", cited_by_count: 12, referenced_works: ["https://openalex.org/W1"] };
const secondLater = { id: "https://openalex.org/W6", display_name: "后续研究：下游任务", publication_year: 2022, doi: "https://doi.org/10.1234/later2", cited_by_count: 8, referenced_works: ["https://openalex.org/W1"] };
const works = [seed, prior, later, undated, mutual, secondLater]
	.map(p => ({ ...p, authorships: [{ author: { display_name: "Example Author" } }], abstract_inverted_index: { "测试摘要": [0] } }));
export const fixtureGet: GetJson = async url => {
	if (url.includes("opencitations")) return [{ citing: "doi:10.1234/later", cited: "doi:10.1234/seed" }];
	if (url.includes("semanticscholar")) return { data: [{ citedPaper: { externalIds: { DOI: "10.1234/seed" } }, intents: ["method"], isInfluential: true, contexts: ["We use the seed method."] }] };
	const query = new URL(url);
	if (query.pathname !== "/works") return works[0];
	const filter = query.searchParams.get("filter") ?? "";
	return { results: filter.startsWith("cited_by:") ? [works[1], works[3], works[4]] : filter.startsWith("cites:") ? [works[2], works[4], works[5]] : filter.startsWith("related_to:") ? [] : works };
};
export const fixturePost = async (): Promise<unknown> => ({
	choices: [{ message: { content: JSON.stringify({ synthesis: "测试总结：种子论文引用了优化研究，后续应用引用了种子论文。", basedOn: [{ paperId: "W2", role: "background", claim: "种子引用基础研究。", evidence: ["W1 引用 W2"], confidence: "low" }], influenced: [{ paperId: "W3", role: "unclear", claim: "后续研究引用种子；引用本身不证明实质影响。", evidence: ["W3 引用 W1"], confidence: "low" }], importantWorks: [], caveats: ["离线演示数据，不是实际学术结论。"] }) } }],
});
