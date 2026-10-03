export type Origin = "seed" | "reference" | "citation" | "related";

export interface PaperNode {
	id: string;
	title: string;
	year: number | null;
	citedByCount: number;
	authors: string;
	abstract: string;
	doiUrl: string | null;
	openAlexUrl: string;
	isSeed: boolean;
	origin: Origin;
	/** OpenAlex language code, when the work record includes one. */
	language: string | null;
	/** OpenAlex work type, such as `article`, when present. */
	workType: string | null;
	/** Concept display names OpenAlex attached to the work. Empty when the field is absent. */
	concepts: string[];
	/** True when OpenAlex flags the work as retracted (is_retracted). */
	retracted: boolean;
}

/** Which way a direct citation runs, relative to `source` and `target`. */
export type DirectLink = "none" | "source-cites-target" | "target-cites-source" | "mutual";

export interface GraphEdge {
	source: string;
	target: string;
	/** Combined similarity, 0–1. Layout and thickness use this. */
	weight: number;
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
	authors: string;
}
