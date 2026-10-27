import { collectExpressions, Evaluator, mentions } from "./eval.ts";
import { type Pointer, sameTarget } from "./hit.ts";
import { defOf, toNode } from "./registry.ts";
import { resolveProps, type Values } from "./scope.ts";
import type { ComponentDef, Interaction, KeyEvent, Outcome, PointerAction, UiNode, UiSpec } from "./types.ts";

export interface RuntimeOptions {
	/** Evaluate calc, compute and expressions. Off while arguments are still streaming. */
	evaluate?: boolean;
	/** Values to restore over the spec's initial state, e.g. from an answered widget. */
	state?: Record<string, unknown>;
}

export interface VisitedNode {
	node: UiNode;
	path: string;
	def: ComponentDef | undefined;
}

export const SUBMIT_ACTION = "submit";

function submitButton(label: string): UiNode {
	return { type: "buttons", buttons: [{ label, action: SUBMIT_ACTION }] };
}

/**
 * What the pointer may do:
 * - live: the widget has the keyboard;
 * - pending: a question waiting for its answer, clickable through to submit;
 * - explore: inputs that only drive the widget's own computed view;
 * - view: tabs and hover only.
 */
export type PointerMode = "live" | "pending" | "explore" | "view";

/** Targets that only change what is shown, never the values a model sees. */
const VIEW_KINDS = new Set(["tab"]);

/** State, derived values, focus and key handling for one widget. Rendering reads from it. */
export class Runtime implements Interaction {
	readonly spec: UiSpec;
	readonly view: unknown[];
	state: Record<string, unknown>;
	derived: Record<string, unknown> = {};
	exprs: ReadonlyMap<string, unknown> = new Map();
	error: string | undefined;
	/** Bumped on every change, so views can cache by it. */
	version = 0;
	hover: Pointer | undefined;
	/** First visible body line when a live widget is taller than the screen. */
	scrollTop = 0;
	/** Keep the focused control in view; off after the user scrolls by hand, on again with the keyboard. */
	followFocus = true;
	/** Set while the widget has the keyboard, so a clicked button can end the interaction too. */
	finish: ((outcome: Outcome) => void) | undefined;
	private readonly evaluator: Evaluator;
	/** Source of its calc, compute and "=" values, evaluated or (while streaming) not yet. */
	private readonly code: string;
	private readonly locals = new Map<string, object>();
	private focusables: VisitedNode[] = [];
	private focusIndex = 0;
	private kinds: { explorable: boolean } | undefined;
	/** Path of the Submit button added for the mouse; keys skip it, since Enter on the last control submits. */
	private addedSubmit: string | undefined;

	constructor(spec: UiSpec, options: RuntimeOptions = {}) {
		this.spec = spec;
		this.view = spec.submit ? [...spec.view, submitButton(spec.submit)] : spec.view;
		this.state = { ...spec.state, ...options.state };
		const expressions = collectExpressions(this.view);
		this.code = [...expressions, ...Object.values(spec.calc ?? {}).map(String), spec.compute ?? ""].join("\n");
		this.evaluator = new Evaluator(options.evaluate === false ? {} : spec, options.evaluate === false ? [] : expressions);
		this.recompute();
		this.seed();
		this.recompute();
		this.refreshFocus();
		// A question without a button of its own gets one, so it can be answered with the mouse too.
		if (this.asks && !this.walk(true).some((v) => v.def?.activate)) {
			this.addedSubmit = String(this.view.length);
			this.view = [...this.view, submitButton("Submit")];
		}
	}

	/** Has inputs or buttons. Tabs alone don't count. */
	get interactive(): boolean {
		return this.focusables.some((v) => !v.def?.navigational);
	}

	/**
	 * Every input drives a computed value and there are no buttons: a calculator, not a question.
	 * An input nothing computes from is a question, even next to a calc for display.
	 */
	get explorable(): boolean {
		if (!this.kinds) {
			const nodes = this.walk(true);
			const inputs = nodes.filter((v) => v.def?.focusable?.(v.node) && !v.def.navigational);
			const feeds = (v: VisitedNode) => typeof v.node.bind === "string" && mentions(this.code, v.node.bind);
			this.kinds = { explorable: !this.spec.submit && !nodes.some((v) => v.def?.activate) && inputs.length > 0 && inputs.every(feeds) };
		}
		return this.kinds.explorable;
	}

	/** Wants an answer from the user. */
	get asks(): boolean {
		return this.interactive && !this.explorable;
	}

	get focusedPath(): string | undefined {
		return this.focusables[this.focusIndex]?.path;
	}

	get focused(): VisitedNode | undefined {
		return this.focusables[this.focusIndex];
	}

	/** Enter on the last control submits; on any other it moves on. */
	get focusedIsLast(): boolean {
		return this.focusIndex >= this.focusables.length - 1;
	}

	scope(): Record<string, unknown> {
		return { ...this.state, ...this.derived };
	}

	values(): Values {
		return { scope: this.scope(), exprs: this.exprs };
	}

	get(bind: string): unknown {
		return this.state[bind];
	}

	set(bind: string, value: unknown): void {
		if (!bind) return;
		this.state = { ...this.state, [bind]: value };
		this.recompute();
		this.refreshFocus();
		this.version++;
	}

