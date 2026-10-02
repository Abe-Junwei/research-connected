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
	includeReferences: true,
	includeCitations: true,
	includeRelated: true,
};
