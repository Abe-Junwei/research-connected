import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { abstractProblem, screenWebResponse } from "../preview/quality";
import { reconstructAbstract } from "../src/paper";
import { toPaper, type RawWork } from "../src/openalex";

const input = JSON.parse(readFileSync("docs/research/openalex-quality-sample-2026-11-06.json", "utf8")) as { retrieved_at: string; groups: Array<{ label: string; url: string; works: RawWork[] }> };
const unique = new Map<string, { work: RawWork; groups: string[] }>();
for (const group of input.groups) for (const work of group.works) {
	assert.match(work.id ?? "", /^https:\/\/openalex.org\/W\d+$/);
	const existing = unique.get(work.id!);
	if (existing) existing.groups.push(group.label);
	else unique.set(work.id!, { work, groups: [group.label] });
}
const results = [...unique.values()].map(({ work, groups }) => {
	const abstract = reconstructAbstract(work.abstract_inverted_index);
	const problem = abstractProblem(abstract);
	const screened = screenWebResponse(structuredClone(work), new URL("https://api.openalex.org/works")) as RawWork;
	const paper = toPaper(screened, "related");
	assert(paper);
	assert.equal(paper.abstract, problem ? "" : abstract, "bad abstract content is excluded before graph scoring; other abstracts are preserved");
	return { id: paper.id, title: paper.title, type: paper.workType, doi: paper.doiUrl, year: paper.year, authors: paper.authors, groups, abstractLength: abstract.length, problem, evidence: problem ? abstract.slice(0, 200) : "" };
});
const flagged = results.filter(row => row.problem);
const counts = Object.fromEntries(["book", "book-chapter", "article", "book-review"].map(type => [type, { total: results.filter(row => row.type === type).length, flagged: results.filter(row => row.type === type && row.problem).length }]));
const output = { retrieved_at: input.retrieved_at, measured_at: new Date().toISOString(), scope: "Bounded diagnostic sample, not a population error rate. Legacy screenshot text is additionally covered by the regression test.", total: results.length, flagged: flagged.length, counts, alias: { requested: "W564766481", current: "W4213325732" }, results };
writeFileSync("docs/research/openalex-quality-results-2026-11-06.json", JSON.stringify(output, null, 2));
assert(flagged.some(row => row.id === "W1973826788" && row.problem === "contents"));
assert(flagged.some(row => row.id === "W2531378938" && row.problem === "web-boilerplate"));
assert(flagged.some(row => row.id === "W1567687922" && row.problem === "url-only"));
assert(results.some(row => row.id === "W4213325732" && row.problem === null && row.abstractLength > 100));
console.log(JSON.stringify({ total: results.length, flagged: flagged.length, counts, flaggedIds: flagged.map(row => [row.id, row.problem]) }, null, 2));
