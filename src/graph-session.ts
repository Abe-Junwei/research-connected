import { yearHistogram, type YearHistogram } from "./year-histogram";

export type RevealSource = "user" | "refresh";

export interface SessionSelection {
	paperId: string | null;
	edgeId: string | null;
}

export interface SessionState {
	selection: SessionSelection;
	/** True only after a user gesture that should open the right rail. Refresh leaves it false. */
	revealRight: boolean;
	scrubYear: number | null;
	histogram: YearHistogram | null;
	status: string;
}

export type SessionAction =
	| { type: "sample"; years: readonly (number | null)[]; scrubYear?: number | null; status?: string }
	| { type: "select-paper"; id: string | null; source: RevealSource }
	| { type: "select-edge"; id: string | null; paperId: string | null; source: RevealSource }
	| { type: "scrub"; year: number | null }
	| { type: "status"; text: string };

export interface GraphSession {
	apply(action: SessionAction): void;
	state(): SessionState;
	subscribe(listener: () => void): () => void;
	/** One in-flight deep dive per seed. The lock belongs to this mount, not the process. */
	beginDive(seedId: string): boolean;
	endDive(seedId: string): void;
	destroy(): void;
}

function emptyState(): SessionState {
	return {
		selection: { paperId: null, edgeId: null },
		revealRight: false,
		scrubYear: null,
		histogram: null,
		status: "",
	};
}

function reduce(state: SessionState, action: SessionAction): SessionState {
	switch (action.type) {
		case "sample":
			return {
				...state,
				histogram: yearHistogram(action.years),
				scrubYear: action.scrubYear === undefined ? state.scrubYear : action.scrubYear,
				status: action.status ?? state.status,
				revealRight: false,
			};
		case "select-paper":
			return {
				...state,
				selection: { paperId: action.id, edgeId: null },
				revealRight: action.source === "user" && action.id !== null,
			};
		case "select-edge":
			return {
				...state,
				selection: { paperId: action.paperId, edgeId: action.id },
				revealRight: action.source === "user" && action.id !== null,
			};
		case "scrub":
			return { ...state, scrubYear: action.year, revealRight: false };
		case "status":
			return { ...state, status: action.text, revealRight: false };
		default: {
			const unexpected: never = action;
			return unexpected;
		}
	}
}

export function createGraphSession(): GraphSession {
	let current = emptyState();
	let dead = false;
	const listeners = new Set<() => void>();
	const diving = new Set<string>();
	return {
		apply(action) {
			if (dead) return;
			current = reduce(current, action);
			for (const listener of listeners) listener();
		},
		state: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		beginDive(seedId) {
			if (dead || diving.has(seedId)) return false;
			diving.add(seedId);
			return true;
		},
		endDive(seedId) {
			diving.delete(seedId);
		},
		destroy() {
			dead = true;
			diving.clear();
			listeners.clear();
		},
	};
}
