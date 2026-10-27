import type { ComponentDef, Pointer, RenderCtx, UiNode } from "../core/types.ts";
import { compact, display, fit, formatNumber, padEnd, padStart, visibleWidth } from "../core/text.ts";
import { EIGHTHS_V, clamp, hbar, isObject, items, list, num, type Point, points, str, toneOf } from "./util.ts";

function paintSeries(ctx: RenderCtx, node: UiNode, index: number, text: string): string {
	const tone = toneOf(node.tone ?? node.color);
	return tone ? ctx.style.fg(tone, text) : ctx.style.series(index, text);
}

function axisLabel(n: number, node: UiNode): string {
	if (node.format && node.format !== "number") return formatNumber(n, { ...node, format: node.format === "currency" ? "currency" : node.format === "percent" ? "percent" : "compact" });
	return compact(n);
}

function hoveredIndex(ctx: RenderCtx, path: string, kind: string): number | undefined {
	const target = ctx.hover?.target;
	return target?.path === path && target.kind === kind ? target.index : undefined;
}

/** Tallest chart, in rows. Models ask for pixel-like heights (150) that would fill the screen. */
const MAX_HEIGHT = 16;

/** "label: value", plus the share of the total when every value is positive. */
function describePoint(pts: Point[], index: number | undefined, node: UiNode): string | undefined {
	const p = pts[index ?? -1];
	if (!p) return undefined;
	const total = pts.reduce((sum, q) => sum + q.value, 0);
	const share = pts.length > 1 && pts.every((q) => q.value >= 0) && total > 0 ? ` (${Math.round((p.value / total) * 100)}% of total)` : "";
	return `${p.label}: ${formatNumber(p.value, node)}${share}`;
}

function barPoints(node: UiNode): Point[] {
	const pts = points(node.data);
	if (node.sort === "desc") return [...pts].sort((a, b) => b.value - a.value);
	if (node.sort === "asc") return [...pts].sort((a, b) => a.value - b.value);
	return pts;
}

const horizontalBars: ComponentDef = {
	doc: "",
	required: ["data"],
	render(node, width, ctx, path) {
		const pts = barPoints(node);
		if (pts.length === 0) return [ctx.style.fg("dim", "(no data)")];
		const max = num(node.max) ?? Math.max(...pts.map((p) => Math.abs(p.value)));
		const values = pts.map((p) => formatNumber(p.value, node));
		const valueWidth = Math.max(...values.map(visibleWidth));
		let labelWidth = Math.min(Math.max(...pts.map((p) => visibleWidth(p.label))), Math.floor(width * 0.35));
		const barWidth = Math.max(1, width - labelWidth - valueWidth - 2);
		if (labelWidth + valueWidth + 2 + barWidth > width) labelWidth = Math.max(0, width - valueWidth - 3);
		const hovered = hoveredIndex(ctx, path, "bar");
		return pts.map((p, i) => {
			const cells = max > 0 ? (Math.abs(p.value) / max) * barWidth : 0;
			const glyphs = hbar(Math.min(cells, barWidth));
			const paint = p.tone ? ctx.style.fg(p.tone, glyphs) : p.value < 0 ? ctx.style.fg("error", glyphs) : paintSeries(ctx, node, 0, glyphs);
			const label = padEnd(fit(p.label, labelWidth), labelWidth);
			const line = `${i === hovered ? ctx.style.inverse(label) : label} ${paint}${" ".repeat(Math.max(0, barWidth - visibleWidth(glyphs)))} ${i === hovered ? ctx.style.bold(padStart(values[i]!, valueWidth)) : padStart(values[i]!, valueWidth)}`;
			return ctx.hit({ path, kind: "bar", index: i }, fit(line, width));
		});
	},
	describe: (node, pointer) => describePoint(barPoints(node), pointer.target.index, node),
};