	local<T extends object>(path: string, init: () => T): T {
		let value = this.locals.get(path) as T | undefined;
		if (!value) {
			value = init();
			this.locals.set(path, value);
		}
		return value;
	}

	scrollBy(lines: number): void {
		this.scrollTop = Math.max(0, this.scrollTop + lines);
		this.followFocus = false;
		this.version++;
	}

	/** Visit nodes depth first with resolved props. `all` includes the content of hidden tabs. */
	walk(all: boolean): VisitedNode[] {
		const out: VisitedNode[] = [];
		const values = this.values();
		const local = this.local.bind(this);
		const visit = (raw: unknown, path: string) => {
			const node = toNode(raw);
			if (!node) return;
			const def = defOf(node);
			const resolved = resolveProps(node, values, def?.nodeProps);
			out.push({ node: resolved, path, def });
			for (const child of def?.children?.(resolved, path, local, all) ?? []) visit(child.node, child.path);
		};
		this.view.forEach((node, i) => visit(node, String(i)));
		return out;
	}

	setHover(pointer: Pointer | undefined): boolean {
		// Position inside the target matters only for continuous ones, like a line chart's x axis.
		const discrete = pointer?.target.index !== undefined || pointer?.target.row !== undefined;
		if (sameTarget(pointer?.target, this.hover?.target) && (discrete || pointer?.ratio === this.hover?.ratio)) return false;
		this.hover = pointer;
		this.version++;
		return true;
	}

	/** Tooltip text for the hovered target. */
	describeHover(): string | undefined {
		const pointer = this.hover;
		if (!pointer) return undefined;
		const visited = this.walk(false).find((v) => v.path === pointer.target.path);
		return visited?.def?.describe?.(visited.node, pointer);
	}

	/** Apply a click, press or drag. Returns an outcome when it answers the widget. */
	pointer(pointer: Pointer, action: PointerAction, mode: PointerMode): Outcome | boolean {
		const visited = this.walk(false).find((v) => v.path === pointer.target.path);
		if (!visited?.def?.pointer) return false;
		const answering = mode === "live" || mode === "pending";
		if (!VIEW_KINDS.has(pointer.target.kind)) {
			if (mode === "view") return false;
			if (mode === "explore" && visited.def.activate) return false;
		}
		let changed = false;
		if (answering && action !== "drag") {
			const index = this.focusables.findIndex((f) => f.path === visited.path);
			if (index >= 0 && index !== this.focusIndex) {
				this.focusIndex = index;
				changed = true;
			}
		}
		const result = visited.def.pointer(visited.node, pointer, action, this, visited.path);
		if (typeof result === "object") return answering ? result : false;
		if (result || changed) {
			this.refreshFocus();
			this.version++;
		}
		return result || changed;
	}

	/** Handle one key. Returns an outcome when the interaction ends. */
	key(event: KeyEvent): Outcome | undefined {
		if (event.key === "escape") return { status: "dismissed" };
		this.followFocus = true;
		const current = this.focused;
		if (event.key === "tab" || event.key === "shift+tab") {
			this.moveFocus(event.key === "tab" ? 1 : -1, true);
			return undefined;
		}
		if (event.key === "enter") {
			const outcome = current?.def?.activate?.(current.node, this, current.path);
			if (outcome) return outcome;
			if (this.focusIndex < this.focusables.length - 1) {
				this.moveFocus(1, false);
				return undefined;
			}
			return { status: "submitted" };
		}
		if (current?.def?.handle?.(current.node, event, this, current.path)) {
			// Switching tabs changes which controls exist, so focus is rebuilt after every handled key.
			this.refreshFocus();
			this.version++;
			return undefined;
		}
		if (event.key === "up" || event.key === "down") this.moveFocus(event.key === "up" ? -1 : 1, false);
		return undefined;
	}

	private moveFocus(delta: number, wrap: boolean): void {
		const count = this.focusables.length;
		if (count === 0) return;
		let next = this.focusIndex + delta;
		if (wrap) next = (next + count) % count;
		if (next < 0 || next >= count) return;
		this.focusIndex = next;
		this.version++;
	}

	private recompute(): void {
		if (!this.evaluator.active && this.evaluator.compileErrors.length === 0) return;
		const { derived, values, errors } = this.evaluator.run(this.state);
		this.derived = derived;
		this.exprs = values;
		this.error = errors.length > 0 ? errors.slice(0, 3).join("; ") : undefined;
	}

	private seed(): void {
		for (const { node, def } of this.walk(true)) {
			if (!def?.initial || typeof node.bind !== "string" || node.bind in this.state) continue;
			const value = def.initial(node);
			if (value !== undefined) this.state[node.bind] = value;
		}
	}

	private refreshFocus(): void {
		const path = this.focusedPath;
		this.focusables = this.walk(false).filter((v) => v.path !== this.addedSubmit && v.def?.focusable?.(v.node));
		const kept = path === undefined ? -1 : this.focusables.findIndex((v) => v.path === path);
		this.focusIndex = kept >= 0 ? kept : Math.min(this.focusIndex, Math.max(0, this.focusables.length - 1));
	}
}
