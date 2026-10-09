import { tr } from "./i18n";
import { tokenize } from "./text-similarity";

export interface CommunityPoint {
	id: string;
	community: number;
	x: number;
	y: number;
	shown: boolean;
}

export interface CommunityRegion {
	community: number;
	members: number;
	label: string;
	points: Array<{ x: number; y: number }>;
	cx: number;
	cy: number;
	left: number;
	top: number;
}

export interface CommunityCircle {
	community: number;
	members: number;
	label: string;
	cx: number;
	cy: number;
	radius: number;
}

export function compactPack(
	members: readonly { x: number; y: number }[],
	padding = 0,
): { cx: number; cy: number; radius: number } {
	let pts = [...members];
	for (let round = 0; round < 2 && pts.length > 3; round++) {
		const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
		const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
		const ranked = [...pts].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
		pts = ranked.slice(0, Math.max(3, Math.ceil(pts.length * 0.8)));
	}
	const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
	const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
	const radius = pts.reduce((max, point) => Math.max(max, Math.hypot(point.x - cx, point.y - cy)), 0);
	return { cx, cy, radius: radius + padding };
}

export function buildCommunityCircles(
	points: readonly CommunityPoint[],
	padding = 24,
	minimumMembers = 3,
	maximumRegions = 10,
	labels: ReadonlyMap<number, string> = new Map(),
): CommunityCircle[] {
	const groups = new Map<number, Array<{ x: number; y: number }>>();
	for (const point of points) {
		if (!point.shown) continue;
		const group = groups.get(point.community) ?? [];
		group.push({ x: point.x, y: point.y });
		groups.set(point.community, group);
	}
	return [...groups.entries()]
		.filter(([, members]) => members.length >= minimumMembers)
		.sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
		.slice(0, maximumRegions)
		.map(([community, members]) => {
			const pack = compactPack(members, padding);
			return {
				community,
				members: members.length,
				label: labels.get(community)?.trim() || tr(`社区 ${community + 1}`, `Community ${community + 1}`),
				cx: pack.cx,
				cy: pack.cy,
				radius: pack.radius,
			};
		});
}

/** Build gently padded convex regions for the largest visible communities. */
export function buildCommunityRegions(
	points: readonly CommunityPoint[],
	padding = 24,
	minimumMembers = 3,
	maximumRegions = 10,
	labels: ReadonlyMap<number, string> = new Map(),
): CommunityRegion[] {
	const groups = new Map<number, Array<{ x: number; y: number }>>();
	for (const point of points) {
		if (!point.shown) continue;
		const group = groups.get(point.community) ?? [];
		group.push({ x: point.x, y: point.y });
		groups.set(point.community, group);
	}
	return [...groups.entries()]
		.filter(([, members]) => members.length >= minimumMembers)
		.sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
		.slice(0, maximumRegions)
		.map(([community, members]) => {
			const hull = convexHull(members);
			const center = hull.reduce((sum, point) => ({ x: sum.x + point.x / hull.length, y: sum.y + point.y / hull.length }), { x: 0, y: 0 });
			const expanded = hull.map((point) => {
				const dx = point.x - center.x;
				const dy = point.y - center.y;
				const length = Math.hypot(dx, dy) || 1;
				return { x: point.x + (dx / length) * padding, y: point.y + (dy / length) * padding };
			});
			return {
				community,
				members: members.length,
				label: labels.get(community)?.trim() || tr(`社区 ${community + 1}`, `Community ${community + 1}`),
				points: expanded,
				cx: center.x,
				cy: center.y,
				left: Math.min(...expanded.map((point) => point.x)),
				top: Math.min(...expanded.map((point) => point.y)),
			};
		});
}

export function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i]!;
		const b = points[j]!;
		if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1) + a.x) inside = !inside;
	}
	return inside;
}

/** Smallest containing hull wins when packs overlap. */
export function hitCommunityRegion(
	x: number,
	y: number,
	regions: readonly CommunityRegion[],
): CommunityRegion | undefined {
	for (const region of [...regions].reverse()) {
		if (pointInPolygon(x, y, region.points)) return region;
	}
	return undefined;
}

export function hitCommunityCircle(
	x: number,
	y: number,
	circles: readonly CommunityCircle[],
): CommunityCircle | undefined {
	let best: CommunityCircle | undefined;
	for (const circle of circles) {
		if (Math.hypot(x - circle.cx, y - circle.cy) > circle.radius) continue;
		if (!best || circle.radius < best.radius) best = circle;
	}
	return best;
}

