import { toNode } from "./registry.ts";
import type { UiSpec } from "./types.ts";

const SPEC_KEYS = new Set(["title", "view", "state", "calc", "compute", "submit", "wait"]);

function parseMaybe(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Coerce tool arguments into a spec. Tolerates what models commonly send: JSON encoded as a string,
 * the spec nested under "spec" or "ui", or a bare node with no "view" wrapper. Partial arguments
 * streaming in produce a partial spec. Nodes stay raw (long form or shorthand) and are normalized
 * where they are rendered.
 */
export function normalizeSpec(args: unknown): UiSpec {
	let raw = parseMaybe(args);
	if (isRecord(raw) && raw.view === undefined) {
		const nested = parseMaybe(raw.spec ?? raw.ui);
		if (isRecord(nested)) raw = nested;
	}
	if (!isRecord(raw)) return { view: [], state: {} };
	let view = parseMaybe(raw.view);
	// A bare node: either long form or a shorthand whose first key is a component.
	if (view === undefined && Object.keys(raw).some((k) => !SPEC_KEYS.has(k)) && toNode(raw)) view = raw;
	if (view === undefined && Array.isArray(raw.children)) view = raw.children;
	const nodes = (Array.isArray(view) ? view : view === undefined || view === null ? [] : [view]).filter((n) => toNode(n) !== undefined);
	const state = parseMaybe(raw.state);
	const calc = parseMaybe(raw.calc);
	return {
		title: typeof raw.title === "string" ? raw.title : undefined,
		view: nodes as UiSpec["view"],
		state: isRecord(state) ? { ...state } : {},
		calc: isRecord(calc) ? (calc as Record<string, string>) : undefined,
		compute: typeof raw.compute === "string" ? raw.compute : undefined,
		submit: typeof raw.submit === "string" && raw.submit.trim() ? raw.submit : raw.submit === true ? "Submit" : undefined,
		wait: raw.wait === true,
	};
}
