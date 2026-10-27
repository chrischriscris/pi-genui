import { stack } from "../components/util.ts";
import { extractHits, type HitRegion, HitTable } from "./hit.ts";
import { defOf, kindOf, toNode } from "./registry.ts";
import type { Runtime } from "./runtime.ts";
import { resolveProps } from "./scope.ts";
import { FOCUS_MARK, fit, visibleWidth, wrap } from "./text.ts";
import type { RenderCtx, Style } from "./types.ts";

export interface ViewOptions {
	/** Show the focused control (the widget is live and owns the keyboard). */
	live: boolean;
	/** Arguments are still streaming; hide incomplete nodes instead of reporting them. */
	partial: boolean;
}

export function renderNode(raw: unknown, width: number, ctx: RenderCtx, path: string): string[] {
	if (width <= 0) return [];
	const problem = (message: string) => (ctx.partial ? [] : [fit(ctx.style.fg("error", `⚠ ${message}`), width)]);
	const node = toNode(raw);
	if (!node) return problem(`not a component: ${JSON.stringify(raw)?.slice(0, 40)}`);
	const def = defOf(node);
	if (!def) return problem(`unknown component "${node.type}"`);
	try {
		const resolved = resolveProps(node, { scope: ctx.scope, exprs: ctx.exprs }, def.nodeProps);
		const lines = def.render(resolved, width, ctx, path).map((line) => fit(line, width));
		if (path === ctx.focus && lines.length > 0) lines[0] = FOCUS_MARK + lines[0];
		return lines;
	} catch (error) {
		return problem(`${kindOf(node)}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** The widget body at `width`, without the frame. Pointer targets are marked when `hits` is given. */
export function renderBody(rt: Runtime, width: number, style: Style, options: ViewOptions, hits?: HitTable): string[] {
	const ctx: RenderCtx = {
		style,
		scope: rt.scope(),
		exprs: rt.exprs,
		state: rt.state,
		local: rt.local.bind(rt),
		focus: options.live ? rt.focusedPath : undefined,
		partial: options.partial,
		hit: (target, text) => (hits && !options.partial ? hits.wrap(target, text) : text),
		hover: options.partial ? undefined : rt.hover,
		renderChild: (node, w, path) => renderNode(node, w, ctx, path),
	};
	const lines = stack(rt.view.map((node, i) => ({ node, path: String(i) })), width, ctx, 1);
	if (rt.error && !options.partial) lines.push(...wrap(style.fg("error", `⚠ ${rt.error}`), width));
	return lines;
}

export interface FrameOptions extends ViewOptions {
	title?: string;
	/** Text on the right of the bottom border, e.g. "submitted". */
	status?: string;
	/** Cap on total lines; taller widgets scroll to keep the focused control in view. */
	maxHeight?: number;
}

const MIN_FRAMED = 16;

/** Pointer target kind of the "↑ N more" / "↓ N more" lines of a scrolled widget. */
export const SCROLL_KIND = "scroll";

/**
 * Strip focus markers, then cut `body` to `height` lines. The window stays at `rt.scrollTop` while the
 * focused lines are visible and scrolls only as far as needed otherwise, so clicking a control never
 * shifts what is under the pointer. After the user scrolls by hand, focus stops pulling the window
 * until the keyboard is used again.
 */
function windowAround(rt: Runtime, body: string[], height: number | undefined, style: Style, hits: HitTable): string[] {
	const marked: number[] = [];
	const lines = body.map((line, i) => {
		if (!line.includes(FOCUS_MARK)) return line;
		marked.push(i);
		return line.split(FOCUS_MARK).join("");
	});
	if (height === undefined || lines.length <= height) return lines;
	const size = Math.max(1, height - 2);
	const maxStart = lines.length - size;
	let start = Math.min(Math.max(0, rt.scrollTop), maxStart);
	if (rt.followFocus && marked.length > 0) {
		const first = Math.min(...marked);
		const last = Math.max(...marked);
		if (first < start) start = Math.max(0, first - 1);
		else if (last >= start + size) start = Math.min(maxStart, last - size + 2);
	}
	rt.scrollTop = start;
	const end = start + size;
	const indicator = (text: string, index: number) => hits.wrap({ path: "", kind: SCROLL_KIND, index }, style.fg("dim", text));
	return [
		start > 0 ? indicator(`↑ ${start} more`, -1) : "",
		...lines.slice(start, end),
		end < lines.length ? indicator(`↓ ${lines.length - end} more`, 1) : "",
	];
}

function bottomBorder(width: number, style: Style, paint: (s: string) => string, tooltip: string, status: string): string {
	let line = paint("╰─");
	let used = 2;
	if (tooltip) {
		const room = width - 8 - (status ? visibleWidth(status) + 3 : 0);
		const text = fit(tooltip, Math.max(0, room));
		if (text) {
			line += ` ${style.fg("accent", "◇")} ${style.bold(text)} `;
			used += visibleWidth(text) + 4;
		}
	}
	const tail = status ? 3 + visibleWidth(status) : 0;
	line += paint("─".repeat(Math.max(0, width - used - tail - 1)));
	if (status) line += ` ${style.fg("muted", status)} ${paint("─")}`;
	return line + paint("╯");
}

export interface WidgetLayout {
	lines: string[];
	regions: HitRegion[];
}

/** The widget inside a rounded frame, plus where its pointer targets landed. Every line fits `width`. */
export function layoutWidget(rt: Runtime, width: number, style: Style, options: FrameOptions): WidgetLayout {
	const hits = new HitTable();
	const bodyHeight = options.maxHeight === undefined ? undefined : Math.max(3, options.maxHeight - 2);
	if (width < MIN_FRAMED) {
		const lines = windowAround(rt, renderBody(rt, width, style, options, hits), options.maxHeight, style, hits).map((l) => fit(l, width));
		return extractHits(lines, hits);
	}
	const inner = width - 4;
	const paint = (s: string) => style.border(s, options.live);
	const body = windowAround(rt, renderBody(rt, inner, style, options, hits), bodyHeight, style, hits);
	if (body.length === 0 && options.partial) body.push(style.fg("dim", "…"));

	const title = options.title ? fit(options.title, width - 8) : "";
	const top = title
		? paint("╭─ ") + style.fg("accent", "◆ ") + style.bold(title) + paint(` ${"─".repeat(Math.max(0, width - 7 - visibleWidth(title)))}╮`)
		: paint(`╭${"─".repeat(width - 2)}╮`);
	const status = options.status ? fit(options.status, width - 8) : "";
	const tooltip = options.partial ? "" : (rt.describeHover() ?? "");
	const bottom = bottomBorder(width, style, paint, tooltip, status);
	const side = paint("│");
	const lines = [top, ...body.map((line) => `${side} ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} ${side}`), bottom];
	return extractHits(lines, hits);
}

export function renderWidget(rt: Runtime, width: number, style: Style, options: FrameOptions): string[] {
	return layoutWidget(rt, width, style, options).lines;
}