const verticalBars: ComponentDef = {
	doc: "",
	required: ["data"],
	render(node, width, ctx, path) {
		let pts = points(node.data);
		if (pts.length === 0) return [ctx.style.fg("dim", "(no data)")];
		const height = clamp(Math.floor(num(node.height, 8)), 3, MAX_HEIGHT);
		const max = num(node.max) ?? Math.max(0, ...pts.map((p) => p.value));
		const top = axisLabel(max, node);
		const labelWidth = Math.max(visibleWidth(top), 1);
		const plotWidth = Math.max(4, width - labelWidth - 2);
		let gap = plotWidth >= pts.length * 3 ? 1 : 0;
		let barWidth = clamp(Math.floor((plotWidth + gap) / pts.length) - gap, 1, 9);
		let dropped = 0;
		if (pts.length * (barWidth + gap) - gap > plotWidth) {
			gap = 0;
			barWidth = 1;
			dropped = pts.length - plotWidth;
			pts = pts.slice(0, plotWidth);
		}
		const usedWidth = pts.length * (barWidth + gap) - gap;
		const hovered = hoveredIndex(ctx, path, "column");
		const target = (i: number, text: string) => ctx.hit({ path, kind: "column", index: i }, text);
		const indent = " ".repeat(labelWidth + 2);
		const out: string[] = [];

		if (node.values) {
			const labels = pts.map((p) => fit(formatNumber(p.value, { ...node, format: node.format ?? "compact" }), barWidth));
			if (labels.every((l) => visibleWidth(l) <= barWidth)) {
				out.push(indent + labels.map((l, i) => target(i, i === hovered ? ctx.style.bold(padEnd(l, barWidth)) : padEnd(l, barWidth))).join(" ".repeat(gap)));
			}
		}
		for (let r = 0; r < height; r++) {
			const axis = r === 0 ? `${padStart(top, labelWidth)} ┤` : r === height - 1 ? `${padStart("0", labelWidth)} ┤` : `${" ".repeat(labelWidth)} │`;
			const cells = pts.map((p, i) => {
				const eighths = max > 0 ? (Math.max(0, p.value) / max) * height * 8 : 0;
				const fill = clamp(Math.round(eighths - (height - 1 - r) * 8), 0, 8);
				const glyph = EIGHTHS_V[fill]!.repeat(barWidth);
				return target(i, p.tone ? ctx.style.fg(p.tone, glyph) : paintSeries(ctx, node, 0, glyph));
			});
			out.push(ctx.style.fg("dim", axis) + cells.join(" ".repeat(gap)));
		}
		out.push(ctx.style.fg("dim", `${" ".repeat(labelWidth)} └${"─".repeat(usedWidth)}`));
		const xLabels = pts.map((p) => p.label);
		if (barWidth >= 3 || xLabels.every((l) => visibleWidth(l) <= barWidth)) {
			out.push(indent + xLabels.map((l, i) => target(i, i === hovered ? ctx.style.inverse(padEnd(fit(l, barWidth), barWidth)) : padEnd(fit(l, barWidth), barWidth))).join(" ".repeat(gap)));
		} else {
			out.push(edgeLabels(indent, xLabels[0]!, xLabels[xLabels.length - 1]!, usedWidth));
		}
		if (dropped > 0) out.push(ctx.style.fg("dim", `(${dropped} more not shown)`));
		return out.map((l) => fit(l, width));
	},
	describe: (node, pointer) => describePoint(points(node.data), pointer.target.index, node),
};

function edgeLabels(indent: string, first: string, last: string, width: number, middle?: string): string {
	const cells = Array.from({ length: width }, () => " ");
	const put = (text: string, at: number) => {
		for (let i = 0; i < text.length && at + i < width; i++) if (at + i >= 0) cells[at + i] = text[i]!;
	};
	put(first, 0);
	if (middle && width > first.length + last.length + middle.length + 4) put(middle, Math.floor((width - middle.length) / 2));
	if (width > first.length + last.length + 1) put(last, width - last.length);
	return indent + cells.join("").trimEnd();
}

interface Series {
	name: string;
	points: Array<{ x: number; y: number; i: number }>;
	explicitX: boolean;
}

/** The series a node lists. "series": "=xs" gives one series of plain numbers, not a list of series. */
function seriesList(node: UiNode): unknown[] {
	const given = list(node.series);
	return given.length > 0 && given.every((s) => typeof s === "number") ? [given] : given;
}

