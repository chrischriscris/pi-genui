import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerComponent } from "../core/registry.ts";
import { type PointerMode, Runtime, SUBMIT_ACTION } from "../core/runtime.ts";
import { normalizeSpec } from "../core/spec.ts";
import { display } from "../core/text.ts";
import type { ComponentDef, Outcome } from "../core/types.ts";
import { validate } from "../core/validate.ts";
import { EXAMPLE_NAMES, EXAMPLES } from "../examples.ts";
import { buildDescription, PROMPT_GUIDELINES, PROMPT_SNIPPET, TOOL_NAME } from "../prompt.ts";
import { compressWidgets } from "./context.ts";
import { Controller, EMPTY, piStyle, reveal, scrollToEnd, WidgetView, watchPointer } from "./view.ts";

const ANSWER_TYPE = "genui-answer";
const DEMO_TYPE = "genui-demo";
const FOCUS_KEY = "alt+g";

// Node props are free-form and documented in the description, which keeps the schema small.
const Node = Type.Object({}, { additionalProperties: true });
const Params = Type.Object({
	title: Type.Optional(Type.String()),
	view: Type.Union([Node, Type.Array(Node)]),
	state: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	calc: Type.Optional(Type.Record(Type.String(), Type.String())),
	wait: Type.Optional(Type.Boolean()),
	submit: Type.Optional(Type.String()),
});

type Status = "shown" | "pending" | "submitted" | "dismissed" | "unavailable";

interface Details {
	status: Status;
	action?: string;
	state?: Record<string, unknown>;
	/** Tool call id of the widget this one replaced. */
	replaces?: string;
}

interface Answer {
	status: "submitted" | "dismissed";
	action?: string;
	state: Record<string, unknown>;
}

interface AnswerDetails extends Answer {
	toolCallId: string;
	title?: string;
}

function text(value: string) {
	return [{ type: "text" as const, text: value }];
}

