import type { RenderCtx, Tone, UiNode } from "../core/types.ts";
import { display, visibleWidth } from "../core/text.ts";

const TONES = new Set<Tone>(["text", "muted", "dim", "accent", "success", "warning", "error"]);
const TONE_ALIASES: Record<string, Tone> = { info: "accent", danger: "error", warn: "warning", ok: "success", primary: "accent" };

export function str(value: unknown, fallback = ""): string {
	const text = display(value);
	return text === "" ? fallback : text;
}

export function num(value: unknown, fallback: number): number;
export function num(value: unknown, fallback?: number): number | undefined;
export function num(value: unknown, fallback?: number): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return fallback;
}

export function toneOf(value: unknown): Tone | undefined {
	if (typeof value !== "string") return undefined;
	if (TONES.has(value as Tone)) return value as Tone;
	return TONE_ALIASES[value];
}

export function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/**
 * A list, also when a model wrapped an expression that already gives one in brackets: ["=xs"]
 * resolves to [[…]]. An [x, y] pair stays a pair.
 */
export function items(value: unknown): unknown[] {
	const out = list(value);
	return out.length === 1 && Array.isArray(out[0]) && out[0].length > 2 ? out[0] : out;
}

export function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function childEntries(value: unknown, path: string): Array<{ node: unknown; path: string }> {
	return list(value).map((node, i) => ({ node, path: `${path}.${i}` }));
}

// One-line controls read as a group when stacked, so runs of them get no blank lines between.
const ONE_LINERS = new Set(["slider", "range", "number", "toggle", "checkbox", "switch", "progress", "gauge", "meter", "progressbar", "sparkline", "spark"]);

function oneLiner(node: unknown): boolean {
	if (!node || typeof node !== "object") return false;
	// Long form names the type; shorthand leads with the component key.
	const type = (node as { type?: unknown }).type ?? Object.keys(node)[0];
	return typeof type === "string" && ONE_LINERS.has(type.toLowerCase().replace(/[\s_-]/g, ""));
}

/** In a run of stacked one-liners, give every labelled one the widest label so their bars line up. */
function alignLabels(children: Array<{ node: unknown; path: string }>): Array<{ node: unknown; path: string }> {
	const out = [...children];
	for (let start = 0; start < out.length; ) {
		let end = start;
		while (end < out.length && oneLiner(out[end]!.node)) end++;
		if (end - start > 1) {
			const widest = Math.max(...out.slice(start, end).map((c) => visibleWidth(str((c.node as UiNode).label))));
			for (let i = start; i < end; i++) {
				const node = out[i]!.node as UiNode;
				if (node.label !== undefined && node.labelWidth === undefined) out[i] = { ...out[i]!, node: { ...node, labelWidth: widest } };
			}
		}
		start = Math.max(end, start + 1);
	}
	return out;
}

/** Render children top to bottom with `gap` blank lines between non-empty children. */
export function stack(children: Array<{ node: unknown; path: string }>, width: number, ctx: RenderCtx, gap: number): string[] {
	const out: string[] = [];
	let previous: unknown;
	for (const child of alignLabels(children)) {
		const lines = ctx.renderChild(child.node, width, child.path);
		if (lines.length === 0) continue;
		const tight = oneLiner(previous) && oneLiner(child.node);
		if (out.length > 0 && !tight) for (let i = 0; i < gap; i++) out.push("");
		out.push(...lines);
		previous = child.node;
	}
	return out;
}

export interface Point {
	label: string;
	value: number;
	tone?: Tone;
}

const LABEL_KEYS = ["label", "name", "key", "x", "category", "title"];
const VALUE_KEYS = ["value", "y", "count", "v", "amount", "total"];

/** Accepts {label: value}, [[label, value]], [{label, value}] or plain numbers. */
export function points(data: unknown): Point[] {
	if (isObject(data)) {
		return Object.entries(data)
			.map(([label, value]) => ({ label, value: num(value, Number.NaN) }))
			.filter((p) => Number.isFinite(p.value));
	}
	const out: Point[] = [];
	items(data).forEach((item, i) => {
		if (typeof item === "number" || typeof item === "string") {
			const value = num(item);
			if (value !== undefined) out.push({ label: String(i + 1), value });
		} else if (Array.isArray(item)) {
			const value = num(item[1]);
			if (value !== undefined) out.push({ label: str(item[0]), value });
		} else if (isObject(item)) {
			const labelKey = LABEL_KEYS.find((k) => k in item);
			const valueKey = VALUE_KEYS.find((k) => k in item);
			const value = valueKey ? num(item[valueKey]) : undefined;
			if (value !== undefined) out.push({ label: labelKey ? str(item[labelKey]) : String(i + 1), value, tone: toneOf(item.tone ?? item.color) });
		}
	});
	return out;
}

export interface Option {
	label: string;
	value: unknown;
	description?: string;
}

export function options(value: unknown): Option[] {
	return list(value).flatMap((item): Option[] => {
		if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return [{ label: String(item), value: item }];
		if (isObject(item)) {
			const label = str(item.label ?? item.name ?? item.value);
			if (!label) return [];
			return [{ label, value: item.value ?? label, description: item.description === undefined ? undefined : str(item.description) }];
		}
		return [];
	});
}

export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
	return false;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export const EIGHTHS_H = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
export const EIGHTHS_V = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A horizontal bar `cells` long, with eighth-block precision. */
export function hbar(cells: number): string {
	if (!(cells > 0)) return "";
	const eighths = Math.round(cells * 8);
	return "█".repeat(Math.floor(eighths / 8)) + EIGHTHS_H[eighths % 8];
}
