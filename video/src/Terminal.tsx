// Draws one recorded screen. Cells sit on a fixed grid; box drawing, block elements and braille are
// drawn as shapes so bars join without seams and charts stay sharp at any scale.
import type React from "react";
import { memo } from "react";
import { type Run, type Screen, type Style, type Timeline } from "./timeline.ts";

export const CW = 8.6;
export const CH = 18;
export const FG = "#d6dbe1";
export const BG = "#14161b";

// Segments run slightly past the cell edges so neighbouring cells join without anti-aliasing seams.
const L = "-0.5";
const R = "9.1";
const T = "-0.6";
const B = "18.6";
const BOX: Record<string, string> = {
	"─": `M${L} 9H${R}`,
	"━": `M${L} 9H${R}`,
	"│": `M4.3 ${T}V${B}`,
	"┃": `M4.3 ${T}V${B}`,
	"╭": `M${R} 9H7.3Q4.3 9 4.3 12V${B}`,
	"╮": `M${L} 9H1.3Q4.3 9 4.3 12V${B}`,
	"╰": `M4.3 ${T}V6Q4.3 9 7.3 9H${R}`,
	"╯": `M4.3 ${T}V6Q4.3 9 1.3 9H${L}`,
	"├": `M4.3 ${T}V${B}M4.3 9H${R}`,
	"┤": `M4.3 ${T}V${B}M${L} 9H4.3`,
	"┬": `M${L} 9H${R}M4.3 9V${B}`,
	"┴": `M${L} 9H${R}M4.3 ${T}V9`,
	"┼": `M${L} 9H${R}M4.3 ${T}V${B}`,
	"└": `M4.3 ${T}V9H${R}`,
	"┘": `M4.3 ${T}V9H${L}`,
	"┌": `M${R} 9H4.3V${B}`,
	"┐": `M${L} 9H4.3V${B}`,
};
const HEAVY = new Set(["━", "┃"]);
const LOWER = "▁▂▃▄▅▆▇█";
const LEFT = "▏▎▍▌▋▊▉";
const SHADE: Record<string, number> = { "░": 0.28, "▒": 0.5, "▓": 0.75 };
const BRAILLE_DOTS: Array<[number, number, number]> = [
	[0x01, 0, 0],
	[0x02, 0, 1],
	[0x04, 0, 2],
	[0x40, 0, 3],
	[0x08, 1, 0],
	[0x10, 1, 1],
	[0x20, 1, 2],
	[0x80, 1, 3],
];

const fill: React.CSSProperties = { position: "absolute", display: "block" };
/** Block glyphs reach this far past their cell, so neighbours overlap instead of leaving a hairline. */
const BLEED = -0.75;

/** Foreground and background after inverse. */
function colors(style: Style): { fg: string; bg: string | undefined } {
	return style.inverse ? { fg: style.bg ?? BG, bg: style.fg ?? FG } : { fg: style.fg ?? FG, bg: style.bg };
}

