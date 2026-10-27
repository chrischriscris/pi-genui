import type { ComponentDef, Interaction, RenderCtx, UiNode } from "../core/types.ts";
import { display, FOCUS_MARK, fit, formatNumber, padEnd, padStart, visibleWidth, wrap, wrapWithPrefix } from "../core/text.ts";
import { clamp, isObject, list, num, options, sameValue, str, toneOf } from "./util.ts";

function gutter(ctx: RenderCtx, active: boolean): string {
	return active ? FOCUS_MARK + ctx.style.fg("accent", "❯ ") : "  ";
}

function labelLine(node: UiNode, width: number, ctx: RenderCtx, focused: boolean): string[] {
	const label = str(node.label);
	if (!label) return [];
	const styled = ctx.style.bold(label);
	return wrap(focused ? ctx.style.fg("accent", styled) : styled, width);
}

function bindOf(node: UiNode): string {
	return str(node.bind);
}

function digitIndex(key: string): number | undefined {
	const n = Number(key);
	return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : undefined;
}

function hovered(ctx: RenderCtx, path: string, kind: string, index?: number): boolean {
	const target = ctx.hover?.target;
	return target?.path === path && target.kind === kind && (index === undefined || target.index === index);
}

/** Lay `parts` out on one line, each its own target; fall back to wrapped plain text when too wide. */
function inlineTargets(ctx: RenderCtx, prefix: string, parts: string[], sep: string, width: number, target: (i: number) => Parameters<RenderCtx["hit"]>[0]): string[] {
	const plain = prefix + parts.join(sep);
	if (visibleWidth(plain) > width) return wrapWithPrefix(prefix, parts.join(sep), width);
	return [prefix + parts.map((p, i) => ctx.hit(target(i), p)).join(sep)];
}

export const select: ComponentDef = {
	doc: '"key" options:["…"|{label,value,description}],label,inline',
	main: "bind",
	required: ["bind", "options"],
	focusable: () => true,
	initial: (node) => options(node.options)[0]?.value,
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const current = ctx.state[bindOf(node)];
		const opts = options(node.options);
		const out = labelLine(node, width, ctx, focused);
		if (node.inline) {
			const parts = opts.map((o, i) => {
				const on = sameValue(o.value, current);
				const mark = on ? ctx.style.fg("accent", "●") : ctx.style.fg("muted", "○");
				const label = on ? ctx.style.bold(focused ? ctx.style.fg("accent", o.label) : o.label) : hovered(ctx, path, "option", i) ? ctx.style.fg("accent", o.label) : o.label;
				return `${mark} ${label}`;
			});
			out.push(...inlineTargets(ctx, gutter(ctx, focused), parts, "   ", width, (index) => ({ path, kind: "option", index })));
			return out;
		}
		opts.forEach((o, i) => {
			const on = sameValue(o.value, current);
			const prefix = gutter(ctx, focused && on) + (on ? ctx.style.fg("accent", "●") : ctx.style.fg("muted", "○")) + " ";
			const label = on ? ctx.style.bold(o.label) : hovered(ctx, path, "option", i) ? ctx.style.fg("accent", o.label) : o.label;
			const desc = o.description ? ctx.style.fg("muted", o.description) : "";
			const lines: string[] = [];
			if (desc && visibleWidth(prefix) + visibleWidth(o.label) + 2 + visibleWidth(o.description!) <= width) lines.push(`${prefix}${label}  ${desc}`);
			else {
				lines.push(fit(prefix + label, width));
				if (desc) lines.push(...wrapWithPrefix("    ", desc, width));
			}
			out.push(...lines.map((line) => ctx.hit({ path, kind: "option", index: i }, line)));
		});
		return out;
	},
	handle(node, event, it) {
		const opts = options(node.options);
		const bind = bindOf(node);
		const index = opts.findIndex((o) => sameValue(o.value, it.get(bind)));
		const back = node.inline ? "left" : "up";
		const forward = node.inline ? "right" : "down";
		let next: number | undefined;
		if (event.key === back) next = index - 1;
		else if (event.key === forward) next = index + 1;
		else next = digitIndex(event.key);
		if (next === undefined) return false;
		if (next < 0 || next >= opts.length) return node.inline ? true : false;
		it.set(bind, opts[next]!.value);
		return true;
	},
	pointer(node, pointer, action, it) {
		const option = options(node.options)[pointer.target.index ?? -1];
		if (!option || action !== "click") return false;
		it.set(bindOf(node), option.value);
		return true;
	},
};

