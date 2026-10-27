import { componentDef, componentNames } from "./core/registry.ts";

export const TOOL_NAME = "render_ui";

const EXAMPLE = JSON.stringify({
	title: "Loan",
	state: { rate: 6 },
	calc: { pay: "pmt(rate/1200, 360, 400000)" },
	view: [{ slider: "rate", max: 12, step: 0.25, unit: "%" }, { stat: "Monthly payment", value: "=pay", format: "currency" }],
});

/** The model-facing description, built from the registry so added components appear in it. */
export function buildDescription(): string {
	const components = componentNames()
		.map((name) => `${name} ${componentDef(name)!.doc}`)
		.join("\n");
	return `Show UI inline in the terminal chat: charts, tables, diagrams, dashboards, forms, calculators. It appears where you call it; keep writing after it. The user sees it, so don't restate its data.

Args {title?, view, state?, calc?, wait?}:
- view: a node or [nodes]. A node leads with its component, holding its main argument: {"bar": {"a": 3, "b": 5}, "sort": "desc"}.
- Inputs bind state keys. A string starting with "=" is JavaScript over state, calc and helpers (range, sum, avg, round, clamp, pmt, fmt, Math); text may embed {{expr}}. calc: {"name": "expr"}, evaluated in order on every change.
- Inputs don't block you. The user answers when they like and it reaches you as a new message, so finish your reply (say what you need) and stop. wait: true blocks until they answer; use it only when you can't continue without it. Calculators (every input feeds "=" values, no buttons) don't report back.
- To fix or update a widget, call again with the same title in the same reply; it replaces the earlier one.
- Fit one screen: about 25 lines, at most 3 items per row.

Components (main argument, then other props):
${components}
format: number|compact|percent|currency, with unit or prefix. tone: muted|accent|success|warning|error.

Example: ${EXAMPLE}`;
}

export const PROMPT_SNIPPET = "Show charts, tables, diagrams, forms and calculators inline in the terminal";

export const PROMPT_GUIDELINES = [
	`Use ${TOOL_NAME} when results have a visual shape (trend, comparison, distribution, hierarchy, flow) or you need the user to choose or fill something in, instead of Markdown tables or multiple-choice prose. Don't restate what a widget shows.`,
];
