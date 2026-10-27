import { visibleWidth } from "./text.ts";

/** Something the pointer can land on. `index` picks an option, button, tab, row, bar, ... */
export interface HitTarget {
	path: string;
	kind: string;
	index?: number;
	row?: number;
	col?: number;
}

export interface HitRegion {
	line: number;
	start: number;
	end: number;
	target: HitTarget;
}

export interface Pointer {
	target: HitTarget;
	/** Horizontal position inside the region, 0 at its first column and 1 at its last. */
	ratio: number;
}

const MARKER = /\x1b_genui:(h\d+|e)\x07/g;

/** Collects targets during one render and wraps their text in zero-width markers. */
export class HitTable {
	readonly targets: HitTarget[] = [];

	wrap(target: HitTarget, text: string): string {
		this.targets.push(target);
		return `\x1b_genui:h${this.targets.length - 1}\x07${text}\x1b_genui:e\x07`;
	}
}

/** Strip hit markers, returning the clean lines and where each target ended up. */
export function extractHits(lines: string[], table: HitTable): { lines: string[]; regions: HitRegion[] } {
	const regions: HitRegion[] = [];
	const clean = lines.map((line, index) => {
		if (!line.includes("\x1b_genui:")) return line;
		const open: Array<{ id: number; start: number }> = [];
		let col = 0;
		let last = 0;
		let out = "";
		for (const match of line.matchAll(MARKER)) {
			const text = line.slice(last, match.index);
			out += text;
			col += visibleWidth(text);
			last = match.index! + match[0].length;
			if (match[1] === "e") {
				const region = open.pop();
				const target = region && table.targets[region.id];
				if (region && target && col > region.start) regions.push({ line: index, start: region.start, end: col, target });
			} else {
				open.push({ id: Number(match[1]!.slice(1)), start: col });
			}
		}
		const tail = line.slice(last);
		out += tail;
		col += visibleWidth(tail);
		// A region truncated before its end marker runs to the end of the line.
		for (const region of open) {
			const target = table.targets[region.id];
			if (target && col > region.start) regions.push({ line: index, start: region.start, end: col, target });
		}
		return out;
	});
	return { lines: clean, regions };
}

/** The innermost region under (x, y), with the pointer's position inside it. */
export function hitTest(regions: HitRegion[], x: number, y: number): Pointer | undefined {
	let best: HitRegion | undefined;
	for (const region of regions) {
		if (region.line !== y || x < region.start || x >= region.end) continue;
		if (!best || region.end - region.start < best.end - best.start) best = region;
	}
	if (!best) return undefined;
	return { target: best.target, ratio: ratioIn(best, x) };
}

export function ratioIn(region: Pick<HitRegion, "start" | "end">, x: number): number {
	const span = region.end - region.start - 1;
	return span <= 0 ? 0 : Math.min(1, Math.max(0, (x - region.start) / span));
}

export function sameTarget(a: HitTarget | undefined, b: HitTarget | undefined): boolean {
	return a?.path === b?.path && a?.kind === b?.kind && a?.index === b?.index && a?.row === b?.row && a?.col === b?.col;
}
