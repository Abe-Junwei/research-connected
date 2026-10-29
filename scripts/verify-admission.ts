import assert from "node:assert/strict";
import { assessAdmission, admissionText } from "../src/admission";
import { diagnoseCandidate, expandAround, expandSecondLayer, loadNeighborhood, restoreGraftedMembers, selectNeighbors } from "../src/neighborhood";
import { OpenAlexClient, toPaper } from "../src/openalex";
import { restoreGraphSnapshot, saveGraphSnapshot } from "../src/project-state";
import { DEFAULT_SETTINGS } from "../src/settings-model";

export async function verifyAdmission(): Promise<void> {
	const topic = (id: string, name: string, field: string) => ({
		id: `https://openalex.org/${id}`, display_name: name, score: 0.9,
		subfield: { id: `https://openalex.org/subfields/${field}01`, display_name: name },
		field: { id: `https://openalex.org/fields/${field}`, display_name: field },
		domain: { id: "https://openalex.org/domains/2", display_name: "Social Sciences" },
	});
	const linguistics = topic("T1", "Phonology", "12");
	const management = topic("T2", "Organizational strategy", "14");
	const computing = topic("T3", "Neural networks", "17");
	const work = (id: string, title: string, classification?: ReturnType<typeof topic>) => ({
		id, display_name: title, type: "article", cited_by_count: id === "W2" ? 100000 : 10,
		primary_topic: classification, topics: classification ? [classification] : [],
		referenced_works: [],
	});
	const seed = work("W1", "Speech perception and phonological contrasts in language social theory", linguistics);
	const unrelated = work("W2", "Language social theory in organizational strategy", management);
	const matched = work("W3", "Phonological contrasts", linguistics);
	const interdisciplinary = work("W4", "Speech perception in neural networks", computing);
	const unknown = work("W5", "Language contact");
	const badCiter = { ...unrelated, id: "W6" };
	const badRelated = { ...unrelated, id: "W7" };
	const goodRelated = { ...matched, id: "W8" };
	const all = [seed, unrelated, matched, interdisciplinary, unknown, badCiter, badRelated, goodRelated];
	const asNode = (raw: typeof seed) => toPaper(raw, "reference")!;
	const seedNode = toPaper(seed, "seed")!;
	assert.deepEqual(seedNode.primaryTopic?.field, { id: linguistics.field.id, name: "12" });
	assert.deepEqual(seedNode.topicTags?.[0]?.domain, { id: linguistics.domain.id, name: "Social Sciences" });
	assert.equal(assessAdmission(seedNode, asNode(unrelated)).status, "excluded", "generic words and shared broad domains are insufficient");
	assert.equal(assessAdmission(seedNode, asNode({ ...unrelated, topics: [linguistics] })).reason, "topic", "secondary topic overlap can corroborate cross-field work");
	const sharedSubfield = { ...management, subfield: linguistics.subfield };
	assert.equal(assessAdmission(seedNode, asNode({ ...unrelated, topics: [sharedSubfield] })).reason, "subfield");
	const sameField = { ...management, field: linguistics.field };
	assert.equal(assessAdmission(seedNode, asNode({ ...unrelated, primary_topic: sameField })).reason, "field");
	assert.equal(assessAdmission(seedNode, asNode({ ...unrelated, primary_topic: undefined, topics: [] })).status, "uncertain");
	assert.equal(assessAdmission(seedNode, asNode({ ...unrelated, primary_topic: undefined })).status, "excluded", "hierarchical topic metadata works without primary_topic");
	assert.equal(assessAdmission(toPaper({ id: "W9", display_name: "Old seed" }, "seed")!, asNode(unrelated)).status, "uncertain", "legacy seed metadata must not reject candidates");
	const selectedFields: string[][] = [];
	const client = new OpenAlexClient(async (url) => {
		const request = new URL(url);
		selectedFields.push((request.searchParams.get("select") ?? "").split(","));
		if (request.pathname === "/works/W1") return seed;
		const filter = request.searchParams.get("filter") ?? "";
		const results = filter.startsWith("openalex:")
			? all.filter((raw) => filter.slice("openalex:".length).split("|").includes(raw.id))
			: filter.startsWith("cited_by:") ? [unrelated, matched, interdisciplinary, unknown]
			: filter.startsWith("cites:") ? [badCiter] : [badRelated, goodRelated];
		return { results, meta: { next_cursor: null } };
	}, { apiKey: "", contactEmail: "" });
	const settings = { ...DEFAULT_SETTINGS, maxNodes: 20, s2Reconcile: false };
	const graph = await loadNeighborhood(client, { kind: "openalex", value: "W1" }, settings);
	for (const id of ["W2", "W6", "W7"]) {
		assert.ok(!graph.nodes.some((paper) => paper.id === id), `${id}: cross-field generic overlap must not enter through any source`);
		assert.ok(graph.candidateAudit?.some((item) => item.id === id && item.rejection), `${id}: rejection must be inspectable`);
		assert.match(diagnoseCandidate(graph, id).detail, /学科不同|Different seed discipline/);
	}
	assert.ok(selectedFields.slice(0, 4).every((fields) => fields.includes("primary_topic")), "seed and all sampling sources request primary classifications");
	for (const id of ["W3", "W4", "W5"]) {
		assert.ok(graph.nodes.some((paper) => paper.id === id), `${id}: retain same-field, specific cross-field, and unknown-classification candidates`);
	}
	assert.ok(graph.nodes.length < settings.maxNodes, "do not fill empty slots with excluded candidates");
	const restored = restoreGraphSnapshot(JSON.parse(JSON.stringify(saveGraphSnapshot(graph))));
	assert.ok(restored);
	assert.deepEqual(restored.nodes, JSON.parse(JSON.stringify(graph.nodes)), "classification and admission evidence survive snapshot round-trip");
	assert.equal(graph.nodes.find((paper) => paper.id === "W5")?.admission?.status, "uncertain", "unknown classifications must be labeled, not silently trusted");
	assert.equal(graph.nodes.find((paper) => paper.id === "W4")?.admission?.status, "cross-disciplinary");
	const unknownNode = graph.nodes.find((paper) => paper.id === "W5")!;
	assert.match(admissionText(unknownNode.admission!), /不确定|uncertain/, "uncertainty has explicit detail copy");
	const expanded = await expandAround(client, graph, graph.nodes[0]!, new Set(), settings, 8);
	assert.ok(expanded.papers.some((paper) => paper.id === "W2"), "explicit expansion permits cross-disciplinary exploration");
	assert.ok(expanded.warnings.length > 0, "explicit expansion warns about discipline mismatches");
	assert.equal(expanded.papers.find((paper) => paper.id === "W2")?.admission?.status, "manual");
	const grafted = await restoreGraftedMembers(client, graph, ["W2"], settings);
	assert.equal(grafted.graph.nodes.find((paper) => paper.id === "W2")?.admission?.status, "manual", "rebuilding preserves explicit cross-disciplinary choices");
	const second = await expandSecondLayer(client, graph, 30);
	assert.ok(!second.graph.nodes.some((paper) => paper.id === "W2"), "automatic second layer must not bypass admission");
	assert.match(second.note, /过滤|filtered/, "automatic expansion reports filtering");

	const pool = (count: number, origin: "reference" | "related", first: number) =>
		Array.from({ length: count }, (_, i) => toPaper(work(`W${first + i}`, `Candidate ${i}`, linguistics), origin)!);
	const reference = pool(60, "reference", 100);
	const related = pool(60, "related", 200);
	const rank = (paper: { origin: string }): number => paper.origin === "reference" ? 1 : 0;
	const picked = selectNeighbors(settings, { reference, citation: [], related }, "W1", rank);
	assert.ok(picked.every((paper) => paper.origin === "reference"), "related works have no guaranteed slots");
	const sparse = selectNeighbors(settings, { reference: [], citation: [], related }, "W1");
	assert.ok(sparse.length <= Math.floor(19 * 0.22), "backfill must respect the final related cap");
	const highRelated = (paper: { origin: string }): number => paper.origin === "related" ? 1 : 0;
	const competitive = selectNeighbors(settings, { reference, citation: [], related }, "W1", highRelated);
	assert.equal(competitive.filter((paper) => paper.origin === "related").length, 4, "strong related candidates can win slots up to the cap");
	const mmr = { sim: () => 0, lambda: 0.7 };
	assert.deepEqual(selectNeighbors(settings, { reference, citation: [], related }, "W1", highRelated, mmr), competitive, "MMR cannot bypass the cap");
	for (const maxNodes of [20, 50, 300]) {
		const capped = selectNeighbors({ ...settings, maxNodes }, {
			reference: pool(maxNodes, "reference", 1000),
			citation: [],
			related: pool(maxNodes, "related", 2000),
		}, "W1", highRelated, mmr);
		assert.equal(capped.length, maxNodes - 1);
		assert.equal(capped.filter((paper) => paper.origin === "related").length, Math.floor((maxNodes - 1) * 0.22), `${maxNodes}: enforce exact final cap`);
	}
	const relatedOnly = selectNeighbors({ ...settings, includeReferences: false, includeCitations: false }, { reference, citation: [], related }, "W1");
	assert.equal(relatedOnly.length, 19, "explicit related-only mode can use all slots");
	const duplicate = { ...related[0]!, doiUrl: "https://doi.org/10.1234/duplicate" };
	const structuralDuplicate = { ...reference[0]!, doiUrl: duplicate.doiUrl };
	const deduped = selectNeighbors(settings, { reference: [structuralDuplicate], citation: [], related: [duplicate, ...related.slice(1)] }, "W1", highRelated);
	assert.equal(deduped.filter((paper) => paper.doiUrl === duplicate.doiUrl).length, 1, "cross-source aliases do not consume two slots");
	assert.equal(deduped.find((paper) => paper.doiUrl === duplicate.doiUrl)?.origin, "reference", "source priority survives competitive selection");
	console.log("admission checks passed");
}