function seriesOf(node: UiNode): Series[] {
	// Map form: {"p50": [..], "p99": [..]} names one series per key.
	const named = isObject(node.data) && Object.values(node.data).every((v) => Array.isArray(v)) ? Object.entries(node.data).map(([name, data]) => ({ name, data })) : undefined;
	const listed = seriesList(node);
	const raw = listed.length > 0 ? listed : named ?? (node.data !== undefined ? [{ name: str(node.name ?? node.label), data: node.data }] : []);
	return raw.flatMap((s, si): Series[] => {
		const data = isObject(s) ? (s.data ?? s.values ?? s.points) : s;
		const fallback = raw.length > 1 ? `series ${si + 1}` : "";
		const name = isObject(s) ? str(s.name ?? s.label, fallback) : fallback;
		const pts: Series["points"] = [];
		let explicitX = false;
		items(data).forEach((p, i) => {
			if (typeof p === "number") pts.push({ x: i, y: p, i });
			else if (Array.isArray(p) && num(p[1]) !== undefined) {
				explicitX ||= num(p[0]) !== undefined;
				pts.push({ x: num(p[0], i), y: num(p[1])!, i });
			} else if (isObject(p) && num(p.y ?? p.value) !== undefined) {
				explicitX ||= num(p.x) !== undefined;
				pts.push({ x: num(p.x, i), y: num(p.y ?? p.value)!, i });
			}
		});
		return pts.length > 0 ? [{ name, points: pts.sort((a, b) => a.x - b.x), explicitX }] : [];
	});
}

interface LineModel {
	series: Series[];
	xMin: number;
	xMax: number;
	labels: string[];
}

function lineModel(node: UiNode): LineModel {
	const series = seriesOf(node);
	const xs = series.flatMap((s) => s.points.map((p) => p.x));
	return { series, xMin: Math.min(...xs), xMax: Math.max(...xs), labels: items(node.labels).map((l) => display(l)) };
}

/** Each series' point closest to the pointer's x. */
function nearest(model: LineModel, ratio: number): Array<{ series: Series; point: Series["points"][number] }> {
	const x = model.xMin + ratio * (model.xMax - model.xMin);
	return model.series.map((series) => ({
		series,
		point: series.points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best)),
	}));
}

const BRAILLE = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

