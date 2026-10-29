export type Origin = "seed" | "reference" | "citation" | "related";

export interface TopicTag {
	id: string;
	name: string;
	score: number;
	subfield?: { id: string; name: string };
	field?: { id: string; name: string };
	domain?: { id: string; name: string };
}

export interface AdmissionDecision {
	status: "matched" | "cross-disciplinary" | "uncertain" | "excluded" | "manual";
	reason: "topic" | "subfield" | "field" | "phrase" | "missing-classification" | "discipline-mismatch";
}

export interface PaperRecord {
	id: string;
	title: string;
	year: number | null;
	citedByCount: number;
	citationCountStatus?: "known" | "missing";
	/** OpenAlex percentile normalized by type, year and subfield; absent in older snapshots. */
	normalizedCitation?: { percentile: number; top1Percent: boolean } | null;
	authors: string;
	/** Structured author display names in authorship order; empty when unknown. */
	authorList: string[];
	abstract: string;
	abstractSource?: "openalex" | "s2" | "crossref";
	doiUrl: string | null;
	openAlexUrl: string;
	isSeed: boolean;
	origin: Origin;
	/** OpenAlex language code, when the work record includes one. */
	language: string | null;
	/** OpenAlex work type, such as `article`, when present. */
	workType: string | null;
	/** Host venue name (journal or book title) from the primary location, when present. */
	venue: string | null;
	/** Issue details returned with OpenAlex work lists; optional for older saved graphs. */
	bibliography?: { volume?: string | null; issue?: string | null; firstPage?: string | null; lastPage?: string | null };
	/** Topic/concept display names OpenAlex attached to the work. Empty when absent. */
	concepts: string[];
	/** Current OpenAlex topic classifications, with IDs and per-work scores. */
	topicTags?: TopicTag[];
	/** Primary classification; absent in older snapshots and unclassified works. */
	primaryTopic?: TopicTag | null;
	/** Conservative, seed-relative eligibility evidence; not an absolute relevance score. */
	admission?: AdmissionDecision;
	/** True when OpenAlex flags the work as retracted (is_retracted). */
	retracted: boolean;
}

export interface PaperNode extends PaperRecord {
	/** Original source records; the representative's citation count is never summed. */
	records?: PaperRecord[];
	/** A project-local decision to keep this source record separate. */
	recordsSeparated?: boolean;
}

/** Which way a direct citation runs, relative to `source` and `target`. */
export type DirectLink = "none" | "source-cites-target" | "target-cites-source" | "mutual";

export interface GraphEdge {
	source: string;
	target: string;
	/** Combined graph score, 0–1. Used for graph sampling and layout. */
	weight: number;
	/** Reference/citation-network similarity, normalized 0–1 and excluding direct citations. */
	structuralSimilarity?: number | null;
	/** Whether the obtained lists and sampled contexts permit each comparison. */
	structuralCoverage?: { references: boolean; coCitation: boolean };
	/** Bibliographic-coupling cosine of the two reference sets. */
	coupling: number;
	/** Size of the reference-set intersection. */
	sharedRefs: number;
	/** Co-citation cosine over the sampled citing papers. */
	coCitation: number;
	/** How many sampled citing papers list both endpoints. */
	coCitedBy: number;
	direct: DirectLink;
}

export interface SearchHit {
	id: string;
	title: string;
	year: number | null;
	citedByCount: number;
	citationCountStatus?: "known" | "missing";
	authors: string;
}
