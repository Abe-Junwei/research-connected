import type { StagedPaper } from "./staging";
import type { ResearchProject } from "./project-state";
import type { ReadingWorkflowStore } from "./reading-workflow";
import type { SourceVersionRelation, WorkIdentityDecision } from "./work-identity";
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
	/** Fetch model-labeled embeddings with candidate enrichment (needs s2Reconcile). */
	semanticEmbedding: boolean;
	includeReferences: boolean;
	includeCitations: boolean;
	includeRelated: boolean;
	/** Exclude retracted works from new graph samples; default keeps them with a ranking penalty. */
	excludeRetracted: boolean;
	/** Folder for literature notes. Empty writes them to the vault root. */
	literatureFolder: string;
	/** Filename template. Empty uses "{{year}} {{title}}". */
	literatureFilename: string;
	/** Body template. Empty uses a heading with the title. Frontmatter is always added. */
	literatureTemplate: string;
	/** Frontmatter key used to recognize an existing note's DOI. */
	literatureDoiProperty: string;
	stagedPapers: StagedPaper[];
	/** Deep-dug paper ids kept per seed OpenAlex id, restored on rebuild. */
	graftedBySeed: Record<string, string[]>;
	researchProjects: Record<string, ResearchProject>;
	readingWorkflow?: ReadingWorkflowStore;
	workflowMigration?: { version: 1; backup: string; completedAt: number };
	workIdentityDecisions?: WorkIdentityDecision[];
	sourceVersionRelations?: SourceVersionRelation[];
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
	semanticEmbedding: true,
	includeReferences: true,
	includeCitations: true,
	includeRelated: true,
	excludeRetracted: false,
	literatureFolder: "",
	literatureFilename: "",
	literatureTemplate: "",
	literatureDoiProperty: "doi",
	stagedPapers: [],
	graftedBySeed: {},
	researchProjects: {},
};
