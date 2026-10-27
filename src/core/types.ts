import type { HitTarget, Pointer } from "./hit.ts";

export type { HitTarget, Pointer };

export type Tone = "text" | "muted" | "dim" | "accent" | "success" | "warning" | "error";

/** Styling hooks the host maps onto its own theme. Every function returns a string safe to embed in one line. */
export interface Style {
	fg(tone: Tone, text: string): string;
	/** A distinct color per chart series, cycling when `index` runs past the palette. */
	series(index: number, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	inverse(text: string): string;
	border(text: string, active: boolean): string;
	heading(text: string): string;
	/** Optional Markdown renderer; components fall back to wrapped plain text without it. */
	markdown?(text: string, width: number): string[];
}

export interface UiNode {
	type: string;
	[prop: string]: unknown;
}

export interface UiSpec {
	title?: string;
	/** Raw nodes: long form ({"type": "bar", ...}) or shorthand ({"bar": ...}). */
	view: unknown[];
	state: Record<string, unknown>;
	/** Named expressions, evaluated in order on every change. */
	calc?: Record<string, string>;
	/** Older form of `calc`: a JavaScript function body returning derived values. */
	compute?: string;
	submit?: string;
	/** Block the model until the user answers, instead of returning at once. */
	wait?: boolean;
}

export interface KeyEvent {
	/** Key id as pi-tui's parseKey reports it ("up", "shift+tab", "space", "a", ...), or "text" for pasted input. */
	key: string;
	/** Printable text this key inserts, if any. */
	text?: string;
}

export type OutcomeStatus = "submitted" | "dismissed";

export interface Outcome {
	status: OutcomeStatus;
	action?: string;
}

/** What input handlers may do to the widget they belong to. */
export interface Interaction {
	get(bind: string): unknown;
	set(bind: string, value: unknown): void;
	/** Mutable per-control UI state (cursor positions, active tab, ...), keyed by node path. */
	local<T extends object>(path: string, init: () => T): T;
	scope(): Record<string, unknown>;
}

export interface RenderCtx {
	style: Style;
	scope: Record<string, unknown>;
	/** Values of the spec's "=expr" strings and {{expr}} placeholders, by expression. */
	exprs: ReadonlyMap<string, unknown>;
	state: Record<string, unknown>;
	local<T extends object>(path: string, init: () => T): T;
	/** Path of the focused control while the widget is live. */
	focus: string | undefined;
	/** The view is still streaming in: tolerate incomplete nodes silently. */
	partial: boolean;
	/** Mark `text` (one line's worth) as a pointer target. */
	hit(target: HitTarget, text: string): string;
	/** What the pointer is over, if anything. */
	hover: Pointer | undefined;
	renderChild(node: unknown, width: number, path: string): string[];
}

export type PointerAction = "click" | "press" | "drag";

/** `handle` returns true when it consumed the key; unconsumed arrows move focus. */
export interface ComponentDef {
	render(node: UiNode, width: number, ctx: RenderCtx, path: string): string[];
	/** Props a complete node must have. */
	required?: string[];
	focusable?(node: UiNode): boolean;
	/** Focusable only to change what is shown (tabs): doesn't make a widget wait for the user. */
	navigational?: boolean;
	handle?(node: UiNode, event: KeyEvent, it: Interaction, path: string): boolean;
	/** Enter on this control; an outcome ends the interaction, undefined falls back to advancing focus. */
	activate?(node: UiNode, it: Interaction, path: string): Outcome | undefined;
	/** A click, press or drag on one of this node's targets. True when it changed something. */
	pointer?(node: UiNode, pointer: Pointer, action: PointerAction, it: Interaction, path: string): Outcome | boolean;
	/** Tooltip for a hovered target. */
	describe?(node: UiNode, pointer: Pointer): string | undefined;
	/** Seed the bound state value when the spec did not provide one. */
	initial?(node: UiNode): unknown;
	/** Child nodes with their paths, used to walk the tree for focus and validation. `all` includes hidden tabs. */
	children?(node: UiNode, path: string, local: RenderCtx["local"], all: boolean): Array<{ node: unknown; path: string }>;
	/** Keys whose values are child nodes and must not be resolved as data. */
	nodeProps?: string[];
	/** The prop a shorthand node's component key holds: {"bar": {...}} means {"type": "bar", "data": {...}}. */
	main?: string;
	/** Model-facing syntax after the name: the main argument's shape, then other props. */
	doc: string;
	/** Implemented and accepted, but left out of the model-facing reference. */
	hidden?: boolean;
}
