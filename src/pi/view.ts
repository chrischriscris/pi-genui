// Glue between the renderer core and Pi's TUI: theme mapping, key decoding, components.
import { getMarkdownTheme, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, decodeKittyPrintable, Markdown, parseKey, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";
import { hitTest } from "../core/hit.ts";
import { PointerController } from "../core/pointer.ts";
import { type FrameOptions, layoutWidget, type WidgetLayout } from "../core/render.ts";
import { kindOf } from "../core/registry.ts";
import type { PointerMode, Runtime } from "../core/runtime.ts";
import type { KeyEvent, Outcome, Style } from "../core/types.ts";

const SERIES: ThemeColor[] = ["accent", "success", "warning", "mdLink", "syntaxKeyword", "syntaxString", "syntaxNumber", "syntaxType", "error"];

export function piStyle(theme: Theme): Style {
	return {
		fg: (tone, text) => theme.fg(tone, text),
		series: (index, text) => theme.fg(SERIES[index % SERIES.length]!, text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		inverse: (text) => theme.inverse(text),
		border: (text, active) => theme.fg(active ? "borderAccent" : "borderMuted", text),
		heading: (text) => theme.fg("mdHeading", theme.bold(text)),
		markdown: (text, width) => new Markdown(text, 0, 0, getMarkdownTheme()).render(width),
	};
}

// VT220-style Home/End (tmux, screen) that parseKey has no id for.
const LEGACY_KEYS: Record<string, string> = { "\x1b[1~": "home", "\x1b[7~": "home", "\x1b[4~": "end", "\x1b[8~": "end" };

export function toKeyEvent(data: string): KeyEvent | undefined {
	const key = parseKey(data) ?? LEGACY_KEYS[data];
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return { key: key ?? kitty, text: kitty };
	if (key === "space") return { key, text: " " };
	if (key?.length === 1) return { key, text: key };
	if (key) return { key };
	// Pasted text and characters parseKey has no id for.
	if (!data.includes("\x1b") && !/[\x00-\x1f\x7f]/.test(data)) return { key: "text", text: data };
	return undefined;
}

/** Rows Pi keeps for itself below a live widget: controller, footer and spacing. */
const SCREEN_CHROME = 10;

export interface WidgetSource {
	rt: Runtime;
	options: FrameOptions;
	/** What the pointer may do; undefined while arguments stream in. */
	mode: PointerMode | undefined;
	/** One line shown instead of the widget, e.g. once a newer version replaced it. */
	collapsed?: string;
	/** A click answered the widget (a button, or its submit). */
	onAnswer?: (outcome: Outcome) => void;
	/** A click on a text field: the widget wants the keyboard. */
	onWantsKeyboard?: () => void;
}

// Widgets don't hear about the pointer leaving them, so hover is cleared on any mouse move that no
// widget claimed. `requestRender` redraws the widget whose hover was cleared.
const hoverOwners = new Map<Runtime, (() => void) | undefined>();
let claimedMove = new Set<Runtime>();

const MOUSE_MOVE = /\x1b\[<(\d+);\d+;\d+M/g;

/** Feed raw terminal input here (ctx.ui.onTerminalInput). Never consumes anything. */
export function watchPointer(data: string): undefined {
	const moved = [...data.matchAll(MOUSE_MOVE)].some((m) => {
		const button = Number(m[1]);
		return (button & 32) !== 0 && (button & 3) === 3;
	});
	if (!moved) return undefined;
	claimedMove = new Set();
	queueMicrotask(() => {
		for (const [rt, requestRender] of hoverOwners) {
			if (claimedMove.has(rt)) continue;
			hoverOwners.delete(rt);
			if (rt.setHover(undefined)) requestRender?.();
		}
	});
	return undefined;
}

const controllers = new WeakMap<Runtime, PointerController>();

/** Draws a widget from whatever runtime `source` returns at render time, cached per change. */
export class WidgetView implements Component {
	private cache: { key: string; lines: string[]; layout: WidgetLayout; pad: number } | undefined;

	constructor(
		private readonly source: () => WidgetSource,
		private readonly style: Style,
		private readonly pad: number,
		/** Asks the host to redraw this widget when its state changes from outside a mouse event. */
		private readonly requestRender?: () => void,
	) {}

	render(width: number): string[] {
		const { rt, options, collapsed } = this.source();
		if (collapsed !== undefined) {
			this.cache = undefined;
			return [truncateToWidth(" ".repeat(width > 30 ? this.pad : 0) + this.style.fg("muted", collapsed), width)];
		}
		// A live widget must fit on screen above the editor, or its focused control can scroll away.
		const maxHeight = options.live ? Math.max(10, (process.stdout.rows || 40) - SCREEN_CHROME) : undefined;
		const key = `${width}|${maxHeight}|${rt.version}|${options.live}|${options.partial}|${options.status ?? ""}`;
		if (this.cache?.key === key) return this.cache.lines;
		const pad = width > 30 ? this.pad : 0;
		const layout = layoutWidget(rt, Math.max(1, width - pad * 2), this.style, { ...options, maxHeight });
		const lines = layout.lines.map((line) => " ".repeat(pad) + line);
		this.cache = { key, lines, layout, pad };
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const cache = this.cache;
		if (!cache) return undefined;
		const { rt, mode, onAnswer, onWantsKeyboard } = this.source();
		let controller = controllers.get(rt);
		if (!controller) {
			controller = new PointerController(rt);
			controllers.set(rt, controller);
		}
		const result = controller.handle({ type: event.type, button: event.button, x: event.x - cache.pad, y: event.y, wheel: event.wheelDelta }, cache.layout.regions, mode);
		if (event.type === "move") {
			claimedMove.add(rt);
			if (rt.hover) hoverOwners.set(rt, this.requestRender);
			else hoverOwners.delete(rt);
		}
		if (result?.outcome) (mode === "live" ? rt.finish : onAnswer)?.(result.outcome);
		if (event.type === "click" && (mode === "pending" || mode === "explore") && hitTest(cache.layout.regions, event.x - cache.pad, event.y)?.target.kind === "input") onWantsKeyboard?.();
		return result ? { handled: result.handled, render: result.render, ...(result.capture && { capture: true }) } : undefined;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	/** The lines last drawn. */
	get lines(): readonly string[] | undefined {
		return this.cache?.lines;
	}
}

/** What fullscreen Pi's TUI offers for moving its transcript. Inline mode has none of it. */
interface Scrollable {
	getScreenLines(): string[];
	scrollBy(lines: number): void;
	scrollToBottom(): void;
}

const ESCAPES = /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b[\]_][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** Rows Pi keeps below the transcript while a widget has the keyboard. */
const BELOW_TRANSCRIPT = 6;

function plain(line: string): string {
	return line.replace(ESCAPES, "").trim();
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 30));
}

/**
 * Scroll fullscreen Pi's transcript so the whole widget is on screen, e.g. when Alt+G picks up one
 * that later output pushed away: from the end upward until its top line shows, then down until its
 * last line does too. Returns whether it moved anything.
 */
export async function reveal(tui: TUI, view: WidgetView): Promise<boolean> {
	const screen = tui as unknown as Partial<Scrollable>;
	if (!screen.getScreenLines || !screen.scrollBy || !screen.scrollToBottom) return false;
	await nextFrame();
	const own = view.lines?.map(plain);
	if (!own?.length) return false;
	// The top border holds the title; its start is enough, and survives a scrollbar in the last column.
	const head = own[0]!.slice(0, 40);
	const find = () => screen.getScreenLines!().map(plain).findIndex((row) => row.startsWith(head));
	const rows = () => screen.getScreenLines!().length;
	const fits = (top: number) => top >= 0 && top + own.length <= rows() - BELOW_TRANSCRIPT;
	let top = find();
	if (fits(top)) return false;
	if (top < 0) {
		screen.scrollToBottom();
		await nextFrame();
		let last = "";
		for (top = find(); top < 0; top = find()) {
			const now = screen.getScreenLines!().join("\n");
			if (now === last) return false;
			last = now;
			screen.scrollBy(-Math.max(4, Math.floor(rows() / 2)));
			await nextFrame();
		}
	}
	// Put its bottom just above the controls, or its top at the top if it is taller than that.
	screen.scrollBy(Math.min(top - 1, top + own.length - (rows() - BELOW_TRANSCRIPT)));
	tui.requestRender();
	return true;
}

/** Back to the end of the transcript, after `reveal` moved it. */
export function scrollToEnd(tui: TUI): void {
	(tui as unknown as Partial<Scrollable>).scrollToBottom?.();
	tui.requestRender();
}

export const EMPTY: Component = { render: () => [], invalidate: () => {} };

const HINTS: Record<string, string> = {
	select: "↑↓ choose",
	multi: "↑↓ move · Space toggle",
	input: "type to edit",
	slider: "←→ adjust · Shift+←→ ×10",
	toggle: "Space toggle",
	table: "↑↓ pick a row",
	tabs: "←→ switch tab",
	buttons: "←→ choose · Enter press",
};

function hints(rt: Runtime, leave: string): string {
	const focused = rt.focused;
	const kind = focused ? kindOf(focused.node) : undefined;
	let own = kind ? HINTS[kind] : undefined;
	if (kind === "select" && focused?.node.inline) own = "←→ choose";
	const parts = own ? [own] : [];
	if (kind !== "buttons") parts.push(rt.focusedIsLast ? "Enter submit" : "Enter next");
	parts.push("Tab move", leave);
	return parts.join(" · ");
}

/**
 * Sits in the editor area while a widget has the keyboard: shows key hints and feeds keys to the
 * runtime. "wait" is a blocking call, where Esc closes the widget; "focus" is a pending widget the
 * user picked up, where Esc returns to the chat.
 */
export class Controller implements Component {
	constructor(
		private readonly rt: Runtime,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (outcome: Outcome) => void,
		private readonly kind: "wait" | "focus" = "wait",
	) {}

	render(width: number): string[] {
		const title = this.rt.spec.title ? `${this.theme.bold(this.rt.spec.title)}  ` : "";
		return [
			this.theme.fg("borderAccent", "─".repeat(width)),
			truncateToWidth(`${this.theme.fg("accent", " ◆ ")}${title}${this.theme.fg("muted", hints(this.rt, this.kind === "wait" ? "Esc close" : "Esc back to chat"))}`, width),
		];
	}

	handleInput(data: string): void {
		const event = toKeyEvent(data);
		if (!event) return;
		const outcome = this.rt.key(event.key === "ctrl+c" ? { key: "escape" } : event);
		if (outcome) {
			this.done(outcome);
			return;
		}
		this.tui.requestRender();
	}

	invalidate(): void {}
}