/** Distinctive community name: noun phrases scored by Dunning LLR (CiteSpace-style). */
const LABEL_STOP = new Set([
	"always", "again", "never", "often", "usually", "really", "simply", "highly", "recent", "current",
	"still", "thus", "hence", "therefore", "however", "moreover", "further", "already", "instead",
	"rather", "quite", "almost", "perhaps", "indeed", "actually", "especially", "particularly",
	"general", "special", "important", "different", "various", "several", "certain", "possible",
	"related", "specific", "other", "another", "about", "like", "just", "only", "more", "most",
	"some", "any", "all", "very", "same", "both", "many", "much", "what", "how", "why", "who",
	"will", "would", "could", "should", "been", "being", "does", "did", "done",
	"notes", "note", "marking", "overview", "revisited", "toward", "towards",
]);
const GENERIC = new Set([
	...LABEL_STOP,
	"studies", "study", "research", "language", "languages", "linguistics", "linguistic",
	"history", "society", "social", "communication", "strategies", "strategy", "variation",
	"acquisition", "perception", "categorization", "multilingualism",
	"system", "systems", "type", "types", "form", "forms", "pattern", "patterns",
	"issue", "issues", "aspect", "aspects", "feature", "features", "effect", "effects",
	"factor", "factors", "role", "roles", "view", "views", "account", "accounts",
	"process", "processes", "theory", "theories", "framework", "perspective", "perspectives",
]);

interface PhraseStat {
	name: string;
	keyword: boolean;
	abstractOnly: boolean;
	docs: Set<string>;
}

