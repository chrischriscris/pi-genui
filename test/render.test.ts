import { describe, expect, test } from "bun:test";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderWidget } from "../src/core/render.ts";
import { Runtime } from "../src/core/runtime.ts";
import { normalizeSpec } from "../src/core/spec.ts";
import { plainStyle } from "../src/core/style.ts";
import type { Style } from "../src/core/types.ts";
import { validate } from "../src/core/validate.ts";
import { EXAMPLES } from "../src/examples.ts";

const sgr = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const ansiStyle: Style = {
	fg: (_tone, text) => sgr(36)(text),
	series: (i, text) => sgr(31 + (i % 6))(text),
	bold: sgr(1),
	italic: sgr(3),
	inverse: sgr(7),
	border: (text, active) => sgr(active ? 35 : 90)(text),
	heading: sgr(1),
};

const WIDTHS = [18, 30, 44, 60, 80, 100, 140];

function expectFits(lines: string[], width: number, label: string) {
	for (const line of lines) {
		if (visibleWidth(line) > width) throw new Error(`${label} at ${width}: line is ${visibleWidth(line)} wide\n${line}`);
	}
}

describe("examples", () => {
	for (const [name, args] of Object.entries(EXAMPLES)) {
		test(`${name} validates`, () => {
			expect(validate(new Runtime(normalizeSpec(args)))).toEqual([]);
		});

		test(`${name} fits every width, live and static`, () => {
			for (const width of WIDTHS) {
				for (const style of [plainStyle, ansiStyle]) {
					for (const live of [false, true]) {
						const rt = new Runtime(normalizeSpec(args));
						const lines = renderWidget(rt, width, style, { live, partial: false, title: rt.spec.title, status: live ? undefined : "submitted" });
						expect(lines.length).toBeGreaterThan(2);
						expectFits(lines, width, name);
					}
				}
			}
		});

		test(`${name} renders while its arguments stream in`, () => {
			const json = JSON.stringify(args);
			for (let cut = 1; cut <= json.length; cut += 3) {
				const partial = parseStreamingJson(json.slice(0, cut));
				const rt = new Runtime(normalizeSpec(partial), { evaluate: false });
				expectFits(renderWidget(rt, 72, ansiStyle, { live: false, partial: true, title: rt.spec.title }), 72, `${name}@${cut}`);
			}
		});
	}
});

