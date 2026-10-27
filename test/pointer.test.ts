import { describe, expect, test } from "bun:test";
import type { HitRegion } from "../src/core/hit.ts";
import { type MouseInput, PointerController } from "../src/core/pointer.ts";
import { layoutWidget, type WidgetLayout } from "../src/core/render.ts";
import { type PointerMode, Runtime } from "../src/core/runtime.ts";
import { normalizeSpec } from "../src/core/spec.ts";
import { plainStyle } from "../src/core/style.ts";
import { EXAMPLES } from "../src/examples.ts";

const WIDTH = 90;

class Harness {
	readonly rt: Runtime;
	readonly pointer: PointerController;
	layout!: WidgetLayout;

	constructor(
		args: Record<string, unknown>,
		readonly mode: PointerMode,
	) {
		this.rt = new Runtime(normalizeSpec(args));
		this.pointer = new PointerController(this.rt);
		this.draw();
	}

	draw(): string {
		this.layout = layoutWidget(this.rt, WIDTH, plainStyle, { live: this.mode === "live", partial: false, title: this.rt.spec.title });
		return this.layout.lines.join("\n");
	}

	region(kind: string, index?: number): HitRegion {
		const found = this.layout.regions.find((r) => r.target.kind === kind && (index === undefined || r.target.index === index));
		if (!found) throw new Error(`no ${kind}${index ?? ""} region in\n${this.draw()}`);
		return found;
	}

	send(type: MouseInput["type"], region: HitRegion, at = 0.5) {
		const x = region.start + Math.round(at * (region.end - region.start - 1));
		const result = this.pointer.handle({ type, button: type === "move" ? "none" : "left", x, y: region.line }, this.layout.regions, this.mode);
		this.draw();
		return result;
	}

	click(region: HitRegion, at = 0.5) {
		this.send("press", region, at);
		return this.send("click", region, at);
	}
}

