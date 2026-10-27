// Turns a recording (record/launch.ts) and the edit (cut.ts) into public/timeline.json: the screens
// the video shows, parsed into styled runs, with the video frame each one starts at.
//
//   bun scripts/build-timeline.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "../../node_modules/@earendil-works/pi-tui/dist/index.js";
import type { Frame, Mark } from "../record/rex.ts";
import { INTRO_SECONDS, OUTRO_SECONDS, SCENES } from "./cut.ts";
import type { Run, Style, Timeline } from "../src/timeline.ts";

const FPS = 30;
/** Pi's own rows at the bottom: working directory and token stats. Not part of the story. */
const FOOTER_ROWS = 2;
/** Rows above the editor; a frame that only changes below them is Pi's spinner. */
const STATUS_ROWS = 6;
/** How long a stretch where only the spinner moved may last before `fit` scales it. */
const IDLE_MS = 120;

interface Recording {
	cols: number;
	rows: number;
	frames: Frame[];
	marks: Mark[];
}

const takes = new Map<string, Recording>();
function take(name = "launch"): Recording {
	let recording = takes.get(name);
	if (!recording) {
		recording = JSON.parse(readFileSync(join(import.meta.dir, "..", "recordings", `${name}.json`), "utf8")) as Recording;
		const first = takes.values().next().value;
		if (first && (first.cols !== recording.cols || first.rows !== recording.rows)) throw new Error(`take "${name}" is ${recording.cols}×${recording.rows}, others ${first.cols}×${first.rows}`);
		takes.set(name, recording);
	}
	return recording;
}
const size = take(SCENES[0]?.take);
const rows = size.rows - FOOTER_ROWS;

