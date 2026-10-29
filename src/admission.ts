import { tr } from "./i18n";
import { tokenize } from "./text-similarity";
import { paperRecords } from "./work-identity";
import type { AdmissionDecision, PaperNode, TopicTag } from "./types";

const GENERIC_TERMS = new Set([
	"language", "languages", "social", "theory", "theories", "communication", "discourse",
	"general", "framework", "perspective", "perspectives", "review", "research", "human",
	"effects", "effect", "role", "development", "process", "processes", "system", "systems",
]);

function topics(paper: PaperNode): TopicTag[] {
	return paperRecords(paper).flatMap((record) => [record.primaryTopic, ...(record.topicTags ?? [])])
		.filter((topic): topic is TopicTag => Boolean(topic && topic.score > 0 && !topic.id.startsWith("name:")));
}

function mainTopic(paper: PaperNode): TopicTag | undefined {
	return paper.primaryTopic && paper.primaryTopic.score > 0
		? paper.primaryTopic
		: [...(paper.topicTags ?? [])].filter((topic) => topic.score > 0).sort((a, b) => b.score - a.score)[0];
}

function phrases(paper: PaperNode): Set<string> {
	const result = new Set<string>();
	// Match adjacent informative terms, never a bag of generic words or a corpus-normalized score.
	for (const text of [paper.title, paper.abstract, ...topics(paper).map((topic) => topic.name)]) {
		const tokens = tokenize(text);
		for (let i = 0; i + 1 < tokens.length; i++) {
			const first = tokens[i]!;
			const second = tokens[i + 1]!;
			if (GENERIC_TERMS.has(first) || GENERIC_TERMS.has(second)) continue;
			result.add(`${first}\0${second}`);
		}
	}
	return result;
}

export function assessAdmission(seed: PaperNode, candidate: PaperNode): AdmissionDecision {
	const left = topics(seed);
	const right = topics(candidate);
	if (left.some((a) => right.some((b) => a.id === b.id))) return { status: "matched", reason: "topic" };
	if (left.some((a) => a.subfield?.id && right.some((b) => a.subfield?.id === b.subfield?.id))) {
		return { status: "matched", reason: "subfield" };
	}
	const seedField = mainTopic(seed)?.field?.id;
	const candidateField = mainTopic(candidate)?.field?.id;
	if (!seedField || !candidateField) return { status: "uncertain", reason: "missing-classification" };
	if (seedField === candidateField) return { status: "matched", reason: "field" };
	const seedPhrases = phrases(seed);
	if ([...phrases(candidate)].some((phrase) => seedPhrases.has(phrase))) {
		return { status: "cross-disciplinary", reason: "phrase" };
	}
	return { status: "excluded", reason: "discipline-mismatch" };
}

export function admissionText(decision: AdmissionDecision): string {
	if (decision.status === "manual") {
		return tr("主动扩展保留：与起点学科不同，尚无额外相关证据，请核对。", "Kept by explicit expansion: different seed discipline without additional relevance evidence. Review before using.");
	}
	switch (decision.reason) {
		case "topic": return tr("准入依据：与起点共享 OpenAlex 主题；不代表已验证内容相关。", "Eligibility: shared OpenAlex topic with the seed; content relevance is not verified.");
		case "subfield": return tr("准入依据：与起点共享 OpenAlex 子领域；不代表已验证内容相关。", "Eligibility: shared OpenAlex subfield with the seed; content relevance is not verified.");
		case "field": return tr("准入依据：与起点同学科；不代表已验证内容相关。", "Eligibility: same field as the seed; content relevance is not verified.");
		case "phrase": return tr("跨学科保留：标题、摘要或主题含共同的非泛化词组，请核对内容。", "Cross-disciplinary candidate retained: a specific phrase is shared by titles, abstracts, or topics. Review its content.");
		case "missing-classification": return tr("相关性不确定：学科分类缺失，保守保留；被引数不证明相关。", "Relevance uncertain: discipline metadata is missing, so the candidate is retained conservatively. Citations do not prove relevance.");
		case "discipline-mismatch": return tr("与起点学科不同，且没有共同主题、子领域或具体词组证据", "Different seed discipline without a shared topic, subfield, or specific phrase");
	}
}