export function communityTopicLabels(
	nodes: readonly { id: string; title?: string; abstract?: string; concepts?: readonly string[] }[],
	communities: ReadonlyMap<string, number>,
): Map<number, string> {
	const members = new Map<number, string[]>();
	for (const node of nodes) {
		const community = communities.get(node.id);
		if (community === undefined) continue;
		const group = members.get(community) ?? [];
		group.push(node.id);
		members.set(community, group);
	}
	const phrases = new Map<string, PhraseStat>();
	const add = (nodeId: string, key: string, name: string, keyword: boolean, fromAbstract: boolean): void => {
		if (key.length < 4 || LABEL_STOP.has(key) || name.length < 4) return;
		if (!keyword && !key.includes(" ") && (key.length < 5 || GENERIC.has(key))) return;
		if (keyword && contentTokens(name).length === 0) return;
		const stat = phrases.get(key) ?? { name, keyword: false, abstractOnly: true, docs: new Set() };
		if (name.length < stat.name.length) stat.name = name;
		if (keyword) stat.keyword = true;
		if (!fromAbstract) stat.abstractOnly = false;
		stat.docs.add(nodeId);
		phrases.set(key, stat);
	};
	for (const node of nodes) {
		if (!communities.has(node.id)) continue;
		const seen = new Set<string>();
		const push = (raw: string, display: string, keyword: boolean, fromAbstract: boolean): void => {
			const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
			if (seen.has(key)) return;
			seen.add(key);
			add(node.id, key, display, keyword, fromAbstract);
		};
		for (const concept of node.concepts ?? []) {
			for (const part of splitKeyword(concept)) push(part, shortenLabel(part) || part, true, false);
		}
		for (const phrase of ngrams(node.title ?? "")) push(phrase, displayPhrase(phrase), false, false);
		for (const phrase of ngrams(node.abstract ?? "")) push(phrase, displayPhrase(phrase), false, true);
	}
	const n = [...members.values()].reduce((sum, ids) => sum + ids.length, 0);
	const inCommunity = (community: number): Set<string> => new Set(members.get(community) ?? []);
	const scored = (community: number): Array<{ name: string; keyword: boolean; g2: number; a: number }> => {
		const inside = inCommunity(community);
		const size = inside.size;
		const rows: Array<{ name: string; keyword: boolean; g2: number; a: number }> = [];
		for (const stat of phrases.values()) {
			let a = 0;
			for (const id of stat.docs) if (inside.has(id)) a++;
			if (a === 0) continue;
			if (stat.abstractOnly && a < 2) continue;
			const b = stat.docs.size - a;
			const c0 = size - a;
			const d = n - size - b;
			if (a / Math.max(1, size) <= b / Math.max(1, n - size)) continue;
			rows.push({ name: shortenLabel(stat.name) || stat.name, keyword: stat.keyword, g2: dunningG2(a, b, c0, d), a });
		}
		return rows.sort((left, right) =>
			right.g2 - left.g2
			|| Number(right.keyword) - Number(left.keyword)
			|| contentTokens(right.name).length - contentTokens(left.name).length
			|| specificity(right.name) - specificity(left.name)
			|| left.name.length - right.name.length
			|| left.name.localeCompare(right.name),
		);
	};
	const hasRepeated = (community: number): boolean => {
		const inside = inCommunity(community);
		for (const stat of phrases.values()) {
			let a = 0;
			for (const id of stat.docs) if (inside.has(id)) a++;
			if (a < 2) continue;
			if (contentTokens(stat.name).length === 0 && GENERIC.has(stat.name.toLowerCase())) continue;
			const b = stat.docs.size - a;
			if (a / Math.max(1, inside.size) > b / Math.max(1, n - inside.size)) return true;
		}
		return false;
	};
	const used: string[][] = [];
	const labels = new Map<number, string>();
	const order = [...members.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
	for (const [community] of order) {
		const repeated = hasRepeated(community);
		const pick = scored(community).find((row) => {
			if (!row.keyword && repeated && row.a < 2) return false;
			const tokens = contentTokens(row.name);
			const key = tokens.length ? tokens : [row.name.toLowerCase()];
			if (tokens.length === 0 && GENERIC.has(row.name.toLowerCase())) return false;
			return !used.some((seen) => overlapsTokens(seen, key));
		});
		if (!pick) continue;
		const tokens = contentTokens(pick.name);
		used.push(tokens.length ? tokens : [pick.name.toLowerCase()]);
		labels.set(community, clipLabel(pick.name));
	}
	for (const community of [...members.keys()].sort((a, b) => a - b)) {
		if (!labels.has(community)) labels.set(community, tr(`社区 ${community + 1}`, `Community ${community + 1}`));
	}
	return labels;
}

function ngrams(text: string): string[] {
	const tokens = tokenize(text);
	const out: string[] = [];
	for (let n = 1; n <= 3; n++) {
		for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
	}
	return out;
}

function dunningG2(a: number, b: number, c: number, d: number): number {
	const n = a + b + c + d;
	const term = (value: number): number => (value > 0 ? value * Math.log(value) : 0);
	return 2 * (
		term(a) + term(b) + term(c) + term(d) + term(n)
		- term(a + b) - term(c + d) - term(a + c) - term(b + d)
	);
}

function splitKeyword(name: string): string[] {
	return name.split(/[,;·|/]+/).map((part) => part.trim()).filter((part) => part.length >= 4);
}

function shortenLabel(name: string): string {
	const trimmed = name.replace(/\s+/g, " ").trim();
	if (!trimmed) return "";
	const stripped = trimmed
		.replace(/\s+\((?:language|linguistic)s?\s+studies\)$/i, "")
		.replace(/\s+(?:in|and)\s+(?:language|linguistic)s?\s+studies$/i, "")
		.replace(/\s+research$/i, "")
		.trim();
	const source = stripped || trimmed;
	if (source.length <= 28) return source;
	const parts = splitKeyword(source);
	if (parts.length > 1) {
		const best = [...parts].sort((a, b) => specificity(b) - specificity(a) || a.length - b.length)[0];
		if (best && best.length <= 28) return best;
	}
	const content = contentTokens(source);
	if (content.length) return clipLabel(content.map((token) => displayToken(token)).join(" "));
	return clipLabel(source);
}

function clipLabel(name: string, max = 28): string {
	if (name.length <= max) return name;
	const cut = name.slice(0, max + 1);
	const space = cut.lastIndexOf(" ");
	return (space >= 12 ? cut.slice(0, space) : name.slice(0, max)).trim();
}

function contentTokens(name: string): string[] {
	return tokenize(name).filter((token) => !GENERIC.has(token) && token.length >= 4);
}

function specificity(name: string): number {
	const tokens = tokenize(name);
	const content = contentTokens(name);
	if (!content.length) return 0;
	return content.length / Math.max(1, tokens.length);
}

function overlapsTokens(a: readonly string[], b: readonly string[]): boolean {
	if (!a.length || !b.length) return false;
	const other = new Set(b);
	let inter = 0;
	for (const token of a) if (other.has(token)) inter++;
	return inter / Math.min(a.length, b.length) >= 0.6;
}

function displayPhrase(phrase: string): string {
	return phrase.replace(/^\S/, (char) => char.toUpperCase());
}

function displayToken(token: string): string {
	return /^[a-z]/.test(token) ? token[0]!.toUpperCase() + token.slice(1) : token;
}

function convexHull(points: readonly { x: number; y: number }[]): Array<{ x: number; y: number }> {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length <= 2) return sorted;
	const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Array<{ x: number; y: number }> = [];
	for (const point of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
		lower.push(point);
	}
	const upper: Array<{ x: number; y: number }> = [];
	for (const point of [...sorted].reverse()) {
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
		upper.push(point);
	}
	lower.pop();
	upper.pop();
	return [...lower, ...upper];
}