interface CursorLocal {
	cursor: number;
}

function chosen(it: Pick<Interaction, "get">, node: UiNode): unknown[] {
	return list(it.get(bindOf(node)));
}

function toggleOption(node: UiNode, it: Interaction, index: number): void {
	const opts = options(node.options);
	const option = opts[index];
	if (!option) return;
	const current = chosen(it, node);
	const has = current.some((v) => sameValue(v, option.value));
	const next = has ? current.filter((v) => !sameValue(v, option.value)) : [...current, option.value];
	it.set(bindOf(node), opts.filter((o) => next.some((v) => sameValue(v, o.value))).map((o) => o.value));
}

export const multi: ComponentDef = {
	doc: '"key" options,label',
	main: "bind",
	required: ["bind", "options"],
	focusable: () => true,
	initial: () => [],
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const values = list(ctx.state[bindOf(node)]);
		const cursor = ctx.local<CursorLocal>(path, () => ({ cursor: 0 })).cursor;
		const out = labelLine(node, width, ctx, focused);
		options(node.options).forEach((o, i) => {
			const on = values.some((v) => sameValue(v, o.value));
			const box = on ? ctx.style.fg("accent", "[x]") : ctx.style.fg("muted", "[ ]");
			const prefix = `${gutter(ctx, focused && i === cursor)}${box} `;
			const desc = o.description ? `  ${ctx.style.fg("muted", o.description)}` : "";
			const label = on ? ctx.style.bold(o.label) : hovered(ctx, path, "check", i) ? ctx.style.fg("accent", o.label) : o.label;
			out.push(ctx.hit({ path, kind: "check", index: i }, fit(prefix + label + desc, width)));
		});
		return out;
	},
	handle(node, event, it, path) {
		const opts = options(node.options);
		const local = it.local<CursorLocal>(path, () => ({ cursor: 0 }));
		if (event.key === "up" || event.key === "down") {
			const next = local.cursor + (event.key === "up" ? -1 : 1);
			if (next < 0 || next >= opts.length) return false;
			local.cursor = next;
			return true;
		}
		const digit = digitIndex(event.key);
		if (event.key !== "space" && digit === undefined) return false;
		const index = digit ?? local.cursor;
		if (index < opts.length) {
			local.cursor = index;
			toggleOption(node, it, index);
		}
		return true;
	},
	pointer(node, pointer, action, it, path) {
		const index = pointer.target.index ?? -1;
		if (action !== "click" || index < 0) return false;
		it.local<CursorLocal>(path, () => ({ cursor: 0 })).cursor = index;
		toggleOption(node, it, index);
		return true;
	},
};

