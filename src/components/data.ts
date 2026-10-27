import type { ComponentDef, RenderCtx, Tone, UiNode } from "../core/types.ts";
import { center, display, FOCUS_MARK, fit, type NumberFormat, padEnd, padStart, visibleWidth } from "../core/text.ts";
import { clamp, isObject, list, num, sameValue, str, toneOf } from "./util.ts";

interface Column extends NumberFormat {
	label: string;
	key: string | number;
	align?: string;
}

/** Whether a row of plain cells is a header: every cell text, matching the declared columns if any. */
function isHeader(row: unknown, declared: unknown[]): boolean {
	if (!Array.isArray(row) || row.length === 0 || !row.every((c) => typeof c === "string")) return false;
	if (declared.length === 0) return true;
	return declared.length === row.length && declared.every((c, i) => str(isObject(c) ? (c.label ?? c.key ?? c.name) : c) === row[i]);
}

/**
 * The data rows. Models often send [["Day", "Plan"], ["1", "…"]] with the header as the first row,
 * with or without also passing columns; that row becomes the header instead of data.
 */
function rowsOf(node: UiNode): unknown[] {
	const rows = list(node.rows);
	return rows.length > 1 && isHeader(rows[0], list(node.columns)) ? rows.slice(1) : rows;
}

function columnsOf(node: UiNode): Column[] {
	const rows = list(node.rows);
	const objectRows = isObject(rows[0]);
	const declared = list(node.columns);
	if (declared.length > 0) {
		return declared.map((c, i): Column => {
			if (!isObject(c)) return { label: str(c), key: objectRows ? str(c) : i };
			const label = str(c.label ?? c.key ?? c.name);
			return { label, key: (c.key as string | undefined) ?? (objectRows ? label : i), align: c.align as string | undefined, format: c.format, unit: c.unit, prefix: c.prefix };
		});
	}
	if (objectRows) return Object.keys(rows[0] as object).map((key) => ({ label: key, key }));
	if (rows.length > 1 && isHeader(rows[0], [])) return (rows[0] as string[]).map((label, i) => ({ label, key: i }));
	const width = Math.max(0, ...rows.map((r) => list(r).length));
	return Array.from({ length: width }, (_, i) => ({ label: "", key: i }));
}

function cell(row: unknown, column: Column): unknown {
	if (Array.isArray(row)) return row[column.key as number];
	if (!isObject(row)) return column.key === 0 ? row : undefined;
	const key = String(column.key);
	if (key in row) return row[key];
	const lower = key.toLowerCase();
	const match = Object.keys(row).find((k) => k.toLowerCase() === lower || k.toLowerCase().replace(/[\s_-]/g, "") === lower.replace(/[\s_-]/g, ""));
	return match ? row[match] : undefined;
}

interface TableLocal {
	index: number;
}

function selectedIndex(node: UiNode, ctx: { local: RenderCtx["local"]; state: Record<string, unknown> }, path: string): number {
	const rows = rowsOf(node);
	return ctx.local<TableLocal>(path, () => {
		const current = ctx.state[str(node.bind)];
		const found = rows.findIndex((r) => sameValue(rowValue(node, r), current));
		return { index: Math.max(0, found) };
	}).index;
}

function rowValue(node: UiNode, row: unknown): unknown {
	const key = str(node.valueKey);
	if (key && isObject(row)) return row[key];
	if (key && Array.isArray(row)) return row[Number(key)];
	return row;
}

