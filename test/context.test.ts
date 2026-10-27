import { describe, expect, test } from "bun:test";
import { EXAMPLES } from "../src/examples.ts";
import { compressWidgets, summarizeSpec } from "../src/pi/context.ts";

const call = (id: string, args: Record<string, unknown>) => ({ role: "assistant", content: [{ type: "text", text: "here" }, { type: "toolCall", id, name: "render_ui", arguments: args }] });
const result = (id: string, text: string) => ({ role: "toolResult", toolCallId: id, toolName: "render_ui", content: [{ type: "text", text }] });
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

describe("context compression", () => {
	test("summaries name what was shown", () => {
		expect(summarizeSpec(EXAMPLES.dashboard)).toBe("line(2), bar(4), stat×3, progress×3");
		expect(summarizeSpec(EXAMPLES.deploy)).toBe("select, multi, toggle, input, buttons; inputs env, services, migrate, notes");
	});

	test("older widgets are trimmed, the newest stays whole", () => {
		const rows = Array.from({ length: 40 }, (_, i) => ({ city: `City ${i}`, population: 1000 * i }));
		const big = { title: "Cities", calc: { total: "sum(rows.map(r => r.population))" }, view: [{ table: rows }, { md: "x".repeat(400) }, { stat: "Total", value: "=total" }] };
		const messages = [user("a"), call("w1", big), result("w1", "Shown."), user("b"), call("w2", EXAMPLES.deploy!), result("w2", "Shown, waiting."), user("c")];
		const out = compressWidgets(messages, "render_ui");
		const first = (out[1]!.content as Array<{ arguments?: { view: Array<Record<string, unknown>>; calc: unknown } }>)[1]!.arguments!;
		expect((first.view[0]!.table as unknown[]).length).toBe(3);
		expect((first.view[1]!.md as string).length).toBe(161);
		expect(first.view[2]).toEqual({ stat: "Total", value: "=total" });
		expect(first.calc).toEqual(big.calc);
		expect(JSON.stringify(first)).not.toContain("elided");
		expect((out[2]!.content as Array<{ text: string }>)[0]!.text).toBe("Shown.\n[Earlier widget: table(40 rows), md, stat]");
		expect(out[4]).toBe(messages[4]);
		expect(JSON.stringify(out[1]).length).toBeLessThan(JSON.stringify(messages[1]).length / 4);
	});

	test("widgets of the current turn are left alone", () => {
		const messages = [user("a"), call("w1", EXAMPLES.dashboard!), result("w1", "Shown."), call("w2", EXAMPLES.deploy!), result("w2", "Shown.")];
		expect(compressWidgets(messages, "render_ui")).toBe(messages);
	});
});
