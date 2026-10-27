// Drive a program in a Rex session of its own and record every distinct screen with its timestamp.
// Same interface as the tmux recorder. Input goes through the block's write method, so mouse
// reports reach the program as sent. The session is separate so no window shows the tab: a window
// that shows it takes it over, resizes it to its own size and swallows the injected clicks.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export interface Frame {
	t: number;
	screen: string;
	mouse: { x: number; y: number } | null;
	speed: number;
	shot?: string;
}

/** A named moment in the recording, for cutting the video. */
export interface Mark {
	name: string;
	t: number;
}

// tmux key names to Rex's. Rex encodes them for whatever keyboard protocol the program turned on.
const KEYS: Record<string, string> = { Enter: "enter", Escape: "escape", Tab: "tab", BTab: "shift+tab", Up: "up", Down: "down", Right: "right", Left: "left", Home: "home", End: "end", BSpace: "backspace", Space: "space" };

function rexKey(name: string): string {
	return KEYS[name] ?? name.replace(/^M-/, "alt+").replace(/^C-/, "ctrl+").replace(/^S-/, "shift+");
}

export class Recorder {
	frames: Frame[] = [];
	marks: Mark[] = [];
	private start = Date.now();
	private mouse: { x: number; y: number } | null = null;
	private speed = 1;
	private pendingShot: string | undefined;
	private block = "";
	private session = "";

	constructor(
		readonly cols: number,
		readonly rows: number,
		readonly title = "genui demo",
	) {}

	private rex(...args: string[]): string {
		const r = spawnSync("rex", args, { encoding: "utf8" });
		if (r.status !== 0) throw new Error(`rex ${args.slice(0, 4).join(" ")}: ${r.stderr}`);
		return r.stdout;
	}

	private call(method: string, args: Record<string, unknown>): Record<string, unknown> {
		const out = this.rex("block", "call", "-s", this.session, "-b", this.block, method, JSON.stringify(args)).trim();
		return out ? JSON.parse(out) : {};
	}

	/** The screen as exactly `rows` lines. */
	private capture(format: "text" | "vt"): string {
		const content = String(this.call("format", { format }).content ?? "").replace(/\r/g, "");
		const lines = content.split("\n");
		if (lines[lines.length - 1] === "") lines.pop();
		const screen = lines.slice(-this.rows);
		while (screen.length < this.rows) screen.push("");
		return screen.join("\n");
	}

	/** `_config` is the tmux config, unused here: scripts written for the tmux recorder run unchanged. */
	launch(_config: string, cwd: string, env: Record<string, string>, command: string[]) {
		const vars = Object.entries(env).map(([k, v]) => `${k}=${v}`);
		this.stop();
		// The first window of a new session belongs to the client that made it, which is gone once
		// the command returns, so it can't be resized. A second window has no owner.
		this.session = JSON.parse(this.rex("session", "new", "genui-rec", "-c", cwd, "--json", "--", "sleep", "86400")).session_id;
		const out = JSON.parse(this.rex("window", "new", "-s", this.session, this.title, "-c", cwd, "--focus=false", "--keep-open", "--json", "--", "env", ...vars, ...command));
		this.block = out.block_ids[0];
		this.call("resize", { columns: this.cols, rows: this.rows });
	}

	stop() {
		if (this.session) spawnSync("rex", ["session", "kill", this.session]);
		this.session = "";
	}

	plain(): string {
		return this.capture("text");
	}

	sample() {
		const screen = this.capture("vt");
		const last = this.frames[this.frames.length - 1];
		const mouseSame = JSON.stringify(last?.mouse) === JSON.stringify(this.mouse);
		if (last && last.screen === screen && mouseSame && last.speed === this.speed && !this.pendingShot) return;
		this.frames.push({ t: Date.now() - this.start, screen, mouse: this.mouse, speed: this.speed, shot: this.pendingShot });
		this.pendingShot = undefined;
	}

	async pause(ms: number) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			this.sample();
			await Bun.sleep(60);
		}
		this.sample();
	}

	async waitFor(test: (plain: string) => boolean, timeout = 120_000, label = "condition"): Promise<boolean> {
		const end = Date.now() + timeout;
		while (Date.now() < end) {
			this.sample();
			if (test(this.plain())) return true;
			await Bun.sleep(120);
		}
		console.error(`timed out waiting for ${label}`);
		return false;
	}

	setSpeed(speed: number) {
		this.speed = speed;
	}

	/** Name this moment, so the edit can cut and caption by name instead of by timestamp. */
	mark(name: string) {
		this.sample();
		this.marks.push({ name, t: Date.now() - this.start });
	}

	/** Mark the current frame as a named screenshot. */
	shot(name: string) {
		const last = this.frames[this.frames.length - 1]!;
		this.frames.push({ ...last, t: Date.now() - this.start, shot: name });
	}

	private write(data: string) {
		this.call("write", { data });
	}

	async type(text: string, cps = 28) {
		for (const ch of text) {
			this.write(ch);
			await this.pause(1000 / cps);
		}
	}

	async key(name: string, after = 250) {
		this.rex("send-key", "-s", this.session, "-b", this.block, rexKey(name));
		await this.pause(after);
	}

	/** Find text on screen; returns its 0-based cell position. */
	find(text: string, nth = 0): { x: number; y: number } | undefined {
		const lines = this.plain().split("\n");
		let seen = 0;
		for (let y = 0; y < lines.length; y++) {
			let from = 0;
			for (;;) {
				const i = lines[y]!.indexOf(text, from);
				if (i < 0) break;
				if (seen++ === nth) return { x: [...lines[y]!.slice(0, i)].length, y };
				from = i + 1;
			}
		}
		return undefined;
	}

	/** Glide the pointer to (x, y), sending move events along the way. */
	async moveTo(x: number, y: number, ms = 350, button: "none" | "left" = "none") {
		const from = this.mouse ?? { x: Math.max(0, x - 12), y: Math.min(this.rows - 1, y + 4) };
		const steps = Math.max(1, Math.round(ms / 45));
		for (let i = 1; i <= steps; i++) {
			const p = { x: Math.round(from.x + ((x - from.x) * i) / steps), y: Math.round(from.y + ((y - from.y) * i) / steps) };
			this.mouse = p;
			this.write(`\x1b[<${button === "left" ? 32 : 35};${p.x + 1};${p.y + 1}M`);
			await this.pause(ms / steps);
		}
	}

	async click(x: number, y: number, after = 300) {
		await this.moveTo(x, y);
		this.write(`\x1b[<0;${x + 1};${y + 1}M`);
		await this.pause(70);
		this.write(`\x1b[<0;${x + 1};${y + 1}m`);
		await this.pause(after);
	}

	async drag(x0: number, y: number, x1: number, ms = 900) {
		await this.moveTo(x0, y);
		this.write(`\x1b[<0;${x0 + 1};${y + 1}M`);
		await this.pause(80);
		await this.moveTo(x1, y, ms, "left");
		this.write(`\x1b[<0;${x1 + 1};${y + 1}m`);
		await this.pause(200);
	}

	async wheel(x: number, y: number, down: boolean, after = 220) {
		await this.moveTo(x, y, 200);
		this.write(`\x1b[<${down ? 65 : 64};${x + 1};${y + 1}M`);
		await this.pause(after);
	}

	hideMouse() {
		this.mouse = null;
		this.sample();
	}

	save(path: string) {
		writeFileSync(path, JSON.stringify({ cols: this.cols, rows: this.rows, frames: this.frames, marks: this.marks }));
	}
}