const lineChart: ComponentDef = {
	doc: "",
	render(node, width, ctx, path) {
		const model = lineModel(node);
		const { series, xMin, xMax } = model;
		if (series.length === 0) return [ctx.style.fg("dim", "(no data)")];
		const height = clamp(Math.floor(num(node.height, 10)), 3, MAX_HEIGHT);
		const ys = series.flatMap((s) => s.points.map((p) => p.y));
		let yMin = num(node.yMin) ?? Math.min(...ys);
		let yMax = num(node.yMax) ?? Math.max(...ys);
		if (yMax === yMin) {
			yMax += 1;
			yMin -= yMin === 0 ? 0 : 1;
		}
		const yLabels = [axisLabel(yMax, node), axisLabel((yMax + yMin) / 2, node), axisLabel(yMin, node)];
		const labelWidth = Math.max(...yLabels.map(visibleWidth));
		const plotWidth = Math.max(4, width - labelWidth - 2);
		const dotsX = plotWidth * 2;
		const dotsY = height * 4;
		const bits = new Uint8Array(plotWidth * height);
		const owner = new Int16Array(plotWidth * height).fill(-1);
		const toX = (x: number) => (xMax === xMin ? 0 : Math.round(((x - xMin) / (xMax - xMin)) * (dotsX - 1)));
		const toY = (y: number) => Math.round(((yMax - clamp(y, yMin, yMax)) / (yMax - yMin)) * (dotsY - 1));
		const plot = (px: number, py: number, s: number) => {
			if (px < 0 || py < 0 || px >= dotsX || py >= dotsY) return;
			const cell = Math.floor(py / 4) * plotWidth + Math.floor(px / 2);
			bits[cell]! |= BRAILLE[py % 4]![px % 2]!;
			owner[cell] = s;
		};
		series.forEach((s, si) => {
			const pts = s.points;
			if (pts.length === 1) plot(toX(pts[0]!.x), toY(pts[0]!.y), si);
			for (let i = 1; i < pts.length; i++) {
				let x0 = toX(pts[i - 1]!.x);
				let y0 = toY(pts[i - 1]!.y);
				const x1 = toX(pts[i]!.x);
				const y1 = toY(pts[i]!.y);
				const dx = Math.abs(x1 - x0);
				const dy = -Math.abs(y1 - y0);
				const sx = x0 < x1 ? 1 : -1;
				const sy = y0 < y1 ? 1 : -1;
				let err = dx + dy;
				for (;;) {
					plot(x0, y0, si);
					if (x0 === x1 && y0 === y1) break;
					const e2 = 2 * err;
					if (e2 >= dy) {
						err += dy;
						x0 += sx;
					}
					if (e2 <= dx) {
						err += dx;
						y0 += sy;
					}
				}
			}
		});

		// Hover: a crosshair column, and a dot on each series where it crosses.
		const CROSSHAIR = -3;
		const marks = new Map<number, number>();
		let crosshair = -1;
		const hover = ctx.hover?.target.path === path && ctx.hover.target.kind === "plot" ? ctx.hover : undefined;
		if (hover) {
			const hits = nearest(model, hover.ratio);
			// Snap to the data, not the pointer, so the crosshair passes through the dots.
			crosshair = Math.floor(toX(hits[0]!.point.x) / 2);
			hits.forEach(({ point }, si) => {
				const cell = Math.floor(toY(point.y) / 4) * plotWidth + Math.floor(toX(point.x) / 2);
				marks.set(cell, si);
			});
		}

		const paintLine = (index: number, text: string) => (series.length === 1 ? paintSeries(ctx, node, 0, text) : ctx.style.series(index, text));
		const mid = Math.floor((height - 1) / 2);
		const out: string[] = [];
		for (let r = 0; r < height; r++) {
			const label = r === 0 ? yLabels[0]! : r === height - 1 ? yLabels[2]! : r === mid && height >= 5 ? yLabels[1]! : "";
			let cells = "";
			let run = "";
			let runOwner = -2;
			const flush = () => {
				if (run) cells += runOwner === CROSSHAIR ? ctx.style.fg("dim", run) : runOwner < 0 ? run : paintLine(runOwner, run);
				run = "";
			};
			for (let c = 0; c < plotWidth; c++) {
				const cell = r * plotWidth + c;
				const mark = marks.get(cell);
				let ch: string;
				let o: number;
				if (mark !== undefined) {
					ch = "●";
					o = mark;
				} else if (bits[cell]) {
					ch = String.fromCharCode(0x2800 + bits[cell]!);
					o = owner[cell]!;
				} else if (c === crosshair) {
					ch = "│";
					o = CROSSHAIR;
				} else {
					ch = " ";
					o = -1;
				}
				if (o !== runOwner) {
					flush();
					runOwner = o;
				}
				run += ch;
			}
			flush();
			out.push(ctx.style.fg("dim", `${padStart(label, labelWidth)} ${label ? "┤" : "│"}`) + ctx.hit({ path, kind: "plot" }, cells));
		}
		out.push(ctx.style.fg("dim", `${" ".repeat(labelWidth)} └${"─".repeat(plotWidth)}`));

		const { labels } = model;
		const indent = " ".repeat(labelWidth + 2);
		if (labels.length > 0) {
			const middle = labels.length > 2 ? labels[Math.floor((labels.length - 1) / 2)] : undefined;
			out.push(ctx.style.fg("muted", edgeLabels(indent, labels[0]!, labels[labels.length - 1]!, plotWidth, middle)));
		} else if (series.some((s) => s.explicitX)) {
			out.push(ctx.style.fg("muted", edgeLabels(indent, axisLabel(xMin, {} as UiNode), axisLabel(xMax, {} as UiNode), plotWidth)));
		}

		if (series.length > 1 || series[0]!.name) {
			out.push(indent + series.map((s, i) => `${paintLine(i, "━━")} ${s.name}`).join("   "));
		}
		return out.map((l) => fit(l, width));
	},
	describe(node, pointer) {
		const model = lineModel(node);
		if (model.series.length === 0) return undefined;
		const hits = nearest(model, pointer.ratio);
		const first = hits[0]!.point;
		const xLabel = model.labels[first.i] ?? (model.series[0]!.explicitX ? display(first.x) : "");
		const values = hits.map(({ series, point }) => `${series.name ? `${series.name} ` : ""}${formatNumber(point.y, node)}`);
		return [xLabel, ...values].filter(Boolean).join(" · ");
	},
};

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A sparkline's numbers: its data, or its first series. */
function sparkData(node: UiNode): unknown {
	if (node.data !== undefined) return node.data;
	const first = seriesList(node)[0];
	return isObject(first) ? (first.data ?? first.values) : first;
}

