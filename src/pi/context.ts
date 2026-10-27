// Keeps old widget specs small in the model's context: they are big, and once shown they are mostly noise.
import { defOf, kindOf, toNode } from "../core/registry.ts";
import { normalizeSpec } from "../core/spec.ts";

interface Part {
	type?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	text?: string;
}

interface Message {
	role: string;
	content?: unknown;
	toolCallId?: string;
	[key: string]: unknown;
}

function size(value: unknown): number | undefined {
	if (Array.isArray(value)) return value.length;
	if (value && typeof value === "object") return Object.keys(value).length;
	return undefined;
}

const KEEP_ITEMS = 3;
const KEEP_CHARS = 160;

/**
 * A smaller copy of a spec that still reads as a real call: lists keep their first items and long
 * text is cut. Nothing in it is a placeholder, because models copy the shape of their earlier
 * calls; a stub like {"elided": "…"} came back as the arguments of new widgets.
 */
export function trimSpec(value: unknown, key = ""): unknown {
	if (typeof value === "string") return value.length > KEEP_CHARS && !value.startsWith("=") ? `${value.slice(0, KEEP_CHARS)}…` : value;
	if (Array.isArray(value)) return value.slice(0, KEEP_ITEMS).map((item) => trimSpec(item));
	if (value && typeof value === "object") {
		// calc is code, which would read as broken if cut.
		if (key === "calc") return value;
		return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, trimSpec(item, k)]));
	}
	return value;
}

/** "bar(6), table(6 rows), slider×2; inputs rate, years" */
export function summarizeSpec(args: unknown): string {
	const spec = normalizeSpec(args);
	const parts = new Map<string, number>();
	const details: string[] = [];
	const binds: string[] = [];
	const visit = (raw: unknown, path: string) => {
		const node = toNode(raw);
		const def = node && defOf(node);
		const kind = node && kindOf(node);
		if (!node || !def || !kind) return;
		if (typeof node.bind === "string") binds.push(node.bind);
		const n = size(node[def.main ?? ""]);
		if ((kind === "bar" || kind === "line" || kind === "table") && n !== undefined) details.push(`${kind}(${n}${kind === "table" ? " rows" : ""})`);
		else if (!["col", "row", "box", "tabs", "divider"].includes(kind)) parts.set(kind, (parts.get(kind) ?? 0) + 1);
		for (const child of def.children?.(node, path, (_path, init) => init(), true) ?? []) visit(child.node, child.path);
	};
	spec.view.forEach((node, i) => visit(node, String(i)));
	const shown = [...details, ...[...parts].map(([kind, n]) => (n > 1 ? `${kind}×${n}` : kind))];
	return `${shown.join(", ") || "empty"}${binds.length > 0 ? `; inputs ${binds.join(", ")}` : ""}`;
}

/**
 * Trim the arguments of older calls to `tool` and fold a one-line summary of the full widget into
 * their results. Only calls made before the latest user (or answer) message are touched, so a
 * message is rewritten once and stays stable for prompt caching; the newest `keep` calls stay
 * verbatim so the model can still edit the widget it just made.
 */
export function compressWidgets<M extends Message>(messages: M[], tool: string, keep = 1): M[] {
	const calls: Array<{ message: number; id: string; args: Record<string, unknown> }> = [];
	messages.forEach((m, i) => {
		if (m.role !== "assistant" || !Array.isArray(m.content)) return;
		for (const part of m.content as Part[]) {
			if (part?.type === "toolCall" && part.name === tool && part.id) calls.push({ message: i, id: part.id, args: part.arguments ?? {} });
		}
	});
	let boundary = -1;
	messages.forEach((m, i) => {
		if (m.role === "user" || m.role === "custom") boundary = i;
	});
	const recent = new Set(calls.slice(-keep).map((c) => c.id));
	const old = new Map(calls.filter((c) => c.message < boundary && !recent.has(c.id)).map((c) => [c.id, c.args]));
	if (old.size === 0) return messages;

	return messages.map((m) => {
		if (m.role === "assistant" && Array.isArray(m.content) && (m.content as Part[]).some((p) => p?.id && old.has(p.id))) {
			const content = (m.content as Part[]).map((p) => {
				if (p?.type !== "toolCall" || !p.id || !old.has(p.id)) return p;
				return { ...p, arguments: trimSpec(p.arguments) };
			});
			return { ...m, content };
		}
		if (m.role === "toolResult" && m.toolCallId && old.has(m.toolCallId)) {
			const summary = summarizeSpec(old.get(m.toolCallId));
			const content = Array.isArray(m.content) ? (m.content as Part[]) : [];
			const text = content.filter((p) => p?.type === "text").map((p) => p.text).join("\n");
			return { ...m, content: [{ type: "text", text: `${text}\n[Earlier widget: ${summary}]` }] };
		}
		return m;
	});
}
