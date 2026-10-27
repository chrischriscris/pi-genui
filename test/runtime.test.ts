import { describe, expect, test } from "bun:test";
import { renderWidget } from "../src/core/render.ts";
import { Runtime } from "../src/core/runtime.ts";
import { normalizeSpec } from "../src/core/spec.ts";
import { plainStyle } from "../src/core/style.ts";
import type { KeyEvent, Outcome } from "../src/core/types.ts";
import { EXAMPLES } from "../src/examples.ts";

function press(rt: Runtime, ...keys: Array<string | KeyEvent>): Outcome | undefined {
	let outcome: Outcome | undefined;
	for (const k of keys) {
		outcome = rt.key(typeof k === "string" ? (k.length === 1 ? { key: k, text: k } : { key: k, text: k === "space" ? " " : undefined }) : k);
		if (outcome) return outcome;
	}
	return outcome;
}

function view(rt: Runtime, width = 70): string {
	return renderWidget(rt, width, plainStyle, { live: true, partial: false, title: rt.spec.title }).join("\n");
}

describe("runtime", () => {
	test("display-only widgets are not interactive, even with tabs", () => {
		expect(new Runtime(normalizeSpec(EXAMPLES.dashboard)).interactive).toBe(false);
		expect(new Runtime(normalizeSpec(EXAMPLES.architecture)).interactive).toBe(false);
		const tabbed = { view: { type: "tabs", tabs: [{ label: "A", children: [{ type: "text", text: "a" }] }, { label: "B", children: [{ type: "text", text: "b" }] }] } };
		expect(new Runtime(normalizeSpec(tabbed)).interactive).toBe(false);
		expect(new Runtime(normalizeSpec(EXAMPLES.explore)).interactive).toBe(true);
	});

	test("single select: arrows choose, Enter submits", () => {
		const rt = new Runtime(normalizeSpec({ view: { type: "select", bind: "color", options: ["red", "green", "blue"] } }));
		expect(rt.state.color).toBe("red");
		expect(press(rt, "down", "down")).toBeUndefined();
		expect(rt.state.color).toBe("blue");
		expect(press(rt, "down")).toBeUndefined();
		expect(rt.state.color).toBe("blue");
		expect(press(rt, "1")).toBeUndefined();
		expect(rt.state.color).toBe("red");
		expect(press(rt, "enter")).toEqual({ status: "submitted" });
	});

	test("deploy form: fill fields and press a button", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.deploy));
		expect(rt.interactive).toBe(true);
		press(rt, "down");
		expect(rt.state.env).toBe("production");
		press(rt, "enter");
		press(rt, "space", "down", "down", "space");
		expect(rt.state.services).toEqual(["api", "worker"]);
		press(rt, "enter", "space");
		expect(rt.state.migrate).toBe(true);
		press(rt, "enter", "s", "h", "i", "p", "space", "i", "t", "backspace", "t");
		expect(rt.state.notes).toBe("ship it");
		console.log(view(rt));
		press(rt, "enter", "right");
		expect(press(rt, "enter")).toEqual({ status: "submitted", action: "dry-run" });
	});

	test("escape dismisses", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.deploy));
		expect(press(rt, "escape")).toEqual({ status: "dismissed" });
	});

	test("sliders recompute derived values", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.interest));
		const before = rt.derived.final as number;
		press(rt, "down", "down", "right", "right");
		expect(rt.state.rate).toBe(7);
		expect(rt.derived.final as number).toBeGreaterThan(before);
		press(rt, "shift+left");
		expect(rt.state.rate).toBe(2);
		press(rt, "down", "end");
		expect(rt.state.years).toBe(40);
		expect((rt.derived.balance as number[]).length).toBe(41);
		console.log(view(rt, 90));
	});

	test("table rows can be picked", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.pick));
		expect(rt.state.pr).toBe(4812);
		press(rt, "down", "down");
		expect(rt.state.pr).toBe(4807);
		console.log(view(rt, 80));
		expect(press(rt, "enter")).toEqual({ status: "submitted" });
	});

	test("tabs switch content and focus follows", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.explore));
		expect(rt.focusedPath).toBe("0");
		press(rt, "down");
		expect(rt.focusedPath).toBe("0.t0.0");
		press(rt, "right");
		expect(rt.state.metric).toBe("brotli");
		press(rt, "up", "right");
		expect(view(rt)).toContain("Total:");
		press(rt, "down");
		expect(rt.focusedPath).toBe("0");
	});

	test("tall live widgets scroll to keep focus on screen", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.deploy));
		const render = () => renderWidget(rt, 60, plainStyle, { live: true, partial: false, title: rt.spec.title, maxHeight: 12 });
		let lines = render();
		expect(lines.length).toBeLessThanOrEqual(12);
		expect(lines.join("\n")).toContain("❯ ● staging");
		expect(lines.join("\n")).toContain("↓");
		expect(lines.join("\n")).not.toContain("\x1b_");
		press(rt, "enter", "enter", "enter", "enter");
		lines = render();
		expect(lines.length).toBeLessThanOrEqual(12);
		expect(lines.join("\n")).toContain("Deploy ");
		expect(lines.join("\n")).toContain("↑");
	});

	test("submit label adds a final button", () => {
		const rt = new Runtime(normalizeSpec({ submit: "Save", view: [{ type: "input", bind: "name" }] }));
		press(rt, "a", "enter");
		expect(rt.focusedPath).toBe("1");
		expect(press(rt, "enter")).toEqual({ status: "submitted", action: "submit" });
		expect(rt.state.name).toBe("a");
	});
});
