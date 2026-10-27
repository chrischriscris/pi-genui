import vm from "node:vm";
import { formatNumber } from "./text.ts";

const TIMEOUT_MS = 150;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const EXPR = /^=(?!=)([\s\S]+)$/;
const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/** Helpers expressions can call, next to Math's functions and the widget's state. */
const HELPERS = `var __h = {
	range: function (a, b, step) { if (b === undefined) { b = a; a = 0; } step = step || 1; var out = []; for (var x = a; step > 0 ? x < b : x > b; x += step) out.push(x); return out; },
	sum: function (xs) { return (xs || []).reduce(function (a, b) { return a + (+b || 0); }, 0); },
	avg: function (xs) { return xs && xs.length ? __h.sum(xs) / xs.length : 0; },
	round: function (x, d) { var f = Math.pow(10, d || 0); return Math.round(x * f) / f; },
	clamp: function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); },
	pmt: function (rate, n, pv) { return rate === 0 ? pv / n : (pv * rate) / (1 - Math.pow(1 + rate, -n)); },
	fmt: function (x, format, unit) { return __fmt(x, format, unit); }
};`;

/** Whether code mentions an identifier, as a whole word. */
export function mentions(code: string, name: string): boolean {
	return new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).test(code);
}

/** Models write typographic operators ("a − b", "a × b"); JavaScript wants ASCII. */
function asciiOperators(expr: string): string {
	return expr.replace(/\u2212/g, "-").replace(/\u00d7/g, "*").replace(/\u00f7/g, "/");
}

/**
 * calc entries ordered so each comes after the entries it uses. Models don't keep their own order
 * reliably (some send object keys sorted), so the order given only breaks ties and cycles.
 */
function dependencyOrder(entries: Array<[string, string]>): Array<[string, string]> {
	const byName = new Map(entries);
	const uses = (expr: string) => entries.filter(([other]) => mentions(expr, other)).map(([other]) => other);
	const out: Array<[string, string]> = [];
	const state = new Map<string, "visiting" | "done">();
	const visit = (name: string) => {
		if (state.has(name)) return;
		state.set(name, "visiting");
		for (const dep of uses(byName.get(name)!)) if (dep !== name) visit(dep);
		state.set(name, "done");
		out.push([name, byName.get(name)!]);
	};
	for (const [name] of entries) visit(name);
	return out;
}

/** Every "=expr" string and {{expr}} placeholder anywhere in a value. */
export function collectExpressions(value: unknown, out = new Set<string>()): Set<string> {
	if (typeof value === "string") {
		const whole = expressionOf(value);
		if (whole !== undefined) out.add(whole);
		for (const m of value.matchAll(TEMPLATE)) out.add(m[1]!.trim());
	} else if (Array.isArray(value)) {
		for (const item of value) collectExpressions(item, out);
	} else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			if (key.includes("{{")) collectExpressions(key, out);
			collectExpressions(item, out);
		}
	}
	return out;
}

/** The expression of an "=expr" string. "={{a}} text" is read as the template it was meant to be. */
export function expressionOf(value: string): string | undefined {
	if (value.includes("{{")) return undefined;
	return EXPR.exec(value)?.[1]?.trim();
}

export interface Evaluation {
	/** Named values from `compute` and `calc`, merged into the widget's scope. */
	derived: Record<string, unknown>;
	/** Value of each expression, by its source text. */
	values: Map<string, unknown>;
	errors: string[];
}

/**
 * Runs a widget's `compute`, `calc` and expressions in one VM script per state change, with a
 * timeout. The VM is not a security boundary; it keeps a buggy script from hanging the UI. The
 * model writing these can already run shell commands.
 */
export class Evaluator {
	private readonly script: vm.Script | undefined;
	private readonly context: vm.Context | undefined;
	private readonly exprs: string[] = [];
	readonly compileErrors: string[] = [];

	constructor(spec: { compute?: string; calc?: Record<string, string> }, expressions: Iterable<string>) {
		const parts: string[] = [];
		const check = (code: string, label: string): boolean => {
			try {
				new vm.Script(code);
				return true;
			} catch (error) {
				this.compileErrors.push(`${label} does not parse: ${message(error)}`);
				return false;
			}
		};
		const compute = spec.compute?.trim();
		if (compute) {
			// An expression ("({ a: state.x })") or a function body; either may use `state`.
			const body = [`return (${compute.replace(/;\s*$/, "")});`, compute].find((candidate) => {
				try {
					new vm.Script(`(function (state) { ${candidate}\n})`);
					return true;
				} catch {
					return false;
				}
			});
			if (body === undefined) check(`(function (state) { ${compute}\n})`, "compute");
			else parts.push(`try { var __c = (function (state) { ${body}\n})(__s.state); if (__c && typeof __c === "object") for (var __k in __c) { __s[__k] = __r.derived[__k] = __c[__k]; } } catch (e) { __r.errors.push("compute: " + e.message); }`);
		}
		const calc: Array<[string, string]> = [];
		for (const [name, raw] of Object.entries(spec.calc ?? {})) {
			if (IDENT.test(name)) calc.push([name, asciiOperators(typeof raw === "string" ? (expressionOf(raw) ?? raw) : JSON.stringify(raw)).trim()]);
			else this.compileErrors.push(`calc name "${name}" is not an identifier`);
		}
		for (const [name, expr] of dependencyOrder(calc)) {
			if (!check(`(${expr})`, `calc ${name}`)) continue;
			parts.push(`try { __s[${JSON.stringify(name)}] = __r.derived[${JSON.stringify(name)}] = (${expr}); } catch (e) { __r.errors.push(${JSON.stringify(`calc ${name}: `)} + e.message); }`);
		}
		for (const expr of expressions) {
			const code = asciiOperators(expr);
			if (!check(`(${code})`, `"=${expr}"`)) continue;
			this.exprs.push(expr);
			parts.push(`__r.values.push((function () { try { return (${code}); } catch (e) { __r.errors.push(${JSON.stringify(`"=${expr}": `)} + e.message); } })());`);
		}
		if (parts.length === 0) return;
		this.script = new vm.Script(`(function () { var __r = { derived: {}, values: [], errors: [] }; with (__h) { with (Math) { with (__s) {\n${parts.join("\n")}\n} } } return JSON.stringify(__r); })()`, { filename: "widget.js" });
		this.context = vm.createContext({ __fmt: (x: unknown, format?: unknown, unit?: unknown) => (typeof x === "number" ? formatNumber(x, { format, unit }) : String(x ?? "")) }, { codeGeneration: { strings: false, wasm: false } });
		vm.runInContext(HELPERS, this.context);
	}

	get active(): boolean {
		return this.script !== undefined;
	}

	run(state: Record<string, unknown>): Evaluation {
		const values = new Map<string, unknown>();
		if (!this.script || !this.context) return { derived: {}, values, errors: [...this.compileErrors] };
		try {
			const scope = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
			this.context.__s = { ...scope, state: scope };
			const result = JSON.parse(this.script.runInContext(this.context, { timeout: TIMEOUT_MS }) as string) as { derived: Record<string, unknown>; values: unknown[]; errors: string[] };
			this.exprs.forEach((expr, i) => values.set(expr, result.values[i] ?? undefined));
			return { derived: result.derived, values, errors: [...this.compileErrors, ...result.errors] };
		} catch (error) {
			return { derived: {}, values, errors: [...this.compileErrors, `evaluation failed: ${message(error)}`] };
		}
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