describe("pointer", () => {
	test("clicking options, checkboxes and toggles edits a live form", () => {
		const h = new Harness(EXAMPLES.deploy!, "live");
		h.click(h.region("option", 1));
		expect(h.rt.state.env).toBe("production");
		h.click(h.region("check", 2));
		h.click(h.region("check", 0));
		expect(h.rt.state.services).toEqual(["api", "worker"]);
		h.click(h.region("toggle"));
		expect(h.rt.state.migrate).toBe(true);
		h.click(h.region("input"));
		expect(h.rt.focusedPath).toBe("3");
		expect(h.click(h.region("button", 1))?.outcome).toEqual({ status: "submitted", action: "dry-run" });
	});

	test("a question without buttons gets a Submit for the mouse, and Enter still submits", () => {
		const args = { title: "Neighborhoods", view: [{ multi: "hoods", options: ["Shinjuku", "Asakusa"] }] };
		const h = new Harness(args, "pending");
		h.click(h.region("check", 1));
		expect(h.rt.state.hoods).toEqual(["Asakusa"]);
		expect(h.click(h.region("button", 0))?.outcome).toEqual({ status: "submitted", action: "submit" });

		const keys = new Runtime(normalizeSpec(args));
		expect(keys.focusedIsLast).toBe(true);
		expect(keys.key({ key: "enter" })).toEqual({ status: "submitted" });

		expect(new Harness(EXAMPLES.interest!, "explore").draw()).not.toContain("Submit");
		expect(new Harness(EXAMPLES.deploy!, "pending").draw()).not.toContain("Submit");
	});

	test("a finished form is frozen, but tabs still switch", () => {
		const form = new Harness(EXAMPLES.deploy!, "view");
		form.click(form.region("option", 2));
		expect(form.rt.state.env).toBe("staging");
		expect(form.click(form.region("button", 0))?.outcome).toBeUndefined();

		const tabs = new Harness(EXAMPLES.explore!, "view");
		tabs.click(tabs.region("tab", 1));
		expect(tabs.draw()).toContain("Total:");
	});

	test("sliders follow press and drag, also after the turn in an explorable widget", () => {
		const h = new Harness(EXAMPLES.interest!, "explore");
		expect(h.rt.explorable).toBe(true);
		const track = h.layout.regions.filter((r) => r.target.kind === "slider")[2]!;
		expect(h.send("press", track, 1)?.capture).toBe(true);
		expect(h.rt.state.rate).toBe(15);
		h.send("drag", track, 0);
		expect(h.rt.state.rate).toBe(0);
		h.send("drag", track, 0.5);
		expect(h.rt.state.rate).toBe(7.5);
		h.send("release", track);
		expect(h.rt.derived.final).toBeGreaterThan(0);
	});

	test("hover highlights and explains bars, cells and table rows", () => {
		const dash = new Harness(EXAMPLES.dashboard!, "view");
		dash.send("move", dash.region("bar", 1));
		expect(dash.draw()).toContain("◇ /checkout: 1210 ms (30% of total)");

		const activity = new Harness(EXAMPLES.activity!, "view");
		const cell = activity.layout.regions.find((r) => r.target.kind === "cell" && r.target.row === 1 && r.target.col === 3)!;
		activity.send("move", cell);
		expect(activity.draw()).toContain("◇ Tue · 14: 15");

		const pick = new Harness(EXAMPLES.pick!, "view");
		pick.send("move", pick.region("row", 3));
		expect(pick.draw()).toContain("◇ id: 4790 · title: Upgrade to Postgres 17 driver");
	});

	test("hovering a line chart shows a crosshair and every series' value", () => {
		const h = new Harness(EXAMPLES.dashboard!, "view");
		const plot = h.region("plot");
		h.send("move", plot, 5 / 11);
		const out = h.draw();
		expect(out).toContain("◇ 05:00 · p50 88ms · p99 1210ms");
		expect(out).toContain("●");
		expect(out).toContain("│");
	});

	test("clicking a visible control in a scrolled widget doesn't move the content", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.deploy!));
		const pointer = new PointerController(rt);
		const draw = () => layoutWidget(rt, 70, plainStyle, { live: true, partial: false, maxHeight: 14 });
		let layout = draw();
		const before = layout.lines.join("\n");
		const check = layout.regions.find((r) => r.target.kind === "check" && r.target.index === 2)!;
		pointer.handle({ type: "press", button: "left", x: check.start + 4, y: check.line }, layout.regions, "live");
		pointer.handle({ type: "click", button: "left", x: check.start + 4, y: check.line }, layout.regions, "live");
		layout = draw();
		expect(rt.state.services).toEqual(["worker"]);
		expect(rt.focusedPath).toBe("1");
		// Same rows in the same places; only the checkbox and focus marker changed.
		const strip = (s: string) => s.replace(/\[x\]|❯/g, "").replace(/\[ \]/g, "");
		expect(strip(layout.lines.join("\n")).replace(/\s+/g, " ")).toBe(strip(before).replace(/\s+/g, " "));
		// Keyboard focus moving past the window still scrolls it.
		for (let i = 0; i < 3; i++) rt.key({ key: "enter" });
		expect(draw().lines.join("\n")).toContain("Deploy ");
	});

	test("the wheel and the more-indicators scroll a cut-off widget, and focus doesn't pull it back", () => {
		const rt = new Runtime(normalizeSpec(EXAMPLES.deploy!));
		const pointer = new PointerController(rt);
		const draw = () => layoutWidget(rt, 70, plainStyle, { live: true, partial: false, maxHeight: 12 });
		let layout = draw();
		expect(layout.lines.join("\n")).not.toContain("Deploy ");
		for (let i = 0; i < 4; i++) {
			pointer.handle({ type: "wheel", button: "none", x: 5, y: 5, wheel: 1 }, layout.regions, "live");
			layout = draw();
		}
		expect(layout.lines.join("\n")).toContain("Deploy ");
		const up = layout.regions.find((r) => r.target.kind === "scroll" && r.target.index === -1)!;
		pointer.handle({ type: "press", button: "left", x: up.start, y: up.line }, layout.regions, "live");
		pointer.handle({ type: "click", button: "left", x: up.start, y: up.line }, layout.regions, "live");
		expect(draw().lines.join("\n")).toContain("Environment");
		// Without windowing the wheel is left to the host.
		const plain = layoutWidget(rt, 70, plainStyle, { live: true, partial: false });
		expect(pointer.handle({ type: "wheel", button: "none", x: 5, y: 5, wheel: 1 }, plain.regions, "live")).toBeUndefined();
	});

	test("moving off every target clears hover", () => {
		const h = new Harness(EXAMPLES.dashboard!, "view");
		h.send("move", h.region("bar", 0));
		expect(h.rt.hover).toBeDefined();
		h.pointer.handle({ type: "move", button: "none", x: 0, y: 0 }, h.layout.regions, "view");
		expect(h.rt.hover).toBeUndefined();
	});
});
