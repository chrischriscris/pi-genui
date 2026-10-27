import { expressionOf } from "./eval.ts";
import { display } from "./text.ts";

const REF = /^\$([A-Za-z_]\w*(?:\.\w+)*)$/;
const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/** What a widget's strings can refer to: its scope (state and calc) and evaluated expressions. */
export interface Values {
	scope: Record<string, unknown>;
	exprs: ReadonlyMap<string, unknown>;
}

export function lookup(scope: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
	let current: unknown = scope;
	for (const part of path.split(".")) {
		if (current === null || typeof current !== "object" || !(part in (current as object))) return { found: false };
		current = (current as Record<string, unknown>)[part];
	}
	return { found: true, value: current };
}

/** The reference name when `value` is an older whole-value reference like "$series". */
export function refName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return REF.exec(value)?.[1];
}

function template(text: string, v: Values): string {
	return text.replace(TEMPLATE, (_whole, raw: string) => {
		const expr = raw.trim();
		if (v.exprs.has(expr)) return display(v.exprs.get(expr));
		const hit = lookup(v.scope, expr);
		return hit.found ? display(hit.value) : "…";
	});
}

/**
 * Resolve "=expr" strings to their value, interpolate {{expr}} placeholders and, for older
 * specs, "$name" references. Expressions not evaluated yet (arguments still streaming) resolve
 * to undefined, which components show as empty.
 */
export function resolve(value: unknown, v: Values): unknown {
	if (typeof value === "string") {
		const expr = expressionOf(value);
		if (expr !== undefined) return v.exprs.get(expr);
		const ref = refName(value);
		if (ref) {
			const hit = lookup(v.scope, ref);
			return hit.found ? hit.value : value;
		}
		if (!value.includes("{{")) return value;
		return template(value.startsWith("=") ? value.slice(1) : value, v);
	}
	if (Array.isArray(value)) return value.map((item) => resolve(item, v));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		// Keys are labels in {label: value} data and kv items, so they take {{expr}} too.
		for (const [key, item] of Object.entries(value)) out[key.includes("{{") ? template(key, v) : key] = resolve(item, v);
		return out;
	}
	return value;
}

/** Resolve a node's props, leaving the props that hold child nodes for their own render pass. */
export function resolveProps<T extends Record<string, unknown>>(node: T, v: Values, nodeProps: string[] = []): T {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		if (key === "type" || key === "bind" || nodeProps.includes(key)) out[key] = value;
		else out[key] = resolve(value, v);
	}
	return out as T;
}

/** Older "$name" references that don't resolve, for validation. */
export function missingRefs(value: unknown, scope: Record<string, unknown>, nodeProps: string[] = [], out: string[] = []): string[] {
	if (typeof value === "string") {
		const ref = refName(value);
		if (ref && !lookup(scope, ref).found) out.push(ref);
	} else if (Array.isArray(value)) {
		for (const item of value) missingRefs(item, scope, [], out);
	} else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			if (key === "type" || key === "bind" || nodeProps.includes(key)) continue;
			missingRefs(item, scope, [], out);
		}
	}
	return out;
}
