import type { ComponentDef, UiNode } from "../core/types.ts";
import { fit, padEnd, visibleWidth } from "../core/text.ts";
import { childEntries, clamp, isObject, list, num, stack, str, toneOf } from "./util.ts";

export const col: ComponentDef = {
	doc: "[nodes] gap",
	main: "children",
	required: ["children"],
	nodeProps: ["children"],
	children: (node, path) => childEntries(node.children, path),
	render(node, width, ctx, path) {
		return stack(childEntries(node.children, path), width, ctx, num(node.gap, 1));
	},
};

const MIN_COLUMN = 16;

export const row: ComponentDef = {
	doc: "[nodes] side by side (children may set flex), stacks when narrow",
	main: "children",
	required: ["children"],
	nodeProps: ["children"],
	children: (node, path) => childEntries(node.children, path),
	render(node, width, ctx, path) {
		const kids = childEntries(node.children, path);
		if (kids.length === 0) return [];
		const gap = clamp(num(node.gap, 2), 0, 8);
		const available = width - gap * (kids.length - 1);
		const minWidth = num(node.minWidth, MIN_COLUMN);
		if (kids.length > 1 && available / kids.length < minWidth) return stack(kids, width, ctx, 1);

		const weights = kids.map((k) => Math.max(0.1, num((k.node as UiNode | undefined)?.flex, 1)));
		const total = weights.reduce((a, b) => a + b, 0);
		const widths = weights.map((w) => Math.floor((available * w) / total));
		widths[widths.length - 1]! += available - widths.reduce((a, b) => a + b, 0);

		const columns = kids.map((k, i) => ctx.renderChild(k.node, widths[i]!, k.path));
		const height = Math.max(0, ...columns.map((c) => c.length));
		const spacer = " ".repeat(gap);
		const out: string[] = [];
		for (let r = 0; r < height; r++) {
			out.push(columns.map((c, i) => padEnd(c[r] ?? "", widths[i]!)).join(spacer).trimEnd());
		}
		return out;
	},
};

export const box: ComponentDef = {
	doc: "[nodes] title,tone",
	main: "children",
	required: ["children"],
	nodeProps: ["children"],
	children: (node, path) => childEntries(node.children, path),
	render(node, width, ctx, path) {
		const kids = childEntries(node.children, path);
		const inner = width - 4;
		if (inner < 4) return stack(kids, width, ctx, num(node.gap, 1));
		const tone = toneOf(node.tone);
		const paint = (s: string) => (tone ? ctx.style.fg(tone, s) : ctx.style.border(s, false));
		const title = str(node.title);
		let top: string;
		if (title) {
			const label = fit(title, width - 6);
			top = paint("╭─ ") + ctx.style.bold(label) + paint(` ${"─".repeat(Math.max(0, width - 5 - visibleWidth(label)))}╮`);
		} else {
			top = paint(`╭${"─".repeat(width - 2)}╮`);
		}
		const body = stack(kids, inner, ctx, num(node.gap, 1));
		return [top, ...body.map((line) => `${paint("│")} ${padEnd(line, inner)} ${paint("│")}`), paint(`╰${"─".repeat(width - 2)}╯`)];
	},
};

interface TabsLocal {
	index: number;
}

function tabList(node: UiNode): Array<{ label: string; children: unknown }> {
	// Map form: {"Chart": [nodes], "Table": [nodes]}.
	if (isObject(node.tabs)) return Object.entries(node.tabs).map(([label, children]) => ({ label, children: Array.isArray(children) ? children : [children] }));
	return list(node.tabs).map((tab, i) => {
		const t = (tab ?? {}) as Record<string, unknown>;
		return { label: str(t.label ?? t.title, `Tab ${i + 1}`), children: t.children ?? t.view ?? (t.content ? [t.content] : []) };
	});
}

function activeTab(node: UiNode, local: (path: string, init: () => TabsLocal) => TabsLocal, path: string): number {
	const count = tabList(node).length;
	const state = local(path, () => ({ index: clamp(Math.floor(num(node.active, 0)), 0, Math.max(0, count - 1)) }));
	return clamp(state.index, 0, Math.max(0, count - 1));
}

export const tabs: ComponentDef = {
	doc: "{label:[nodes]}",
	main: "tabs",
	required: ["tabs"],
	nodeProps: ["tabs"],
	focusable: (node) => tabList(node).length > 1,
	navigational: true,
	children(node, path, local, all) {
		const items = tabList(node);
		const pick = all ? items.map((_, i) => i) : [activeTab(node, local, path)];
		return pick.flatMap((t) => childEntries(items[t]?.children, `${path}.t${t}`));
	},
	render(node, width, ctx, path) {
		const items = tabList(node);
		if (items.length === 0) return [];
		const index = activeTab(node, ctx.local, path);
		const focused = ctx.focus === path;
		const hoveredTab = ctx.hover?.target.path === path ? ctx.hover.target.index : undefined;
		const header = items
			.map((tab, i) => {
				const label = ` ${tab.label} `;
				let styled: string;
				if (i !== index) styled = i === hoveredTab ? ctx.style.fg("accent", label) : ctx.style.fg("muted", label);
				else styled = focused ? ctx.style.inverse(label) : ctx.style.fg("accent", ctx.style.bold(label));
				return ctx.hit({ path, kind: "tab", index: i }, styled);
			})
			.join(ctx.style.fg("dim", "│"));
		const lines = [fit(header, width), ctx.style.border("─".repeat(width), focused)];
		return [...lines, ...stack(childEntries(items[index]!.children, `${path}.t${index}`), width, ctx, num(node.gap, 1))];
	},
	handle(node, event, it, path) {
		const count = tabList(node).length;
		const state = it.local<TabsLocal>(path, () => ({ index: 0 }));
		if (event.key === "left" || event.key === "right") {
			state.index = (state.index + (event.key === "left" ? count - 1 : 1)) % count;
			return true;
		}
		const digit = Number(event.key);
		if (Number.isInteger(digit) && digit >= 1 && digit <= count) {
			state.index = digit - 1;
			return true;
		}
		return false;
	},
	pointer(node, pointer, action, it, path) {
		const index = pointer.target.index ?? -1;
		if (action !== "click" || index < 0 || index >= tabList(node).length) return false;
		it.local<TabsLocal>(path, () => ({ index: 0 })).index = index;
		return true;
	},
};

export const divider: ComponentDef = {
	doc: '"label"',
	main: "label",
	render(node, width, ctx) {
		const label = str(node.label);
		if (!label || width < 8) return [ctx.style.border("─".repeat(width), false)];
		const text = fit(label, width - 6);
		return [ctx.style.border("── ", false) + ctx.style.fg("muted", text) + ctx.style.border(` ${"─".repeat(Math.max(0, width - 4 - visibleWidth(text)))}`, false)];
	},
};

export const spacer: ComponentDef = {
	doc: "n",
	main: "lines",
	hidden: true,
	render(node) {
		return Array.from({ length: clamp(Math.floor(num(node.lines, 1)), 0, 10) }, () => "");
	},
};