const sparkline: ComponentDef = {
	doc: "",
	render(node, width, ctx, path) {
		let values = points(sparkData(node)).map((p) => p.value);
		if (values.length === 0) return [ctx.style.fg("dim", "(no data)")];
		const label = str(node.label);
		const last = formatNumber(values[values.length - 1]!, node);
		const prefix = label ? `${ctx.style.fg("muted", label)} ` : "";
		const room = Math.max(4, width - visibleWidth(prefix) - visibleWidth(last) - 1);
		if (values.length > room) {
			const bucket = values.length / room;
			values = Array.from({ length: room }, (_, i) => {
				const slice = values.slice(Math.floor(i * bucket), Math.max(Math.floor(i * bucket) + 1, Math.floor((i + 1) * bucket)));
				return slice.reduce((a, b) => a + b, 0) / slice.length;
			});
		}
		const min = Math.min(...values);
		const max = Math.max(...values);
		const hover = ctx.hover?.target.path === path ? Math.round(ctx.hover.ratio * (values.length - 1)) : -1;
		const spark = values.map((v, i) => {
			const glyph = SPARKS[max === min ? 3 : Math.round(((v - min) / (max - min)) * 7)]!;
			return i === hover ? ctx.style.inverse(glyph) : glyph;
		});
		return [fit(`${prefix}${ctx.hit({ path, kind: "spark" }, paintSeries(ctx, node, 0, spark.join("")))} ${ctx.style.bold(last)}`, width)];
	},
	describe(node, pointer) {
		const pts = points(sparkData(node));
		const i = Math.round(pointer.ratio * (pts.length - 1));
		const p = pts[i];
		if (!p) return undefined;
		const labels = items(node.labels);
		return `${labels[i] !== undefined ? display(labels[i]) : `#${i + 1}`}: ${formatNumber(p.value, node)}`;
	},
};

function progressValues(node: UiNode): { value: number; max: number } {
	const value = num(node.value, 0);
	return { value, max: num(node.max) ?? (value <= 1 && !Number.isInteger(value) ? 1 : 100) };
}

export const progress: ComponentDef = {
	doc: "n max,label,tone",
	main: "value",
	required: ["value"],
	render(node, width, ctx, path) {
		const { value, max } = progressValues(node);
		const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;
		const label = str(node.label);
		const pct = `${Math.round(ratio * 100)}%`;
		// A shared minimum keeps stacked progress bars aligned without the model having to say so.
		const labelWidth = label ? Math.min(Math.max(visibleWidth(label), num(node.labelWidth, 8)), Math.floor(width * 0.4)) : 0;
		const barWidth = Math.max(4, width - labelWidth - (label ? 1 : 0) - 5);
		const filled = hbar(ratio * barWidth);
		const tone = toneOf(node.tone) ?? "accent";
		const track = ctx.style.fg("dim", "░".repeat(Math.max(0, barWidth - visibleWidth(filled))));
		const head = label ? `${padEnd(fit(label, labelWidth), labelWidth)} ` : "";
		const hovered = ctx.hover?.target.path === path;
		return [ctx.hit({ path, kind: "progress" }, fit(`${hovered ? ctx.style.bold(head) : head}${ctx.style.fg(tone, filled)}${track} ${padStart(pct, 4)}`, width))];
	},
	describe(node) {
		const { value, max } = progressValues(node);
		const label = str(node.label);
		return `${label ? `${label}: ` : ""}${formatNumber(value, node)} of ${formatNumber(max, node)}`;
	},
};

const SHADES = ["·", "░", "▒", "▓", "█"];

function heatmapLabels(node: UiNode): { rows: string[]; cols: string[] } {
	return { rows: list(node.rows).map((l) => display(l)), cols: list(node.cols ?? node.columns).map((l) => display(l)) };
}

