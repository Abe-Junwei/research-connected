export type Origin = "seed" | "reference" | "citation" | "related";

export interface PaperNode {
	id: string;
	title: string;
	year: number | null;
	citedByCount: number;
	authors: string;
	/** Structured author display names in authorship order; empty when unknown. */
	authorList: string[];
	abstract: string;
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
	topicTags?: Array<{ id: string; name: string; score: number }>;
	/** True when OpenAlex flags the work as retracted (is_retracted). */
	retracted: boolean;
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
