// Records the launch demo: Pi + pi-genui driven in a Rex session of its own, against the real model.
// Each scene starts from /new so it opens on a clean screen, and marks its beats for the edit
// (scripts/build-timeline.ts cuts and captions by these names).
//
//   bun record/launch.ts [recordings/launch.json]
import { join } from "node:path";
import { Recorder } from "./rex.ts";

const ROOT = join(import.meta.dir, "..", "..");
const out = process.argv[2] ?? join(import.meta.dir, "..", "recordings", "launch.json");
const MODEL = process.env.PI_MODEL ?? "opencode-go/deepseek-v4.1-flash";

const r = new Recorder(118, 34, "pi-genui launch (recording)");
// The stage folder's .pi/settings.json hides thinking; --approve trusts it for this run only.
r.launch("", join(import.meta.dir, "stage"), { COLORTERM: "truecolor", PI_OFFLINE: "1" }, [
	`${process.env.HOME}/.local/bin/pi`,
	"--approve",
	"--model",
	MODEL,
	"--session-dir",
	join(import.meta.dir, "sessions"),
	"-e",
	join(ROOT, "src", "index.ts"),
]);

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`);
const busy = (s: string) => /Working/.test(s);
const live = (s: string) => /◆ .*(←→|↑↓|Space|type to edit|Enter (next|submit|press))/.test(s.split("\n").slice(-6).join("\n"));
const lines = () => r.plain().split("\n");
const col = (l: string, i: number) => [...l.slice(0, i)].length;
const buttons = () => lines().flatMap((l, y) => [...l.matchAll(/\[ ([A-Za-z][^\]]{0,40}) \]/g)].map((m) => ({ label: m[1]!, y })));

async function command(text: string) {
	await r.type(text, 60);
	await r.key("Enter", 250);
	// The first Enter may only accept the autocompletion.
	if (lines().some((l) => l.includes(text))) await r.key("Enter", 250);
	await r.pause(900);
}

async function ask(scene: string, prompt: string) {
	r.mark(`${scene}.type`);
	await r.type(prompt, 40);
	await r.pause(300);
	r.mark(`${scene}.sent`);
	await r.key("Enter", 200);
	await r.waitFor(busy, 15_000, "run start");
}

async function untilIdle(timeout = 180_000) {
	await r.waitFor((s) => !busy(s), timeout, "idle");
	for (let i = 0; i < 3 && live(r.plain()); i++) {
		log("unexpected live widget; submitting it");
		await r.key("Enter", 400);
		await r.waitFor((s) => !busy(s) && !live(s), timeout, "idle after submit");
	}
	await r.pause(600);
}

/** Until the model is done, or a widget holds the keyboard; true for the latter. */
async function untilIdleOrLive(timeout = 180_000): Promise<boolean> {
	await r.waitFor((s) => live(s) || !busy(s), timeout, "idle or live");
	await r.pause(600);
	return live(r.plain());
}

await r.waitFor((s) => s.includes(MODEL.split("/").pop()!), 25_000, "pi start");
await r.pause(1200);
r.mark("start");

const scenes: Record<string, () => Promise<void>> = {
	// 1. A chart in the middle of an answer; the model keeps writing after it.
	s1: async () => {
		log("1. cities");
		await ask("s1", "Compare the 6 most populous US cities by population, then tell me one surprising thing about the ranking. Rough numbers from memory, no need to search.");
		await untilIdle();
		r.mark("s1.idle");
		await r.pause(800);
		// A long reply pushes the chart up: scroll back to it, as you would.
		const barRows = () => lines().filter((l) => /█/.test(l)).length;
		for (let i = 0; i < 30 && barRows() < 4; i++) await r.wheel(60, 10, false, 160);
		await r.pause(400);
		r.mark("s1.hover");
		for (const { l, y } of lines().map((l, y) => ({ l, y })).filter(({ l }) => /█/.test(l)).slice(0, 4)) {
			await r.moveTo(col(l, l.indexOf("█")) + 6, y, 380);
			await r.pause(750);
		}
		r.mark("s1.end");
		r.hideMouse();
	},
	// 2. A calculator: the reply ends, the sliders stay live.
	s2: async () => {
		log("2. mortgage");
		await ask("s2", "Build me a mortgage calculator: sliders for price, down payment, rate and years, and a chart of the remaining balance. Keep the reply short.");
		await untilIdle();
		r.mark("s2.idle");
		await r.pause(1000);
		r.mark("s2.altg");
		await r.key("M-g", 700);
		log(`after alt+g live=${live(r.plain())}`);
		for (let i = 0; i < 4; i++) await r.key("Right", 260);
		await r.key("Down", 300);
		for (let i = 0; i < 3; i++) await r.key("Right", 260);
		await r.pause(400);
		r.mark("s2.drag");
		const sliders = lines().map((l, y) => ({ l, y })).filter(({ l }) => /━*●─/.test(l));
		const target = sliders[2] ?? sliders[sliders.length - 1];
		if (target) {
			const knob = col(target.l, target.l.indexOf("●"));
			await r.drag(knob, target.y, knob + 18, 1000);
			await r.pause(400);
			await r.drag(knob + 18, target.y, knob + 6, 800);
		}
		await r.pause(400);
		r.mark("s2.cross");
		const axis = lines().map((l, y) => ({ l, y })).filter(({ l }) => /┤/.test(l));
		if (axis.length > 1) {
			const row = axis[Math.floor(axis.length / 2)]!;
			const x0 = col(row.l, row.l.indexOf("┤")) + 6;
			for (const dx of [0, 20, 40, 60, 80]) {
				await r.moveTo(x0 + dx, row.y, 280);
				await r.pause(320);
			}
		}
		r.mark("s2.esc");
		r.hideMouse();
		await r.key("Escape", 700);
		r.mark("s2.end");
	},
	// 3. A question that doesn't block: the reply ends, the user answers later by mouse.
	s3: async () => {
		log("3. tokyo");
		await ask("s3", "Plan a 3-day Tokyo trip on $2,000: show the budget split as a chart and the itinerary as a table, and ask me which neighborhoods I care about. I'll answer once I've looked. Keep it short.");
		const blocking = await untilIdleOrLive();
		log(`question ${blocking ? "blocks (wait: true)" : "waits without blocking"}`);
		r.mark("s3.idle");
		await r.pause(1500);
		const anchor = r.find("◆ ") ?? { x: 40, y: 10 };
		const boxRow = () => lines().findIndex((l) => /\[[ x]\] \S/.test(l));
		for (let i = 0; i < 25 && (boxRow() < 0 || boxRow() > 20); i++) await r.wheel(anchor.x + 20, 12, false, 200);
		r.mark("s3.click");
		for (const nth of [0, 1]) {
			const at = r.find("[ ]", nth);
			if (at) await r.click(at.x + 1, at.y, 600);
		}
		await r.pause(500);
		let answered = false;
		if (!r.find("[x]")) {
			log("clicks on the checkboxes did nothing; answering with Alt+G and keys");
			r.hideMouse();
			await r.key("M-g", 800);
			await r.key("Space", 400);
			await r.key("Down", 300);
			await r.key("Space", 500);
			await r.key("Enter", 400);
			answered = true;
		}
		r.mark("s3.submit");
		const submitOnScreen = () => buttons().find((b) => b.label === "Submit") ?? buttons()[0];
		for (let i = 0; i < 10 && !answered && !submitOnScreen(); i++) await r.wheel(anchor.x + 20, 12, true, 220);
		const submit = answered ? undefined : submitOnScreen();
		if (submit) {
			const at = r.find(`[ ${submit.label} ]`);
			if (at) await r.click(at.x + 3, at.y, 500);
			log(`clicked "${submit.label}"`);
		}
		r.hideMouse();
		await r.waitFor(busy, 15_000, "answer turn start");
		r.mark("s3.answering");
		await untilIdle();
		r.mark("s3.answered");
		await r.pause(1500);
		r.mark("s3.end");
	},
	// 4. "Don't continue until I pick": the model blocks, the user answers with the keys.
	s4: async () => {
		log("4. name pick");
		await ask("s4", "Give me 4 names for a CLI that diffs JSON files. Don't continue until I pick one, then write a one-line tagline.");
		if (await untilIdleOrLive()) {
			log("name pick blocks");
			r.mark("s4.live");
			await r.pause(1000);
			await r.key("Right", 600);
			await r.key("Down", 600);
			await r.key("Down", 700);
			r.mark("s4.pick");
			await r.key("Enter", 400);
		} else {
			log("name pick waits; answering by mouse");
			r.mark("s4.live");
			await r.pause(1200);
			const named = buttons().filter((b) => b.label !== "Submit");
			if (named.length > 0) {
				const pick = named[Math.min(1, named.length - 1)]!;
				const at = r.find(`[ ${pick.label} ]`);
				r.mark("s4.pick");
				if (at) await r.click(at.x + 3, at.y, 500);
			} else {
				const option = lines().map((l, y) => ({ l, y })).filter(({ l }) => /○ \S/.test(l))[1];
				if (option) await r.click(col(option.l, option.l.indexOf("○")) + 2, option.y, 500);
				r.mark("s4.pick");
				const at = r.find("[ Submit ]");
				if (at) await r.click(at.x + 3, at.y, 500);
			}
			r.hideMouse();
			await r.waitFor(busy, 15_000, "answer turn start");
		}
		await untilIdle();
		r.mark("s4.idle");
		await r.pause(1500);
		r.mark("s4.end");
	},
	// 5. A few built-in widgets, for the montage.
	m: async () => {
		log("5. montage");
		for (const name of ["dashboard", "architecture", "activity", "explore"]) {
			await command("/new");
			r.mark(`m.${name}`);
			await r.type(`/genui-demo ${name}`, 60);
			await r.key("Enter", 250);
			await r.key("Enter", 1000);
			r.mark(`m.${name}.shown`);
			if (name === "activity") {
				for (const [day, c] of [["Mon", 1], ["Tue", 3], ["Wed", 4]] as const) {
					const at = r.find(`│ ${day} `);
					if (!at) continue;
					await r.moveTo(at.x + 6 + c * 3, at.y, 300);
					await r.pause(500);
				}
				r.hideMouse();
			}
			if (name === "explore") {
				await r.key("Right", 600);
				await r.key("Right", 600);
				await r.key("Escape", 400);
			}
			await r.pause(1200);
			r.mark(`m.${name}.end`);
		}
		r.mark("m.end");
		await r.pause(500);
	},
};

// SCENES=s1,s3 records just those, e.g. to retake one into its own file.
const chosen = process.env.SCENES ? process.env.SCENES.split(",") : Object.keys(scenes);
for (const [i, name] of chosen.entries()) {
	if (!scenes[name]) throw new Error(`no scene "${name}" (have ${Object.keys(scenes).join(", ")})`);
	// Each scene opens on a clean screen; the montage clears before each widget itself.
	if (i > 0 && name !== "m") await command("/new");
	await scenes[name]!();
}
await r.pause(500);

r.save(out);
r.stop();
log(`recorded ${r.frames.length} frames, ${r.marks.length} marks → ${out}`);