export const table: ComponentDef = {
	doc: "[[…]]|[{…}] columns,maxRows; bind(+valueKey) makes rows pickable",
	main: "rows",
	required: ["rows"],
	focusable: (node) => typeof node.bind === "string" && rowsOf(node).length > 0,
	initial: (node) => {
		const first = rowsOf(node)[0];
		return first === undefined ? undefined : rowValue(node, first);
	},
	render(node, width, ctx, path) {
		const rows = rowsOf(node);
		const columns = columnsOf(node);
		if (columns.length === 0) return [];
		const pickable = typeof node.bind === "string";
		const focused = ctx.focus === path;
		const selected = pickable ? selectedIndex(node, ctx, path) : -1;
		const marker = pickable ? 2 : 0;

		const texts = rows.map((row) => columns.map((col) => display(cell(row, col), col)));
		const numeric = columns.map((_, c) => rows.length > 0 && rows.every((row) => {
			const v = cell(row, columns[c]!);
			return v === undefined || v === null || v === "" || typeof v === "number";
		}));
		const hasHeader = columns.some((c) => c.label);
		const widths = columns.map((col, c) => Math.min(48, Math.max(visibleWidth(col.label), ...texts.map((t) => visibleWidth(t[c]!)), 1)));
		const sep = 2;
		let total = widths.reduce((a, b) => a + b, 0) + sep * (columns.length - 1) + marker;
		while (total > width) {
			let widest = -1;
			for (let c = 0; c < widths.length; c++) if (widths[c]! > 4 && (widest < 0 || widths[c]! > widths[widest]!)) widest = c;
			if (widest < 0) break;
			widths[widest]!--;
			total--;
		}

		const alignCell = (text: string, c: number) => {
			const how = columns[c]!.align ?? (numeric[c] ? "right" : "left");
			if (how === "right") return padStart(fit(text, widths[c]!), widths[c]!);
			if (how === "center") return center(text, widths[c]!);
			return padEnd(text, widths[c]!);
		};
		const join = (cells: string[]) => cells.join(" ".repeat(sep));

		const out: string[] = [];
		if (hasHeader) {
			out.push(fit(" ".repeat(marker) + ctx.style.bold(join(columns.map((col, c) => alignCell(col.label, c)))), width));
			out.push(ctx.style.border(fit("─".repeat(Math.min(width, total)), width), false));
		}

		const maxRows = Math.max(1, Math.floor(num(node.maxRows, pickable ? 10 : 30)));
		let start = 0;
		if (rows.length > maxRows && selected >= 0) start = clamp(selected - Math.floor(maxRows / 2), 0, rows.length - maxRows);
		const end = Math.min(rows.length, start + maxRows);
		const hoveredRow = ctx.hover?.target.path === path ? ctx.hover.target.index : undefined;
		for (let r = start; r < end; r++) {
			const line = join(texts[r]!.map((t, c) => alignCell(t, c)));
			const rowTone = isObject(rows[r]) ? toneOf((rows[r] as Record<string, unknown>).tone) : undefined;
			let styled: string;
			if (r === selected && focused) styled = FOCUS_MARK + ctx.style.fg("accent", "❯ ") + ctx.style.inverse(line);
			else if (r === selected) styled = ctx.style.fg("accent", "● ") + ctx.style.fg("accent", line);
			else if (r === hoveredRow) styled = (pickable ? ctx.style.fg("accent", "○ ") : "") + ctx.style.bold(ctx.style.fg("accent", line));
			else styled = " ".repeat(marker) + (rowTone ? ctx.style.fg(rowTone, line) : line);
			out.push(ctx.hit({ path, kind: "row", index: r }, fit(styled, width)));
		}
		if (rows.length > end - start) {
			const note = start === 0 && !pickable ? `… ${rows.length - end} more rows` : `rows ${start + 1}–${end} of ${rows.length}`;
			out.push(ctx.style.fg("dim", fit(" ".repeat(marker) + note, width)));
		}
		if (rows.length === 0) out.push(ctx.style.fg("dim", "(no rows)"));
		return out;
	},
	handle(node, event, it, path) {
		const rows = rowsOf(node);
		const state = it.local<TableLocal>(path, () => ({ index: Math.max(0, rows.findIndex((r) => sameValue(rowValue(node, r), it.get(str(node.bind))))) }));
		const page = Math.max(1, Math.floor(num(node.maxRows, 10)) - 1);
		let next = state.index;
		if (event.key === "up") next--;
		else if (event.key === "down") next++;
		else if (event.key === "pageUp") next = Math.max(0, next - page);
		else if (event.key === "pageDown") next = Math.min(rows.length - 1, next + page);
		else if (event.key === "home") next = 0;
		else if (event.key === "end") next = rows.length - 1;
		else return false;
		if (next < 0 || next >= rows.length) return false;
		state.index = next;
		it.set(str(node.bind), rowValue(node, rows[next]));
		return true;
	},
	pointer(node, pointer, action, it, path) {
		const rows = rowsOf(node);
		const index = pointer.target.index ?? -1;
		if (typeof node.bind !== "string" || action !== "click" || index < 0 || index >= rows.length) return false;
		it.local<TableLocal>(path, () => ({ index: 0 })).index = index;
		it.set(node.bind, rowValue(node, rows[index]));
		return true;
	},
	// The full row, since narrow columns truncate cells.
	describe(node, pointer) {
		const row = rowsOf(node)[pointer.target.index ?? -1];
		if (row === undefined) return undefined;
		return columnsOf(node)
			.map((col) => {
				const value = display(cell(row, col), col);
				return col.label ? `${col.label}: ${value}` : value;
			})
			.join(" · ");
	},
};

interface TreeItem {
	label: string;
	note?: string;
	tone?: Tone;
	children: TreeItem[];
}