describe("rendering", () => {
	test("dashboard snapshot at 100 columns", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.dashboard));
		const out = renderWidget(rt, 100, plainStyle, { live: false, partial: false, title: rt.spec.title }).join("\n");
		expect(out).toContain("API latency");
		expect(out).toContain("p99");
		expect(out).toContain("/search");
	});

	test("unknown components and missing refs are reported", () => {
		const rt = new Runtime(normalizeSpec({ view: [{ type: "pie", data: [1] }, { type: "bar", data: "$nope" }] }));
		const errors = validate(rt);
		expect(errors.some((e) => e.includes('unknown component "pie"'))).toBe(true);
		expect(errors.some((e) => e.includes('"$nope" is not defined'))).toBe(true);
	});

	test("compute errors surface instead of throwing", () => {
		const rt = new Runtime(normalizeSpec({ compute: "while (true) {}", view: [{ type: "text", text: "x" }] }));
		expect(rt.error).toContain("timed out");
		const syntax = new Runtime(normalizeSpec({ compute: "return {", view: [{ type: "text", text: "x" }] }));
		expect(syntax.error).toContain("does not parse");
	});

	test("lenient argument shapes", () => {
		expect(normalizeSpec({ type: "bar", data: { a: 1 } }).view).toHaveLength(1);
		expect(normalizeSpec({ view: JSON.stringify([{ type: "text", text: "hi" }]) }).view).toHaveLength(1);
		expect(normalizeSpec(JSON.stringify({ spec: { view: { type: "text", text: "hi" } } })).view).toHaveLength(1);
		expect(normalizeSpec({ view: { type: "text", text: "x" }, submit: true }).submit).toBe("Submit");
	});

	test("templates in object keys resolve, and stacked sliders line up", () => {
		const rt = new Runtime(
			normalizeSpec({
				state: { years: 30, price: 5, rate: 6 },
				view: [
					{ type: "kv", items: { "Total of {{years}} payments": 1 } },
					{ type: "slider", bind: "price", label: "Home price" },
					{ type: "slider", bind: "rate", label: "Interest rate" },
				],
			}),
		);
		const lines = renderWidget(rt, 80, plainStyle, { live: false, partial: false });
		expect(lines.join("\n")).toContain("Total of 30 payments");
		const tracks = lines.filter((l) => l.includes("●")).map((l) => l.indexOf("━"));
		expect(new Set(tracks).size).toBe(1);
	});

	test("aliases map to components", () => {
		const rt = new Runtime(normalizeSpec({ view: [{ type: "bar-chart", data: { a: 1 } }, { type: "KPI", label: "x", value: 1 }, { type: "columns", children: [{ type: "text", text: "a" }] }] }));
		expect(validate(rt)).toEqual([]);
		expect(rt.interactive).toBe(false);
	});

	test("shorthand nodes: the component key holds its main argument", () => {
		const rt = new Runtime(
			normalizeSpec({
				view: [
					{ text: "Hello", style: "heading" },
					{ label: "CPU", progress: 42 },
					{ columns: [{ text: "a" }, { text: "b" }] },
					{ bar: { a: 1, b: 2 }, vertical: true },
					{ line: [1, 3, 2], spark: true },
					{ tabs: { One: [{ md: "**one**" }], Two: { note: "two", tone: "warning" } } },
				],
			}),
		);
		expect(validate(rt)).toEqual([]);
		const out = renderWidget(rt, 60, plainStyle, { live: false, partial: false }).join("\n");
		expect(out).toContain("Hello");
		expect(out).toContain("42%");
		expect(out).toContain(" One ");
	});

	test("calc and expressions recompute on every change", () => {
		const rt = new Runtime(
			normalizeSpec({
				state: { rate: 6 },
				calc: { pay: "pmt(rate / 1200, 360, 400000)" },
				view: [{ slider: "rate", max: 12, step: 0.5 }, { stat: "Monthly", value: "=round(pay)" }, { text: "At {{rate}}%: {{fmt(pay, 'currency')}}" }],
			}),
		);
		expect(validate(rt)).toEqual([]);
		expect(Math.round(rt.derived.pay as number)).toBe(2398);
		let out = renderWidget(rt, 60, plainStyle, { live: false, partial: false }).join("\n");
		expect(out).toContain("2398");
		expect(out).toContain("At 6%: $2,398");
		rt.key({ key: "right" });
		out = renderWidget(rt, 60, plainStyle, { live: false, partial: false }).join("\n");
		expect(out).toContain("At 6.5%");
		expect(rt.explorable).toBe(true);
		expect(rt.asks).toBe(false);
	});

	test("an = prefix on a template is forgiven", () => {
		const rt = new Runtime(normalizeSpec({ state: { ltv: 0.2 }, view: [{ text: "={{ (ltv * 100).toFixed(1) }}% of price" }] }));
		expect(validate(rt)).toEqual([]);
		expect(renderWidget(rt, 40, plainStyle, { live: false, partial: false }).join("\n")).toContain("20.0% of price");
	});

	test("bad expressions and missing props come back with the component's usage", () => {
		const rt = new Runtime(normalizeSpec({ view: [{ stat: "x", value: "=nope + 1" }, { slider: "rate", label: "Rate" }, { bar: "=1 +" }, { select: "a" }] }));
		const errors = validate(rt).join("\n");
		expect(errors).toContain("nope is not defined");
		expect(errors).toContain('"=1 +" does not parse');
		expect(errors).toContain('missing "options"; usage: {"select": "key" options');
	});

	test("bound names must be plain identifiers", () => {
		const rt = new Runtime(normalizeSpec({ state: { pick: "" }, view: [{ table: [{ name: "jdff" }, { name: "sift" }], bind: "+pick" }] }));
		expect(validate(rt).join("\n")).toContain('bind "+pick" is not a plain state name; use "pick"');
	});

	test("charts take expressions wrapped in brackets and props nested in their data", () => {
		const draw = (node: Record<string, unknown>) => renderWidget(new Runtime(normalizeSpec({ state: { years: 30 }, calc: { bal: "range(11).map(i => 300 - i * 30)", lbl: "range(11).map(i => String(i * 3))" }, view: [node] })), 60, plainStyle, { live: false, partial: false }).join("\n");
		const expected = draw({ line: "=bal", labels: "=lbl" });
		expect(expected).toContain("30");
		expect(expected).not.toContain("0, 3");
		expect(draw({ line: { series: ["=bal"] }, labels: ["=lbl"] })).toBe(expected);
		expect(draw({ line: { series: ["=bal"], labels: ["=lbl"] } })).toBe(expected);
		expect(draw({ line: ["=bal"], labels: "=lbl" })).toBe(expected);
		expect(draw({ line: { series: ["=bal"] }, spark: true })).toBe(draw({ line: "=bal", spark: true }));
		expect(draw({ bar: ["=bal"], vertical: true })).toBe(draw({ bar: "=bal", vertical: true }));
	});

	test("a header row inside table data becomes the header", () => {
		const draw = (node: Record<string, unknown>) => renderWidget(new Runtime(normalizeSpec({ view: [node] })), 60, plainStyle, { live: false, partial: false }).join("\n");
		const rows = [["Day", "Plan"], ["1", "Asakusa"], ["2", "Shibuya"]];
		for (const out of [draw({ table: rows }), draw({ table: rows, columns: ["Day", "Plan"] })]) {
			expect(out.match(/Day/g)?.length).toBe(1);
			expect(out).toContain("Asakusa");
		}
	});

	test("no negative zero, and made-up cell markup shows its text", () => {
		const draw = (node: Record<string, unknown>) => renderWidget(new Runtime(normalizeSpec({ view: [node] })), 60, plainStyle, { live: false, partial: false }).join("\n");
		expect(draw({ line: [3, 2, 1, -0.0004] })).not.toMatch(/-0\b/);
		expect(draw({ stat: "Price", value: 470000, unit: "$" })).toContain("$470,000");
		const table = draw({ table: [[{ b: "Name" }, { b: "Why" }], ["twain", "two documents"]] });
		expect(table).toContain("Name");
		expect(table).not.toContain('{"b"');
	});

	test("charts don't grow past one screen", () => {
		const draw = (node: Record<string, unknown>) => renderWidget(new Runtime(normalizeSpec({ view: [node] })), 60, plainStyle, { live: false, partial: false });
		const line = { line: [9, 7, 8, 4, 2, 0] };
		const bars = { bar: { a: 3, b: 5 }, vertical: true };
		expect(draw({ ...line, height: 150 })).toEqual(draw({ ...line, height: 16 }));
		expect(draw({ ...bars, height: 150 })).toEqual(draw({ ...bars, height: 16 }));
	});

	test("questions ask, calculators explore", () => {
		expect(new Runtime(normalizeSpec(EXAMPLES.deploy)).asks).toBe(true);
		expect(new Runtime(normalizeSpec(EXAMPLES.pick)).asks).toBe(true);
		expect(new Runtime(normalizeSpec(EXAMPLES.interest)).explorable).toBe(true);
		expect(new Runtime(normalizeSpec(EXAMPLES.explore)).asks).toBe(false);
		// A calc for display doesn't make a question a calculator; only inputs that feed values do.
		const trip = { state: { areas: [] }, calc: { total: "450 + 330" }, view: [{ stat: "Total", value: "=total" }, { multi: "areas", options: ["Shinjuku", "Asakusa"] }] };
		expect(new Runtime(normalizeSpec(trip)).asks).toBe(true);
		expect(new Runtime(normalizeSpec({ ...trip, view: [...trip.view, { text: "{{areas.length}} picked" }] })).explorable).toBe(true);
	});

	test("calc runs in dependency order and takes typographic operators", () => {
		const rt = new Runtime(normalizeSpec({ state: { home: 600, down: 20 }, calc: { pay: "principal × 2", principal: "home − home * down / 100" }, view: [{ stat: "Pay", value: "=pay ÷ 2" }] }));
		expect(validate(rt)).toEqual([]);
		expect(rt.derived).toEqual({ pay: 960, principal: 480 });
		expect(renderWidget(rt, 40, plainStyle, { live: false, partial: false }).join("\n")).toContain("480");
	});
});