/** A glyph; backgrounds are drawn per run by `Line`, so neighbouring cells don't show seams. */
function Cell({ ch, x, w, style }: { ch: string; x: number; w: number; style: Style }) {
	const { fg } = colors(style);
	const box: React.CSSProperties = { position: "absolute", top: 0, left: x * CW, width: CW * w, height: CH, opacity: style.dim ? 0.55 : undefined };
	if (ch === " ") return null;
	const path = BOX[ch];
	if (path) {
		return (
			<i style={box}>
				<svg viewBox="0 0 8.6 18" preserveAspectRatio="none" style={{ ...fill, inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
					<path d={path} stroke={fg} strokeWidth={HEAVY.has(ch) ? 2.4 : 1.25} fill="none" vectorEffect="non-scaling-stroke" />
				</svg>
			</i>
		);
	}
	const lower = LOWER.indexOf(ch);
	if (lower >= 0) return <i style={box}><b style={{ ...fill, left: BLEED, right: BLEED, bottom: BLEED, height: `calc(${((lower + 1) / 8) * 100}% + ${lower === 7 ? -2 * BLEED : -BLEED}px)`, background: fg }} /></i>;
	const left = LEFT.indexOf(ch);
	if (left >= 0) return <i style={box}><b style={{ ...fill, left: BLEED, top: BLEED, bottom: BLEED, width: `${((left + 1) / 8) * 100}%`, background: fg }} /></i>;
	if (ch === "▀") return <i style={box}><b style={{ ...fill, left: BLEED, right: BLEED, top: BLEED, height: "50%", background: fg }} /></i>;
	// Shades are translucent, so they can't overlap without darker stripes; they snap to whole pixels instead.
	if (SHADE[ch] !== undefined) return <i style={{ ...box, opacity: undefined }}><b style={{ ...fill, inset: 0, background: fg, opacity: SHADE[ch] }} /></i>;
	const code = ch.codePointAt(0)!;
	if (code >= 0x2800 && code <= 0x28ff) {
		const bits = code - 0x2800;
		return (
			<i style={box}>
				<svg viewBox="0 0 8.6 18" style={{ ...fill, inset: 0, width: "100%", height: "100%" }}>
					{BRAILLE_DOTS.filter(([bit]) => bits & bit).map(([bit, cx, cy]) => (
						<circle key={bit} cx={2.4 + cx * 3.8} cy={2.6 + cy * 4.3} r={1.5} fill={fg} />
					))}
				</svg>
			</i>
		);
	}
	return (
		<i style={{ ...box, color: fg, fontWeight: style.bold ? 700 : undefined, fontStyle: style.italic ? "italic" : "normal", textDecoration: style.underline ? "underline" : undefined, textAlign: "center", whiteSpace: "pre" }}>
			{ch}
		</i>
	);
}

const Line = memo(function Line({ runs, styles }: { runs: Run[]; styles: Style[] }) {
	const backgrounds: Array<{ x: number; w: number; color: string }> = [];
	const cells: React.ReactNode[] = [];
	let x = 0;
	runs.forEach(([text, sid, width], r) => {
		const style = styles[sid]!;
		const { bg } = colors(style);
		let i = 0;
		for (const ch of text) {
			const w = width ?? 1;
			const last = backgrounds[backgrounds.length - 1];
			if (bg && last && last.color === bg && last.x + last.w === x) last.w += w;
			else if (bg) backgrounds.push({ x, w, color: bg });
			cells.push(<Cell key={`${r}.${i++}`} ch={ch} x={x} w={w} style={style} />);
			x += w;
		}
	});
	return (
		<>
			{backgrounds.map((b) => (
				<i key={`bg${b.x}`} style={{ position: "absolute", top: BLEED / 2, left: b.x * CW, width: b.w * CW, height: CH - BLEED, background: b.color }} />
			))}
			{cells}
		</>
	);
});

function Pointer({ x, y }: { x: number; y: number }) {
	return (
		<svg width={18} height={24} viewBox="0 0 18 24" style={{ position: "absolute", left: x * CW + CW * 0.45, top: y * CH + CH * 0.4, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))", zIndex: 5 }}>
			<path d="M1 1 L1 19 L5.6 14.6 L8.7 21.6 L11.6 20.3 L8.6 13.5 L14.8 13.5 Z" fill="#fff" stroke="#000" strokeWidth={1.3} strokeLinejoin="round" />
		</svg>
	);
}

/** One screen at the base cell size (8.6×18); scale it with a transform. */
export function Terminal({ timeline, screen }: { timeline: Timeline; screen: Screen }) {
	return (
		<div style={{ position: "relative", width: timeline.cols * CW, height: timeline.rows * CH, font: '14px/18px Menlo, "SF Mono", monospace', color: FG }}>
			{screen.lines.map((id, y) => (
				<div key={y} style={{ position: "absolute", left: 0, top: y * CH, height: CH, width: "100%" }}>
					<Line runs={timeline.lines[id]!} styles={timeline.styles} />
				</div>
			))}
			{screen.mouse ? <Pointer x={screen.mouse[0]} y={screen.mouse[1]} /> : null}
		</div>
	);
}
