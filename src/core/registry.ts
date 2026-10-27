import { bar, heatmap, line, progress } from "../components/charts.ts";
import { code, kv, list_, md, note, stat, text } from "../components/content.ts";
import { flow, table, tree } from "../components/data.ts";
import { buttons, input, multi, select, slider, toggle } from "../components/inputs.ts";
import { box, col, divider, row, spacer, tabs } from "../components/layout.ts";
import type { ComponentDef, UiNode } from "./types.ts";

const components = new Map<string, ComponentDef>();
const aliases = new Map<string, { kind: string; defaults?: Record<string, unknown> }>();

function key(name: string): string {
	return name.toLowerCase().replace(/[\s_-]/g, "");
}

/** Add or replace a component. Aliases may preset props, as "heading" presets text's style. */
export function registerComponent(name: string, def: ComponentDef, alias: Record<string, Record<string, unknown> | undefined> = {}): void {
	components.set(key(name), def);
	for (const [a, defaults] of Object.entries(alias)) aliases.set(key(a), { kind: key(name), defaults });
}

export function componentNames(includeHidden = false): string[] {
	return [...components.entries()].filter(([, def]) => includeHidden || !def.hidden).map(([name]) => name);
}

export function componentDef(name: string): ComponentDef | undefined {
	return components.get(key(name));
}

interface Kind {
	name: string;
	def: ComponentDef;
	defaults?: Record<string, unknown>;
}

function lookup(name: string): Kind | undefined {
	const k = key(name);
	const def = components.get(k);
	if (def) return { name: k, def };
	const alias = aliases.get(k);
	const target = alias && components.get(alias.kind);
	return alias && target ? { name: alias.kind, def: target, defaults: alias.defaults } : undefined;
}

/**
 * Normalize a raw node. Long form: {"type": "bar", "data": ...}. Shorthand: {"bar": ...}, where the
 * component key holds its main prop. A component name wins over an alias that is also a common
 * prop name, so {"label": "CPU", "progress": 42} is a progress bar.
 */
export function toNode(raw: unknown): UiNode | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.type === "string") {
		// "columns" is vertical bars, but with children and no data it means a layout row.
		if (key(obj.type) === "columns" && obj.children !== undefined && obj.data === undefined) return { ...obj, type: "row" };
		const kind = lookup(obj.type);
		return kind ? { ...kind.defaults, ...obj, type: kind.name } : (obj as UiNode);
	}
	const keys = Object.keys(obj);
	const first = keys[0];
	const canonical = keys.find((k) => components.has(key(k)));
	const pick = first && components.has(key(first)) ? first : (canonical ?? (first && lookup(first) ? first : undefined));
	if (!pick) return undefined;
	const { [pick]: main, ...rest } = obj;
	if (key(pick) === "columns" && Array.isArray(main) && main.some((m) => m && typeof m === "object" && !Array.isArray(m) && toNode(m))) {
		return { ...rest, type: "row", children: main };
	}
	const kind = lookup(pick)!;
	const node: UiNode = { ...kind.defaults, ...rest, type: kind.name };
	if (kind.def.main && main !== undefined && main !== null && main !== true) node[kind.def.main] = main;
	return node;
}

export function kindOf(node: UiNode): string | undefined {
	return lookup(node.type)?.name;
}

export function defOf(node: UiNode): ComponentDef | undefined {
	return lookup(node.type)?.def;
}

// Built-ins, in the order the model-facing reference lists them.
registerComponent("col", col, { column: {}, stack: {}, vstack: {}, vertical: {} });
registerComponent("row", row, { hstack: {}, horizontal: {} });
registerComponent("box", box, { card: {}, panel: {}, section: {}, group: {} });
registerComponent("tabs", tabs);
registerComponent("divider", divider, { separator: {}, hr: {} });
registerComponent("text", text, { heading: { style: "heading" }, title: { style: "heading" }, header: { style: "heading" }, h1: { style: "heading" }, h2: { style: "heading" }, paragraph: {}, label: {} });
registerComponent("md", md, { markdown: {} });
registerComponent("note", note, { callout: {}, alert: {}, banner: {}, warning: { tone: "warning" }, tip: { tone: "success" } });
registerComponent("kv", kv, { keyvalue: {}, properties: {}, definitions: {}, details: {} });
registerComponent("stat", stat, { kpi: {}, metric: {} });
registerComponent("table", table, { datatable: {}, grid: {} });
registerComponent("tree", tree);
registerComponent("flow", flow, { steps: {}, pipeline: {}, diagram: {} });
registerComponent("bar", bar, { barchart: {}, hbar: {}, bars: {}, columns: { vertical: true }, columnchart: { vertical: true }, vbar: { vertical: true }, histogram: { vertical: true } });
registerComponent("line", line, { linechart: {}, chart: {}, area: {}, timeseries: {}, sparkline: { spark: true }, spark: { spark: true } });
registerComponent("progress", progress, { gauge: {}, meter: {}, progressbar: {} });
registerComponent("heatmap", heatmap);
registerComponent("select", select, { radio: {}, choice: {}, choices: {}, dropdown: {}, segmented: { inline: true } });
registerComponent("multi", multi, { multiselect: {}, checkboxes: {}, checklist: {} });
registerComponent("input", input, { textinput: {}, textfield: {}, field: {} });
registerComponent("slider", slider, { number: {}, range: {} });
registerComponent("toggle", toggle, { checkbox: {}, switch: {} });
registerComponent("buttons", buttons, { button: {}, actions: {} });
registerComponent("code", code, { codeblock: {} });
registerComponent("list", list_, { bullets: {}, ul: {}, ol: { ordered: true } });
registerComponent("spacer", spacer, { space: {} });