// ---------- ANSI → styled runs ----------
const BASIC = ["#1d1f24", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#c8ccd4", "#5c6370", "#ef8189", "#a9d18e", "#f0d197", "#7fc1ff", "#d7a1e6", "#73c8d2", "#ffffff"];

function color256(n: number): string {
	if (n < 16) return BASIC[n]!;
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return `rgb(${v},${v},${v})`;
	}
	const i = n - 16;
	const c = (x: number) => (x === 0 ? 0 : 55 + x * 40);
	return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

function applySgr(params: string, s: Style): Style {
	const p = params === "" ? [0] : params.split(/[;:]/).map((x) => (x === "" ? 0 : Number(x)));
	let st = { ...s };
	for (let i = 0; i < p.length; i++) {
		const c = p[i]!;
		if (c === 0) st = {};
		else if (c === 1) st.bold = true;
		else if (c === 2) st.dim = true;
		else if (c === 3) st.italic = true;
		else if (c === 4) st.underline = true;
		else if (c === 7) st.inverse = true;
		else if (c === 22) (st.bold = undefined), (st.dim = undefined);
		else if (c === 23) st.italic = undefined;
		else if (c === 24) st.underline = undefined;
		else if (c === 27) st.inverse = undefined;
		else if (c >= 30 && c <= 37) st.fg = BASIC[c - 30];
		else if (c >= 90 && c <= 97) st.fg = BASIC[c - 90 + 8];
		else if (c >= 40 && c <= 47) st.bg = BASIC[c - 40];
		else if (c >= 100 && c <= 107) st.bg = BASIC[c - 100 + 8];
		else if (c === 39) st.fg = undefined;
		else if (c === 49) st.bg = undefined;
		else if (c === 38 || c === 48) {
			const mode = p[i + 1];
			let color: string | undefined;
			if (mode === 5) {
				color = color256(p[i + 2]!);
				i += 2;
			} else if (mode === 2) {
				color = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`;
				i += 4;
			}
			if (c === 38) st.fg = color;
			else st.bg = color;
		}
	}
	return st;
}

const styles: Style[] = [];
const styleIds = new Map<string, number>();
function styleId(s: Style): number {
	const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
	const key = JSON.stringify(clean);
	let id = styleIds.get(key);
	if (id === undefined) {
		id = styles.length;
		styles.push(clean);
		styleIds.set(key, id);
	}
	return id;
}

const lines: Run[][] = [];
const lineIds = new Map<string, number>();
function lineId(raw: string): number {
	let id = lineIds.get(raw);
	if (id !== undefined) return id;
	const runs: Run[] = [];
	let style: Style = {};
	for (const m of raw.matchAll(/\x1b\[([0-9;:]*)m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]|([^\x1b]+)/g)) {
		if (m[1] !== undefined) style = applySgr(m[1], style);
		else if (m[2] !== undefined) {
			const sid = styleId(style);
			for (const ch of m[2]) {
				const w = visibleWidth(ch);
				if (w === 0) continue;
				const last = runs[runs.length - 1];
				if (w === 1 && last && last[1] === sid && last[2] === undefined) last[0] += ch;
				else runs.push(w === 1 ? [ch, sid] : [ch, sid, w]);
			}
		}
	}
	// Trailing unstyled spaces draw nothing.
	const last = runs[runs.length - 1];
	if (last && Object.keys(styles[last[1]]!).length === 0) {
		last[0] = last[0].trimEnd();
		if (!last[0]) runs.pop();
	}
	id = lines.length;
	lines.push(runs);
	lineIds.set(raw, id);
	return id;
}

// ---------- retiming ----------
function markAt(recording: Recording, name: string): number {
	const mark = recording.marks.find((m) => m.name === name);
	if (!mark) throw new Error(`no mark "${name}" in the recording (has: ${recording.marks.map((m) => m.name).join(", ")})`);
	return mark.t;
}

const transcript = (f: Frame) => f.screen.split("\n").slice(0, size.rows - STATUS_ROWS).join("\n");

interface Piece {
	frame: Frame;
	ms: number;
}

const out: Timeline["frames"] = [];
const captions: Timeline["captions"] = [];
let clock = 0;

function emit(frame: Frame) {
	const at = Math.round((clock * FPS) / 1000);
	const screen = frame.screen.split("\n").slice(0, rows).map(lineId);
	const entry = { at, lines: screen, mouse: frame.mouse ? ([frame.mouse.x, frame.mouse.y] as [number, number]) : null };
	if (out.length > 0 && out[out.length - 1]!.at === at) out[out.length - 1] = entry;
	else out.push(entry);
}

for (const scene of SCENES) {
	const sceneStart = clock;
	const { frames } = take(scene.take);
	for (const seg of scene.segments) {
		const t0 = markAt(take(scene.take), seg.from);
		const t1 = markAt(take(scene.take), seg.to);
		const segStart = clock;
		if (t1 <= t0) throw new Error(`${seg.from} → ${seg.to} runs backwards`);
		let i = frames.findLastIndex((f) => f.t <= t0);
		if (i < 0) i = 0;
		const pieces: Piece[] = [];
		for (; i < frames.length && frames[i]!.t < t1; i++) {
			const start = Math.max(frames[i]!.t, t0);
			const end = Math.min(frames[i + 1]?.t ?? t1, t1);
			if (end <= start) continue;
			const idle = seg.fit !== undefined && i > 0 && transcript(frames[i]!) === transcript(frames[i - 1]!);
			pieces.push({ frame: frames[i]!, ms: idle ? Math.min(end - start, IDLE_MS) : end - start });
		}
		const total = pieces.reduce((a, p) => a + p.ms, 0);
		const scale = seg.fit !== undefined ? (seg.fit * 1000) / Math.max(1, total) : 1 / (seg.speed ?? 1);
		for (const piece of pieces) {
			emit(piece.frame);
			clock += piece.ms * scale;
		}
		console.log(`    ${seg.from} → ${seg.to}: ${((t1 - t0) / 1000).toFixed(1)}s recorded → ${((clock - segStart) / 1000).toFixed(1)}s`);
	}
	captions.push({ from: Math.round((sceneStart * FPS) / 1000), to: Math.round((clock * FPS) / 1000), title: scene.title, sub: scene.sub });
}

const timeline: Timeline = {
	cols: size.cols,
	rows,
	fps: FPS,
	intro: Math.round(INTRO_SECONDS * FPS),
	outro: Math.round(OUTRO_SECONDS * FPS),
	durationInFrames: Math.round((clock * FPS) / 1000),
	styles,
	lines,
	frames: out,
	captions,
};
const target = join(import.meta.dir, "..", "public", "timeline.json");
writeFileSync(target, JSON.stringify(timeline));
const seconds = (timeline.intro + timeline.durationInFrames + timeline.outro) / FPS;
console.log(`${out.length} screens, ${lines.length} distinct lines, ${styles.length} styles; terminal part ${(clock / 1000).toFixed(1)}s, video ${seconds.toFixed(1)}s → ${target}`);
for (const c of captions) console.log(`  ${(c.from / FPS).toFixed(1)}–${(c.to / FPS).toFixed(1)}s  ${c.title}`);
