export interface YearBin {
	year: number;
	count: number;
}

export interface YearHistogram {
	bins: YearBin[];
	unknown: number;
	dated: number;
}

/** Counts for the current sample. Empty years between min and max stay in place. */
export function yearHistogram(years: readonly (number | null)[]): YearHistogram {
	let unknown = 0;
	let min = Infinity;
	let max = -Infinity;
	const counts = new Map<number, number>();
	for (const year of years) {
		if (year === null || !Number.isFinite(year)) {
			unknown += 1;
			continue;
		}
		counts.set(year, (counts.get(year) ?? 0) + 1);
		if (year < min) min = year;
		if (year > max) max = year;
	}
	if (counts.size === 0) return { bins: [], unknown, dated: 0 };
	const bins: YearBin[] = [];
	let dated = 0;
	for (let year = min; year <= max; year += 1) {
		const count = counts.get(year) ?? 0;
		bins.push({ year, count });
		dated += count;
	}
	return { bins, unknown, dated };
}