export const heatmap: ComponentDef = {
	doc: "[[n]] rows,cols",
	main: "values",
	required: ["values"],
	render(node, width, ctx, path) {
		const matrix = list(node.values).map((r) => list(r).map((v) => num(v)));
		if (matrix.length === 0) return [ctx.style.fg("dim", "(no data)")];
		const { rows: rowLabels, cols: colLabels } = heatmapLabels(node);
		const cols = Math.max(...matrix.map((r) => r.length));
		const flat = matrix.flat().filter((v): v is number => v !== undefined);
		const min = Math.min(...flat);
		const max = Math.max(...flat);
		const labelWidth = Math.min(Math.max(0, ...rowLabels.map(visibleWidth)), Math.floor(width * 0.3));
		const room = width - labelWidth - (labelWidth ? 1 : 0);
		const cellWidth = clamp(Math.floor(room / Math.max(1, cols)), 1, Math.max(2, Math.min(6, Math.max(...colLabels.map(visibleWidth), 2) + 1)));
		const indent = " ".repeat(labelWidth + (labelWidth ? 1 : 0));
		const hover = ctx.hover?.target.path === path ? ctx.hover.target : undefined;
		const out: string[] = [];
		if (colLabels.length > 0 && cellWidth >= 2) {
			out.push(ctx.style.fg("muted", indent + colLabels.slice(0, cols).map((l, ci) => {
				const text = padEnd(fit(l, cellWidth - 1), cellWidth);
				return ci === hover?.col ? ctx.style.bold(text) : text;
			}).join("")));
		}
		matrix.forEach((r, ri) => {
			const label = padEnd(fit(rowLabels[ri] ?? "", labelWidth), labelWidth);
			const cells = Array.from({ length: cols }, (_, ci) => {
				const v = r[ci];
				if (v === undefined) return " ".repeat(cellWidth);
				const level = max === min ? 2 : Math.round(((v - min) / (max - min)) * (SHADES.length - 1));
				const glyph = SHADES[level]!.repeat(cellWidth > 2 ? cellWidth - 1 : cellWidth);
				const painted = hover?.row === ri && hover.col === ci ? ctx.style.inverse(glyph) : level === 0 ? ctx.style.fg("dim", glyph) : paintSeries(ctx, node, 0, glyph);
				return ctx.hit({ path, kind: "cell", row: ri, col: ci }, painted) + (cellWidth > 2 ? " " : "");
			});
			const head = labelWidth ? `${hover?.row === ri ? ctx.style.bold(label) : ctx.style.fg("muted", label)} ` : "";
			out.push(fit(head + cells.join(""), width));
		});
		out.push(fit(ctx.style.fg("dim", `${indent}${formatNumber(min, node)} `) + SHADES.map((s, i) => (i === 0 ? ctx.style.fg("dim", s) : paintSeries(ctx, node, 0, s))).join("") + ctx.style.fg("dim", ` ${formatNumber(max, node)}`), width));
		return out;
	},
	describe(node, pointer: Pointer) {
		const { row, col } = pointer.target;
		if (row === undefined || col === undefined) return undefined;
		const value = num(list(list(node.values)[row])[col]);
		if (value === undefined) return undefined;
		const { rows, cols } = heatmapLabels(node);
		const where = [rows[row], cols[col]].filter(Boolean).join(" · ");
		return `${where ? `${where}: ` : ""}${formatNumber(value, node)}`;
	},
};

/** Horizontal bars, or vertical columns with `vertical`. */
export const bar: ComponentDef = {
	doc: "{label:n}|[{label,value}] vertical,sort,max",
	main: "data",
	required: ["data"],
	render: (node, width, ctx, path) => (node.vertical ? verticalBars : horizontalBars).render(node, width, ctx, path),
	describe: (node, pointer) => (node.vertical ? verticalBars : horizontalBars).describe!(node, pointer),
};

/** {"line": {"series": [...], "labels": [...]}} puts the chart's props inside its data; lift them out. */
function lifted(node: UiNode): UiNode {
	const data = node.data;
	if (!isObject(data) || !("series" in data || "labels" in data)) return node;
	return { ...node, data: data.data, series: node.series ?? data.series, labels: node.labels ?? data.labels };
}

/** A braille line chart, or a one-line sparkline with `spark`. */
export const line: ComponentDef = {
	doc: '[n]|{"p50":[n],"p99":[n]} labels:[s],height,yMin,yMax,spark',
	main: "data",
	render: (node, width, ctx, path) => (node.spark ? sparkline : lineChart).render(lifted(node), width, ctx, path),
	describe: (node, pointer) => (node.spark ? sparkline : lineChart).describe!(lifted(node), pointer),
};