function json(value: unknown, max = 800): string {
	const out = JSON.stringify(value);
	return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Computed values worth telling the model: scalars only, never the series behind a chart. */
function computed(rt: Runtime): string {
	const scalars = Object.entries(rt.derived).filter(([, v]) => ["number", "string", "boolean"].includes(typeof v)).slice(0, 12);
	return scalars.length > 0 ? ` Computed: ${json(Object.fromEntries(scalars), 400)}` : "";
}

function pressed(action: string | undefined): string {
	return action && action !== SUBMIT_ACTION ? ` (pressed "${action}")` : "";
}

function answerText(title: string | undefined, answer: Answer): string {
	const what = title ? `"${title}"` : "the widget";
	if (answer.status === "dismissed") return `[${TOOL_NAME}] The user closed ${what} without answering. Values: ${json(answer.state)}`;
	return `[${TOOL_NAME}] The user answered ${what}${pressed(answer.action)}: ${json(answer.state)}`;
}

function values(state: Record<string, unknown>): string {
	return Object.entries(state)
		.map(([k, v]) => `${k} ${display(v) || "–"}`)
		.join(" · ");
}

function errorView(message: string, theme: Theme, expanded: boolean): Component {
	const lines = message.split("\n");
	const shown = expanded ? lines : lines.slice(0, 8);
	const more = lines.length - shown.length;
	return new Text(theme.fg("error", `✗ ${shown.join("\n  ")}`) + (more > 0 ? theme.fg("muted", `\n  … ${more} more lines (expand to see)`) : ""), 1, 0);
}

export default function genui(pi: ExtensionAPI) {
	// Per session: widget runtimes by tool call (or demo) id, their answers, and which one has the keyboard.
	const widgets = new Map<string, Runtime>();
	const answers = new Map<string, Answer>();
	const redraw = new Map<string, () => void>();
	const views = new Map<string, WidgetView>();
	// A widget shown again under the same title in one run replaces the earlier one, which shrinks to a line.
	const replaced = new Set<string>();
	const shownThisRun = new Map<string, string>();
	let focused: string | undefined;
	let session: ExtensionContext | undefined;
	let stopWatching: (() => void) | undefined;

	function modeOf(id: string, rt: Runtime): PointerMode {
		if (focused === id) return "live";
		if (answers.has(id) || replaced.has(id)) return "view";
		if (rt.asks) return "pending";
		return rt.explorable ? "explore" : "view";
	}

	function statusOf(id: string, rt: Runtime): string | undefined {
		const answer = answers.get(id);
		if (answer) return answer.status === "dismissed" ? "closed" : answer.action && answer.action !== SUBMIT_ACTION ? `✓ ${answer.action}` : "✓ answered";
		if (focused === id || !rt.interactive) return undefined;
		return rt.asks ? `waiting for you · ${FOCUS_KEY}` : `${FOCUS_KEY} to use keys`;
	}

	/** Hand the keyboard to a widget until it is answered or the user leaves it. */
	async function takeKeyboard(id: string, rt: Runtime, kind: "wait" | "focus", ui: ExtensionUIContext, signal?: AbortSignal): Promise<Outcome> {
		focused = id;
		redraw.get(id)?.();
		let moved: Promise<boolean> | undefined;
		let host: Parameters<typeof scrollToEnd>[0] | undefined;
		try {
			return await ui.custom<Outcome>((tui, theme, _kb, done) => {
				signal?.addEventListener("abort", () => done({ status: "dismissed" }), { once: true });
				rt.finish = done;
				host = tui;
				// A widget picked up after the turn may be far up the transcript.
				const widget = views.get(id);
				if (kind === "focus" && widget) moved = reveal(tui, widget);
				return new Controller(rt, tui, theme, done, kind);
			});
		} finally {
			rt.finish = undefined;
			focused = undefined;
			redraw.get(id)?.();
			if (host && (await moved)) scrollToEnd(host);
		}
	}

	function answer(id: string, rt: Runtime, outcome: Outcome): void {
		if (answers.has(id)) return;
		const result: Answer = { status: outcome.status, action: outcome.action, state: rt.state };
		answers.set(id, result);
		rt.version++;
		redraw.get(id)?.();
		if (id.startsWith("demo:")) {
			session?.ui.notify(`${outcome.status}${pressed(outcome.action)}: ${json(rt.state)}`, "info");
			return;
		}
		const details: AnswerDetails = { ...result, toolCallId: id, title: rt.spec.title };
		const busy = session ? !session.isIdle() : false;
		void pi.sendMessage({ customType: ANSWER_TYPE, content: answerText(rt.spec.title, result), display: true, details }, { triggerTurn: true, ...(busy && { deliverAs: "followUp" as const }) });
	}

	/** A pending question or a calculator, picked up with the keyboard after the turn. */
	async function focusWidget(id: string, ui = session?.ui): Promise<void> {
		const rt = widgets.get(id);
		if (!rt || !ui || focused || answers.has(id) || !rt.interactive) return;
		const outcome = await takeKeyboard(id, rt, "focus", ui);
		if (outcome.status === "submitted" && rt.asks) answer(id, rt, outcome);
	}

	/** The earlier widget with this title in this run, unless it was answered; it gets replaced. */
	function replace(id: string, title: string | undefined): string | undefined {
		if (!title) return undefined;
		const earlier = shownThisRun.get(title);
		shownThisRun.set(title, id);
		if (!earlier || answers.has(earlier) || focused === earlier) return undefined;
		replaced.add(earlier);
		redraw.get(earlier)?.();
		return earlier;
	}

	function view(id: string, rt: Runtime, theme: Theme, pad: number, requestRender?: () => void): WidgetView {
		if (requestRender) redraw.set(id, requestRender);
		const widget = new WidgetView(
			() => ({
				rt,
				collapsed: replaced.has(id) ? `◇ ${rt.spec.title} · updated below` : undefined,
				options: { live: focused === id, partial: false, title: rt.spec.title, status: statusOf(id, rt) },
				mode: modeOf(id, rt),
				onAnswer: (outcome) => answer(id, rt, outcome),
				onWantsKeyboard: () => void focusWidget(id),
			}),
			piStyle(theme),
			pad,
			requestRender,
		);
		views.set(id, widget);
		return widget;
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: "UI",
		description: buildDescription(),
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: Params,
		renderShell: "self",
		executionMode: "sequential",
		// Components registered by other extensions after load show up in the description too.
		prepareLoadout: () => ({ descriptions: { [TOOL_NAME]: buildDescription() } }),
		// Models sometimes send the spec as a JSON string or without the "view" wrapper; accept both.
		prepareArguments: (args) => {
			const { title, view, state, calc, compute, submit, wait } = normalizeSpec(args);
			return { view: view as Record<string, unknown>[], state, ...(title && { title }), ...(calc && { calc }), ...(compute && { compute }), ...(submit && { submit }), ...(wait && { wait }) };
		},

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const spec = normalizeSpec(params);
			const rt = new Runtime(spec);
			const errors = validate(rt);
			if (errors.length > 0) throw new Error(`Nothing was shown; fix the spec and call ${TOOL_NAME} again:\n- ${errors.join("\n- ")}`);
			if (rt.interactive && ctx.mode !== "tui") {
				return { content: text("No interactive terminal here, so its inputs can't be used. Ask in plain text instead."), details: { status: "unavailable" } satisfies Details };
			}
			const replaces = replace(toolCallId, spec.title);
			const shown = replaces ? `Shown in place of the earlier "${spec.title}"` : "Shown";
			if (!rt.interactive) return { content: text(`${shown}.${computed(rt)}`), details: { status: "shown", state: rt.state, replaces } satisfies Details };
			widgets.set(toolCallId, rt);
			if (spec.wait) {
				const outcome = await takeKeyboard(toolCallId, rt, "wait", ctx.ui, signal);
				const result: Answer = { status: outcome.status, action: outcome.action, state: rt.state };
				answers.set(toolCallId, result);
				return { content: text(`${answerText(spec.title, result)}${computed(rt)}`), details: { ...result, replaces } satisfies Details };
			}
			if (rt.asks) {
				return { content: text(`${shown}, waiting for the user. Their answer arrives as a new message; finish your reply now and stop.`), details: { status: "pending", state: rt.state, replaces } satisfies Details };
			}
			return { content: text(`${shown}; the user can play with it, and it doesn't report back.${computed(rt)}`), details: { status: "shown", state: rt.state, replaces } satisfies Details };
		},

		renderCall(args, theme, context) {
			// Once the result arrives, renderResult draws the widget.
			if (!context.isPartial) return EMPTY;
			const id = context.toolCallId;
			const spec = normalizeSpec(args);
			const preview = new Runtime(spec, { evaluate: context.argsComplete });
			redraw.set(id, context.invalidate);
			return new WidgetView(
				() => {
					// A blocking call: the widget is live while the tool runs.
					const rt = widgets.get(id);
					if (rt && focused === id) return { rt, options: { live: true, partial: false, title: rt.spec.title }, mode: "live" };
					return { rt: preview, options: { live: false, partial: !context.argsComplete, title: spec.title }, mode: undefined };
				},
				piStyle(theme),
				context.outputPad,
				context.invalidate,
			);
		},

		renderResult(result, options, theme, context) {
			if (options.isPartial) return EMPTY;
			if (context.isError) {
				const first = result.content.find((c) => c.type === "text");
				return errorView(first?.type === "text" ? first.text : `${TOOL_NAME} failed`, theme, options.expanded);
			}
			const details = result.details as Details | undefined;
			if (details?.status === "unavailable") return EMPTY;
			const id = context.toolCallId;
			let rt = widgets.get(id);
			if (!rt) {
				// Rebuilt after a reload: answered blocking calls carry their answer in the result.
				if (!answers.has(id) && (details?.status === "submitted" || details?.status === "dismissed")) {
					answers.set(id, { status: details.status, action: details.action, state: details.state ?? {} });
				}
				rt = new Runtime(normalizeSpec(context.args), { state: answers.get(id)?.state ?? details?.state });
				widgets.set(id, rt);
			}
			return view(id, rt, theme, context.outputPad, context.invalidate);
		},
	});

	pi.registerMessageRenderer<AnswerDetails>(ANSWER_TYPE, (message, { outputPad }, theme) => {
		const d = message.details;
		const what = d?.title ? `«${d.title}»` : "the widget";
		const head = d?.status === "dismissed" ? `closed ${what}` : `answered ${what}${d?.action && d.action !== SUBMIT_ACTION ? ` · ${d.action}` : ""}`;
		return new Text(`${theme.fg("accent", "↳ ")}${theme.fg("muted", `${head}: `)}${values(d?.state ?? {})}`, outputPad, 0);
	});

	// Old widget specs are large and rarely needed again: keep them out of what the model re-reads.
	pi.on("context", (event) => ({ messages: compressWidgets(event.messages as never[], TOOL_NAME) }));

	pi.on("session_start", (_event, ctx) => {
		session = ctx;
		widgets.clear();
		answers.clear();
		redraw.clear();
		views.clear();
		replaced.clear();
		shownThisRun.clear();
		focused = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === TOOL_NAME) {
				const replaces = (entry.message.details as Details | undefined)?.replaces;
				if (replaces) replaced.add(replaces);
			}
			if (entry.type !== "custom_message" || entry.customType !== ANSWER_TYPE) continue;
			const d = entry.details as AnswerDetails | undefined;
			if (d?.toolCallId) answers.set(d.toolCallId, { status: d.status, action: d.action, state: d.state });
		}
		if (ctx.mode === "tui") stopWatching = ctx.ui.onTerminalInput(watchPointer);
	});
	pi.on("agent_start", () => shownThisRun.clear());
	pi.on("session_shutdown", () => {
		stopWatching?.();
		stopWatching = undefined;
	});

	pi.registerShortcut(FOCUS_KEY, {
		description: "Use the keyboard on the latest widget waiting for input",
		handler: async (ctx) => {
			const id = [...widgets.keys()].reverse().find((k) => !answers.has(k) && !replaced.has(k) && widgets.get(k)!.interactive);
			if (!id) {
				ctx.ui.notify("No widget is waiting for input", "info");
				return;
			}
			await focusWidget(id, ctx.ui);
		},
	});

	// Other extensions add components with pi.events.emit("genui:component", { name, def, aliases? }).
	pi.events.on("genui:component", (data) => {
		const { name, def, aliases } = (data ?? {}) as { name?: string; def?: ComponentDef; aliases?: Record<string, Record<string, unknown> | undefined> };
		if (typeof name === "string" && typeof def?.render === "function") registerComponent(name, def, aliases);
	});
	pi.events.emit("genui:ready", { registerComponent });

	pi.registerEntryRenderer<{ id: string; name: string }>(DEMO_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data || !EXAMPLES[data.name]) return undefined;
		let rt = widgets.get(data.id);
		if (!rt) {
			rt = new Runtime(normalizeSpec(EXAMPLES[data.name]));
			widgets.set(data.id, rt);
		}
		return view(data.id, rt, theme, 1);
	});

	pi.registerCommand(DEMO_TYPE, {
		description: `Show an example ${TOOL_NAME} widget without asking the model (${EXAMPLE_NAMES.join(", ")})`,
		getArgumentCompletions: (prefix) =>
			EXAMPLE_NAMES.filter((n) => n.startsWith(prefix.trim())).map((n) => ({ value: n, label: n, description: String(EXAMPLES[n]!.title ?? "") })),
		handler: async (args, ctx) => {
			const name = args.trim() || "dashboard";
			if (!EXAMPLES[name]) {
				ctx.ui.notify(`Unknown example "${name}". Try: ${EXAMPLE_NAMES.join(", ")}`, "error");
				return;
			}
			const id = `demo:${name}-${Date.now()}`;
			const rt = new Runtime(normalizeSpec(EXAMPLES[name]));
			widgets.set(id, rt);
			pi.appendEntry(DEMO_TYPE, { id, name });
			if (rt.interactive && ctx.mode === "tui") await focusWidget(id, ctx.ui);
		},
	});
}
