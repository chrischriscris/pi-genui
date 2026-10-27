import { componentNames, defOf, kindOf, toNode } from "./registry.ts";
import type { Runtime } from "./runtime.ts";
import { missingRefs } from "./scope.ts";
import type { ComponentDef } from "./types.ts";

const STATE_NAME = /^[A-Za-z_]\w*$/;

function where(path: string): string {
	const [root, ...rest] = path.split(".");
	return `view[${root}]${rest.map((p) => (p.startsWith("t") ? `.tabs[${p.slice(1)}]` : `.children[${p}]`)).join("")}`;
}

function usage(name: string, def: ComponentDef): string {
	return `usage: {"${name}": ${def.doc}}`;
}

/**
 * Problems a model should fix before the widget is worth showing; empty when the spec is usable.
 * Each names the node and carries the component's usage line, so the tool description can stay short.
 */
export function validate(rt: Runtime): string[] {
	const errors: string[] = [];
	if (rt.spec.view.length === 0) errors.push('view is empty: pass a node such as {"bar": {"a": 1}} or an array of nodes');
	if (rt.error) errors.push(rt.error);
	const scope = rt.scope();
	const local = rt.local.bind(rt);

	const visit = (raw: unknown, path: string) => {
		const node = toNode(raw);
		if (!node) {
			errors.push(`${where(path)}: not a component. Lead each node with its component, like {"text": "hi"}. Components: ${componentNames().join(", ")}`);
			return;
		}
		const def = defOf(node);
		const kind = kindOf(node);
		if (!def || !kind) {
			errors.push(`${where(path)}: unknown component "${node.type}". Components: ${componentNames().join(", ")}`);
			return;
		}
		const missing = (def.required ?? []).filter((prop) => node[prop] === undefined);
		if (kind === "line" && node.data === undefined && node.series === undefined) missing.push("data");
		if (missing.length > 0) errors.push(`${where(path)} (${kind}): missing ${missing.map((m) => `"${m}"`).join(", ")}; ${usage(kind, def)}`);
		// The bound key names the value in expressions and in the answer, so "+pick" or "form.name" won't do.
		if (node.bind !== undefined && typeof node.bind !== "string") errors.push(`${where(path)} (${kind}): the bound state key must be a string; ${usage(kind, def)}`);
		else if (typeof node.bind === "string" && !STATE_NAME.test(node.bind)) {
			const name = node.bind.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
			errors.push(`${where(path)} (${kind}): bind "${node.bind}" is not a plain state name${STATE_NAME.test(name) ? `; use "${name}"` : ""}`);
		}
		for (const ref of new Set(missingRefs(node, scope, def.nodeProps))) errors.push(`${where(path)} (${kind}): "$${ref}" is not defined; use "=expr" over state and calc`);
		for (const child of def.children?.(node, path, local, true) ?? []) visit(child.node, child.path);
	};
	rt.spec.view.forEach((node, i) => visit(node, String(i)));
	return errors;
}
