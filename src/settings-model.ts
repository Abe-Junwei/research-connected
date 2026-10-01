export interface ConnectedPapersSettings {
	apiKey: string;
	contactEmail: string;
	maxNodes: number;
	includeReferences: boolean;
	includeCitations: boolean;
	includeRelated: boolean;
}

export const DEFAULT_SETTINGS: ConnectedPapersSettings = {
	apiKey: "",
	contactEmail: "",
	maxNodes: 50,
	includeReferences: true,
	includeCitations: true,
	includeRelated: true,
};
