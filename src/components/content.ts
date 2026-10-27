import type { ComponentDef, Tone } from "../core/types.ts";
import { center, display, fit, padEnd, padStart, visibleWidth, wrap, wrapWithPrefix } from "../core/text.ts";
import { clamp, isObject, list, num, str, toneOf } from "./util.ts";

function align(lines: string[], width: number, how: unknown): string[] {
	if (how === "center") return lines.map((l) => center(l, width).trimEnd());
	if (how === "right") return lines.map((l) => padStart(l, width));
	return lines;
}

export const text: ComponentDef = {
	doc: '"…" style:heading|bold|muted,tone,align',
	main: "text",
	required: ["text"],
	render(node, width, ctx) {
		let value = str(node.text);
		if (node.style === "heading") return align(wrap(ctx.style.heading(value), width), width, node.align);
		const tone = toneOf(node.tone) ?? (node.style === "muted" ? "muted" : undefined);
		if (node.bold || node.style === "bold") value = ctx.style.bold(value);
		if (node.italic) value = ctx.style.italic(value);
		if (tone) value = ctx.style.fg(tone, value);
		return align(wrap(value, width), width, node.align);
	},
};

export const md: ComponentDef = {
	doc: '"markdown"',
	main: "text",
	required: ["text"],
	render(node, width, ctx) {
		const source = str(node.text);
		return ctx.style.markdown ? ctx.style.markdown(source, width) : wrap(source, width);
	},
};

const CALLOUT_TONES: Record<string, Tone> = { info: "accent", note: "accent", tip: "success", success: "success", warning: "warning", error: "error", danger: "error" };

export const note: ComponentDef = {
	doc: '"…" title,tone:info|success|warning|error',
	main: "text",
	required: ["text"],
	render(node, width, ctx) {
		const tone = CALLOUT_TONES[str(node.tone, "info")] ?? toneOf(node.tone) ?? "accent";
		const bar = ctx.style.fg(tone, "▌ ");
		const lines: string[] = [];
		const title = str(node.title);
		if (title) lines.push(...wrapWithPrefix(bar, ctx.style.fg(tone, ctx.style.bold(title)), width, bar));
		lines.push(...wrapWithPrefix(bar, str(node.text), width, bar));
		return lines;
	},
};

export const code: ComponentDef = {
	doc: '"source" title',
	main: "code",
	hidden: true,
	required: ["code"],
	render(node, width, ctx) {
		const source = str(node.code ?? node.text).replace(/\t/g, "  ");
		const lines = source.split("\n");
		const numbered = node.lineNumbers !== false && lines.length > 1;
		const gutter = numbered ? String(lines.length).length : 0;
		const out: string[] = [];
		const title = str(node.title);
		if (title) out.push(ctx.style.fg("muted", fit(title, width)));
		lines.forEach((line, i) => {
			const prefix = numbered ? ctx.style.fg("dim", `${padStart(String(i + 1), gutter)} │ `) : ctx.style.fg("dim", "│ ");
			out.push(prefix + ctx.style.fg("text", fit(line, width - visibleWidth(prefix))));
		});
		return out;
	},
};

export const list_: ComponentDef = {
	doc: '["item"] ordered',
	main: "items",
	hidden: true,
	required: ["items"],
	render(node, width, ctx) {
		const items = list(node.items);
		const ordered = !!node.ordered;
		const markerWidth = ordered ? String(items.length).length + 2 : 2;
		return items.flatMap((item, i) => {
			const marker = ordered ? padEnd(`${i + 1}.`, markerWidth) : "• ";
			return wrapWithPrefix(ctx.style.fg("muted", marker), display(item), width);
		});
	},
};

function pairs(value: unknown): Array<[string, unknown]> {
	if (isObject(value)) return Object.entries(value);
	return list(value).flatMap((item): Array<[string, unknown]> => {
		if (Array.isArray(item)) return [[str(item[0]), item[1]]];
		if (isObject(item)) return [[str(item.label ?? item.key ?? item.name), item.value]];
		return [];
	});
}

export const kv: ComponentDef = {
	doc: "{key:value}",
	main: "items",
	required: ["items"],
	render(node, width, ctx) {
		const entries = pairs(node.items);
		if (entries.length === 0) return [];
		const keyWidth = clamp(Math.max(...entries.map(([k]) => visibleWidth(k))), 1, Math.max(4, Math.floor(width * 0.4)));
		return entries.flatMap(([key, value]) => {
			const prefix = ctx.style.fg("muted", padEnd(fit(key, keyWidth), keyWidth)) + "  ";
			return wrapWithPrefix(prefix, display(value, node), width);
		});
	},
};

export const stat: ComponentDef = {
	doc: '"label" value,delta,caption,tone,invert(lower is better)',
	main: "label",
	required: ["label", "value"],
	render(node, width, ctx) {
		const tone = toneOf(node.tone);
		const value = typeof node.value === "number" ? display(node.value, node) : str(node.value);
		let line = ctx.style.bold(tone ? ctx.style.fg(tone, value) : value);
		const delta = node.delta;
		if (delta !== undefined && delta !== null && delta !== "") {
			const n = num(delta);
			let text = typeof delta === "number" ? display(Math.abs(delta), { format: node.deltaFormat ?? "number", unit: node.deltaUnit }) : str(delta);
			let deltaTone: Tone = "muted";
			if (n !== undefined && n !== 0) {
				const good = node.invert ? n < 0 : n > 0;
				deltaTone = good ? "success" : "error";
				if (typeof delta === "number") text = `${n > 0 ? "▲" : "▼"} ${text}`;
			}
			line += `  ${ctx.style.fg(deltaTone, text)}`;
		}
		const out = [ctx.style.fg("muted", fit(str(node.label), width)), fit(line, width)];
		const caption = str(node.caption);
		if (caption) out.push(...wrap(ctx.style.fg("dim", caption), width));
		return out;
	},
};
