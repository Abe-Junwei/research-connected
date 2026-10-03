export type SampleDepth = "standard" | "extended" | "deep";

export interface ConnectedPapersSettings {
	apiKey: string;
	contactEmail: string;
	openCitationsToken: string;
	semanticScholarApiKey: string;
	llmEnabled: boolean;
	llmEndpoint: string;
	llmApiKey: string;
	llmModel: string;
	llmSendAbstracts: boolean;
	maxNodes: number;
	sampleDepth: SampleDepth;
	/** Cross-check OpenAlex numbers against Semantic Scholar and backfill missing reference lists. */
	s2Reconcile: boolean;
	includeReferences: boolean;
	includeCitations: boolean;
	includeRelated: boolean;
}

export const DEFAULT_SETTINGS: ConnectedPapersSettings = {
	apiKey: "",
	contactEmail: "",
	openCitationsToken: "",
	semanticScholarApiKey: "",
	llmEnabled: false,
	llmEndpoint: "",
	llmApiKey: "",
	llmModel: "",
	llmSendAbstracts: false,
	maxNodes: 50,
	sampleDepth: "standard",
	s2Reconcile: true,
	includeReferences: true,
	includeCitations: true,
	includeRelated: true,
};
