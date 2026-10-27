import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export { visibleWidth };

/** Zero-width marker on lines that belong to the focused control; renderWidget strips it. */
export const FOCUS_MARK = "\x1b_genui:focus\x07";

export function fit(line: string, width: number): string {
	if (width <= 0) return "";
	return truncateToWidth(line, width, "…");
}

export function padEnd(line: string, width: number): string {
	const w = visibleWidth(line);
	if (w > width) return fit(line, width);
	return line + " ".repeat(width - w);
}

export function padStart(line: string, width: number): string {
	const w = visibleWidth(line);
	if (w > width) return fit(line, width);
	return " ".repeat(width - w) + line;
}

export function center(line: string, width: number): string {
	const w = visibleWidth(line);
	if (w >= width) return fit(line, width);
	const left = Math.floor((width - w) / 2);
	return " ".repeat(left) + line + " ".repeat(width - w - left);
}

export function wrap(text: string, width: number): string[] {
	if (width <= 0) return [];
	return wrapTextWithAnsi(text, width);
}

/** Wrap `text` after `prefix`, indenting continuation lines to the prefix width. */
export function wrapWithPrefix(prefix: string, text: string, width: number, indent?: string): string[] {
	const pw = visibleWidth(prefix);
	if (pw >= width) return wrap(prefix + text, width);
	const lines = wrap(text, width - pw);
	const cont = indent ?? " ".repeat(pw);
	return lines.map((line, i) => (i === 0 ? prefix : cont) + line);
}

export function maxWidth(lines: string[]): number {
	let max = 0;
	for (const line of lines) max = Math.max(max, visibleWidth(line));
	return max;
}

function trimZeros(text: string): string {
	return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

function plain(n: number): string {
	const abs = Math.abs(n);
	// Four-digit integers are more often ids and years than quantities: no separator.
	if (Number.isInteger(n)) return abs < 10000 ? String(n) : n.toLocaleString("en-US");
	if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
	if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
	return n.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

/** "-0" from rounding a tiny negative number reads as a bug. */
function unsignedZero(text: string): string {
	return /^-0(?:\.0*)?$/.test(text) ? text.slice(1) : text;
}

export function compact(n: number): string {
	const abs = Math.abs(n);
	for (const [size, suffix] of [
		[1e12, "T"],
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "k"],
	] as const) {
		if (abs >= size) {
			const scaled = n / size;
			return trimZeros(scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1)) + suffix;
		}
	}
	if (Number.isInteger(n) || abs >= 100) return unsignedZero(String(Math.round(n)));
	return unsignedZero(trimZeros(n.toFixed(abs >= 10 ? 1 : 2)));
}

/** Number formatting props; component nodes carry them directly, so any node can be passed. */
export interface NumberFormat {
	format?: unknown;
	unit?: unknown;
	prefix?: unknown;
	[prop: string]: unknown;
}

/** Formats: number (default), compact (1.2k), integer, percent (value already in 0-100), currency. */
export function formatNumber(n: number, opts: NumberFormat = {}): string {
	if (!Number.isFinite(n)) return "–";
	const format = typeof opts.format === "string" ? opts.format : "number";
	let prefix = typeof opts.prefix === "string" ? opts.prefix : "";
	let unit = typeof opts.unit === "string" ? opts.unit : "";
	// A currency symbol given as the unit goes in front: $470,000, not 470,000$.
	if (!prefix && /^[$€£¥]$/.test(unit)) [prefix, unit] = [unit, ""];
	let body: string;
	switch (format) {
		case "compact":
			body = compact(n);
			break;
		case "integer":
			body = Math.round(n).toLocaleString("en-US");
			break;
		case "percent":
			body = trimZeros(n.toFixed(Math.abs(n) >= 10 ? 0 : 1));
			unit ||= "%";
			break;
		case "currency":
			prefix ||= "$";
			body = Number.isInteger(n) || Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			break;
		default:
			body = plain(n);
	}
	body = unsignedZero(body);
	if (body.startsWith("-") && prefix) return `-${prefix}${body.slice(1)}${unit}`;
	return `${prefix}${body}${unit}`;
}

/** Turn any resolved value into display text. */
export function display(value: unknown, opts?: NumberFormat): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "number") return formatNumber(value, opts);
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (Array.isArray(value)) return value.map((v) => display(v, opts)).join(", ");
	// Markup a model made up, like {"b": "Name"}: show the value it wraps.
	const entries = Object.entries(value as object);
	if (entries.length === 1 && ["string", "number", "boolean"].includes(typeof entries[0]![1])) return display(entries[0]![1], opts);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