function treeItems(value: unknown): TreeItem[] {
	if (isObject(value) && !("label" in value) && !("name" in value) && !("title" in value)) {
		return Object.entries(value).map(([label, sub]) => ({ label, children: sub && typeof sub === "object" ? treeItems(sub) : sub === null || sub === undefined || sub === "" ? [] : [{ label: display(sub), children: [] }] }));
	}
	return list(isObject(value) ? [value] : value).flatMap((item): TreeItem[] => {
		if (!isObject(item)) return item === undefined || item === null ? [] : [{ label: display(item), children: [] }];
		return [{ label: str(item.label ?? item.name ?? item.title), note: item.note === undefined ? undefined : str(item.note), tone: toneOf(item.tone), children: treeItems(item.children ?? item.items ?? []) }];
	});
}

export const tree: ComponentDef = {
	doc: "{name:{child:{}}}|[{label,note,children}]",
	main: "items",
	required: ["items"],
	render(node, width, ctx) {
		const out: string[] = [];
		const draw = (items: TreeItem[], prefix: string, top: boolean) => {
			items.forEach((item, i) => {
				const last = i === items.length - 1;
				const connector = top ? "" : last ? "└─ " : "├─ ";
				let label = item.tone ? ctx.style.fg(item.tone, item.label) : item.children.length > 0 ? ctx.style.bold(item.label) : item.label;
				if (item.note) label += `  ${ctx.style.fg("muted", item.note)}`;
				out.push(fit(ctx.style.fg("dim", prefix + connector) + label, width));
				draw(item.children, top ? prefix : prefix + (last ? "   " : "│  "), false);
			});
		};
		draw(treeItems(node.items ?? node.data), "", true);
		return out;
	},
};

interface Step {
	label: string;
	note?: string;
	tone?: Tone;
}

function stepsOf(node: UiNode): Step[] {
	return list(node.steps ?? node.items).flatMap((s): Step[] => {
		if (isObject(s)) return [{ label: str(s.label ?? s.name ?? s.title), note: s.note === undefined ? undefined : str(s.note), tone: toneOf(s.tone) }];
		return s === undefined || s === null ? [] : [{ label: display(s) }];
	});
}

export const flow: ComponentDef = {
	doc: '["step"|{label,note}] active',
	main: "steps",
	required: ["steps"],
	render(node, width, ctx) {
		const steps = stepsOf(node);
		if (steps.length === 0) return [];
		const active = num(node.active);
		const hasNote = steps.some((s) => s.note);
		const paint = (i: number, s: string) => {
			const tone = i === active ? "accent" : steps[i]!.tone;
			return tone ? ctx.style.fg(tone, s) : ctx.style.border(s, false);
		};
		const labelOf = (i: number, w: number) => {
			const label = center(fit(steps[i]!.label, w), w);
			return i === active ? ctx.style.bold(ctx.style.fg("accent", label)) : ctx.style.bold(label);
		};
		const noteOf = (i: number, w: number) => ctx.style.fg("muted", center(fit(steps[i]!.note ?? "", w), w));
		const boxLines = (i: number, inner: number) => {
			const lines = [paint(i, `╭${"─".repeat(inner + 2)}╮`), `${paint(i, "│")} ${labelOf(i, inner)} ${paint(i, "│")}`];
			if (hasNote) lines.push(`${paint(i, "│")} ${noteOf(i, inner)} ${paint(i, "│")}`);
			lines.push(paint(i, `╰${"─".repeat(inner + 2)}╯`));
			return lines;
		};

		const inners = steps.map((s) => Math.max(visibleWidth(s.label), visibleWidth(s.note ?? ""), 3));
		const arrow = " ─▶ ";
		const horizontalWidth = inners.reduce((a, b) => a + b + 4, 0) + arrow.length * (steps.length - 1);
		if (node.direction !== "vertical" && horizontalWidth <= width) {
			const boxes = steps.map((_, i) => boxLines(i, inners[i]!));
			const labelRow = 1;
			return boxes[0]!.map((_, r) => boxes.map((b) => b[r]!).join(r === labelRow ? ctx.style.fg("muted", arrow) : " ".repeat(arrow.length)));
		}

		// Too wide for one row of boxes: a vertical timeline with notes beside the labels.
		const labelWidth = Math.min(Math.max(...steps.map((s) => visibleWidth(s.label))), Math.max(4, Math.floor(width * 0.45)));
		const out: string[] = [];
		steps.forEach((step, i) => {
			if (i > 0) out.push(ctx.style.fg("dim", " │"));
			const dot = i === active ? ctx.style.fg("accent", " ◉ ") : step.tone ? ctx.style.fg(step.tone, " ● ") : ctx.style.fg("muted", " ● ");
			const label = padEnd(fit(step.label, labelWidth), labelWidth);
			const styled = i === active ? ctx.style.bold(ctx.style.fg("accent", label)) : ctx.style.bold(label);
			out.push(fit(`${dot}${styled}${step.note ? `  ${ctx.style.fg("muted", step.note)}` : ""}`, width));
		});
		return out;
	},
};