export const input: ComponentDef = {
	doc: '"key" label,placeholder',
	main: "bind",
	required: ["bind"],
	focusable: () => true,
	initial: () => "",
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const value = display(ctx.state[bindOf(node)]);
		const out = labelLine(node, width, ctx, focused);
		const room = Math.max(1, width - 2);
		let field: string;
		if (focused) {
			const cursor = clamp(ctx.local<CursorLocal>(path, () => ({ cursor: value.length })).cursor, 0, value.length);
			const start = Math.max(0, cursor - room + 1);
			const visible = value.slice(start, start + room);
			const at = cursor - start;
			field = visible.slice(0, at) + ctx.style.inverse(visible[at] ?? " ") + visible.slice(at + 1);
			if (!value && node.placeholder) field += ctx.style.fg("dim", str(node.placeholder));
		} else if (value) {
			field = value;
		} else {
			field = ctx.style.fg("dim", str(node.placeholder, "…"));
		}
		const rule = ctx.style.border("─".repeat(Math.min(room, Math.max(12, visibleWidth(value) + 1))), focused || hovered(ctx, path, "input"));
		out.push(ctx.hit({ path, kind: "input" }, fit(gutter(ctx, focused) + field, width)), `  ${rule}`);
		return out;
	},
	handle(node, event, it, path) {
		const bind = bindOf(node);
		const value = display(it.get(bind));
		const local = it.local<CursorLocal>(path, () => ({ cursor: value.length }));
		local.cursor = clamp(local.cursor, 0, value.length);
		const c = local.cursor;
		if (event.text !== undefined && event.key !== "enter" && event.key !== "tab") {
			it.set(bind, value.slice(0, c) + event.text + value.slice(c));
			local.cursor = c + event.text.length;
			return true;
		}
		switch (event.key) {
			case "backspace":
				if (c > 0) it.set(bind, value.slice(0, c - 1) + value.slice(c));
				local.cursor = Math.max(0, c - 1);
				return true;
			case "delete":
				it.set(bind, value.slice(0, c) + value.slice(c + 1));
				return true;
			case "left":
				local.cursor = Math.max(0, c - 1);
				return true;
			case "right":
				local.cursor = Math.min(value.length, c + 1);
				return true;
			case "home":
			case "ctrl+a":
				local.cursor = 0;
				return true;
			case "end":
			case "ctrl+e":
				local.cursor = value.length;
				return true;
			case "ctrl+u":
				it.set(bind, value.slice(c));
				local.cursor = 0;
				return true;
			default:
				return false;
		}
	},
	// Clicking only moves focus here, which the runtime does for any focusable control.
	pointer: () => false,
};

function range(node: UiNode): { min: number; max: number; step: number } {
	const min = num(node.min, 0);
	const max = Math.max(min, num(node.max, 100));
	const span = max - min;
	const step = num(node.step) ?? (span >= 100 ? 1 : span / 100);
	return { min, max, step: step > 0 ? step : 1 };
}

function snap(value: number, node: UiNode): number {
	const { min, max, step } = range(node);
	const decimals = (String(step).split(".")[1] ?? "").length;
	return clamp(Number((Math.round((value - min) / step) * step + min).toFixed(Math.min(10, decimals))), min, max);
}

export const slider: ComponentDef = {
	doc: '"key" min,max,step,label',
	main: "bind",
	required: ["bind"],
	focusable: () => true,
	initial: (node) => range(node).min,
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const { min, max } = range(node);
		const value = num(ctx.state[bindOf(node)], min);
		const label = str(node.label);
		const shown = formatNumber(value, node);
		// Shared minimums keep a stack of sliders aligned.
		const valueWidth = Math.max(visibleWidth(shown), visibleWidth(formatNumber(max, node)), visibleWidth(formatNumber(min, node)), 7);
		const labelWidth = label ? Math.min(Math.max(visibleWidth(label), num(node.labelWidth, 10)), Math.floor(width * 0.35)) : 0;
		const track = Math.max(5, width - 2 - labelWidth - (label ? 1 : 0) - valueWidth - 2);
		const pos = max > min ? Math.round(((clamp(value, min, max) - min) / (max - min)) * (track - 1)) : 0;
		const active = focused || hovered(ctx, path, "slider");
		const bar = ctx.style.fg(active ? "accent" : "muted", "━".repeat(pos)) + (active ? ctx.style.fg("accent", ctx.style.bold("●")) : "●") + ctx.style.fg("dim", "─".repeat(track - 1 - pos));
		const head = label ? `${padEnd(fit(focused ? ctx.style.fg("accent", label) : label, labelWidth), labelWidth)} ` : "";
		const line = `${gutter(ctx, focused)}${head}${ctx.hit({ path, kind: "slider" }, bar)}  ${ctx.style.bold(padStart(shown, valueWidth))}`;
		return [ctx.hit({ path, kind: "control" }, fit(line, width))];
	},
	handle(node, event, it) {
		const { min, max, step } = range(node);
		const bind = bindOf(node);
		const value = num(it.get(bind), min);
		let next: number;
		switch (event.key) {
			case "left":
				next = value - step;
				break;
			case "right":
				next = value + step;
				break;
			case "shift+left":
			case "pageDown":
				next = value - step * 10;
				break;
			case "shift+right":
			case "pageUp":
				next = value + step * 10;
				break;
			case "home":
				next = min;
				break;
			case "end":
				next = max;
				break;
			default:
				return false;
		}
		it.set(bind, snap(clamp(next, min, max), node));
		return true;
	},
	pointer(node, pointer, _action, it) {
		if (pointer.target.kind !== "slider") return false;
		const { min, max } = range(node);
		const next = snap(min + pointer.ratio * (max - min), node);
		if (next === it.get(bindOf(node))) return false;
		it.set(bindOf(node), next);
		return true;
	},
	describe(node, pointer) {
		if (pointer.target.kind !== "slider") return undefined;
		const { min, max } = range(node);
		return `${str(node.label, bindOf(node))}: ${formatNumber(snap(min + pointer.ratio * (max - min), node), node)}`;
	},
};

export const toggle: ComponentDef = {
	doc: '"key" label',
	main: "bind",
	required: ["bind"],
	focusable: () => true,
	initial: () => false,
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const on = !!ctx.state[bindOf(node)];
		const box = on ? ctx.style.fg("accent", "[x]") : ctx.style.fg("muted", "[ ]");
		const label = str(node.label, bindOf(node));
		const styled = focused || hovered(ctx, path, "toggle") ? ctx.style.fg("accent", label) : label;
		return wrapWithPrefix(`${gutter(ctx, focused)}${box} `, styled, width).map((line) => ctx.hit({ path, kind: "toggle" }, line));
	},
	handle(node, event, it) {
		if (event.key !== "space" && event.key !== "left" && event.key !== "right") return false;
		it.set(bindOf(node), !it.get(bindOf(node)));
		return true;
	},
	pointer(node, _pointer, action, it) {
		if (action !== "click") return false;
		it.set(bindOf(node), !it.get(bindOf(node)));
		return true;
	},
};

interface Button {
	label: string;
	action: string;
	tone?: ReturnType<typeof toneOf>;
}

function buttonList(node: UiNode): Button[] {
	const raw = list(node.buttons).length > 0 ? list(node.buttons) : node.label !== undefined ? [node] : [];
	return raw.flatMap((b): Button[] => {
		if (isObject(b)) {
			const label = str(b.label ?? b.action);
			return label ? [{ label, action: str(b.action ?? b.value, label), tone: toneOf(b.tone) }] : [];
		}
		return b === undefined || b === null ? [] : [{ label: display(b), action: display(b) }];
	});
}

export const buttons: ComponentDef = {
	doc: '["Label"|{label,action,tone}] pressing one answers',
	main: "buttons",
	required: ["buttons"],
	focusable: (node) => buttonList(node).length > 0,
	render(node, width, ctx, path) {
		const focused = ctx.focus === path;
		const index = ctx.local<CursorLocal>(path, () => ({ cursor: 0 })).cursor;
		const parts = buttonList(node).map((b, i) => {
			const face = ` ${b.label} `;
			if (focused && i === index) return ctx.style.inverse(ctx.style.bold(face));
			if (hovered(ctx, path, "button", i)) return ctx.style.fg("accent", ctx.style.bold(`[${face}]`));
			const tone = b.tone ?? (i === 0 ? "accent" : "muted");
			return ctx.style.fg(tone, `[${face}]`);
		});
		return inlineTargets(ctx, gutter(ctx, focused), parts, "  ", width, (i) => ({ path, kind: "button", index: i }));
	},
	handle(node, event, it, path) {
		if (event.key !== "left" && event.key !== "right") return false;
		const count = buttonList(node).length;
		const local = it.local<CursorLocal>(path, () => ({ cursor: 0 }));
		local.cursor = clamp(local.cursor + (event.key === "left" ? -1 : 1), 0, count - 1);
		return true;
	},
	activate(node, it, path) {
		const all = buttonList(node);
		const button = all[clamp(it.local<CursorLocal>(path, () => ({ cursor: 0 })).cursor, 0, all.length - 1)];
		return button ? { status: "submitted", action: button.action } : undefined;
	},
	pointer(node, pointer, action, it, path) {
		const index = pointer.target.index ?? -1;
		const button = buttonList(node)[index];
		if (!button || action !== "click") return false;
		it.local<CursorLocal>(path, () => ({ cursor: 0 })).cursor = index;
		return { status: "submitted", action: button.action };
	},
};
