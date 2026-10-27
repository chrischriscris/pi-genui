import type React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BG, CH, CW, Terminal } from "./Terminal.tsx";
import { screenAt, type Timeline, useTimeline } from "./timeline.ts";

// A type, not an interface: Remotion wants props it can index.
export type LaunchProps = {
	/** A line under the outro, e.g. how to install. Empty hides it. */
	cta: string;
};

const ACCENT = "#a79ad7";
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
const MONO = 'Menlo, "SF Mono", monospace';
const FADE = 10;

// The window, in the terminal's base units (one cell is 8.6×18), scaled up to fill the frame.
const PAD_X = 16;
const PAD_Y = 14;
const BAR = 34;
const SCALE = 1.41;
const TOP = 132;

const background: React.CSSProperties = { background: "radial-gradient(120% 120% at 20% 0%, #2b3350 0%, #151826 55%, #0d0f16 100%)" };

function fadeInOut(frame: number, duration: number): number {
	return interpolate(frame, [0, FADE, duration - FADE, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function Wordmark({ size }: { size: number }) {
	return (
		<div style={{ font: `700 ${size}px ${MONO}`, color: "#f2f3f7", letterSpacing: -size * 0.02 }}>
			<span style={{ color: ACCENT }}>◆</span> pi-genui
		</div>
	);
}

function Card({ duration, lines }: { duration: number; lines: Array<{ text: string; size: number; color: string; weight?: number; mono?: boolean }> }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26, opacity: fadeInOut(frame, duration) }}>
			{[null, ...lines].map((line, i) => {
				const rise = spring({ frame: frame - 4 - i * 6, fps, config: { damping: 200 } });
				const style: React.CSSProperties = { opacity: rise, transform: `translateY(${(1 - rise) * 24}px)` };
				if (!line) return <div key="mark" style={style}><Wordmark size={112} /></div>;
				return (
					<div key={line.text} style={{ ...style, font: `${line.weight ?? 500} ${line.size}px ${line.mono ? MONO : SANS}`, color: line.color, textAlign: "center" }}>
						{line.text}
					</div>
				);
			})}
		</AbsoluteFill>
	);
}

function Caption({ timeline, frame }: { timeline: Timeline; frame: number }) {
	const { fps } = useVideoConfig();
	const index = timeline.captions.findIndex((c) => frame >= c.from && frame < c.to);
	const caption = timeline.captions[index];
	if (!caption) return null;
	const local = frame - caption.from;
	const enter = spring({ frame: local, fps, config: { damping: 200 } });
	const leave = interpolate(frame, [caption.to - 8, caption.to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<div style={{ position: "absolute", top: 30, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: enter * leave, transform: `translateY(${(1 - enter) * -14}px)` }}>
			<div style={{ display: "flex", alignItems: "center", gap: 22 }}>
				<div style={{ font: `700 22px ${MONO}`, color: "#0d0f16", background: ACCENT, borderRadius: 999, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>{index + 1}</div>
				<div>
					<div style={{ font: `650 38px ${SANS}`, color: "#f2f3f7", letterSpacing: -0.4 }}>{caption.title}</div>
					<div style={{ font: `400 23px ${SANS}`, color: "#a3a9b8", marginTop: 4 }}>{caption.sub}</div>
				</div>
			</div>
		</div>
	);
}

function TerminalPart({ timeline }: { timeline: Timeline }) {
	const frame = useCurrentFrame();
	const screen = screenAt(timeline, frame);
	const width = timeline.cols * CW + PAD_X * 2;
	const height = timeline.rows * CH + PAD_Y * 2 + BAR;
	// A slow push in over each scene, so held shots don't feel frozen.
	const caption = timeline.captions.find((c) => frame >= c.from && frame < c.to);
	const push = caption ? interpolate(frame, [caption.from, caption.to], [1, 1.025], { easing: Easing.inOut(Easing.quad) }) : 1;
	return (
		<AbsoluteFill style={{ opacity: fadeInOut(frame, timeline.durationInFrames) }}>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: TOP,
					width,
					height,
					transform: `translateX(-50%) scale(${SCALE * push})`,
					transformOrigin: "50% 0",
					background: BG,
					borderRadius: 12,
					boxShadow: "0 22px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07)",
					overflow: "hidden",
				}}
			>
				<div style={{ height: BAR, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
					{["#ff5f57", "#febc2e", "#28c840"].map((c) => (
						<span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
					))}
					<span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", color: "#8b93a1", font: `500 12.5px ${SANS}` }}>pi</span>
				</div>
				<div style={{ position: "absolute", left: PAD_X, top: BAR + PAD_Y }}>
					<Terminal timeline={timeline} screen={screen} />
				</div>
			</div>
			<Caption timeline={timeline} frame={frame} />
		</AbsoluteFill>
	);
}

export function Launch({ cta }: LaunchProps) {
	const timeline = useTimeline();
	if (!timeline) return null;
	const { intro, outro, durationInFrames } = timeline;
	return (
		<AbsoluteFill style={background}>
			<Sequence durationInFrames={intro}>
				<Card
					duration={intro}
					lines={[
						{ text: "Generative UI for terminal agents", size: 54, color: "#f2f3f7", weight: 600 },
						{ text: "Charts, forms and calculators, inline in Pi", size: 30, color: "#a3a9b8" },
					]}
				/>
			</Sequence>
			<Sequence from={intro} durationInFrames={durationInFrames}>
				<TerminalPart timeline={timeline} />
			</Sequence>
			<Sequence from={intro + durationInFrames} durationInFrames={outro}>
				<Card
					duration={outro}
					lines={[
						{ text: "Generative UI, right in the terminal", size: 54, color: "#f2f3f7", weight: 600 },
						{ text: "An extension for Pi. The renderer core works with any agent.", size: 30, color: "#a3a9b8" },
						...(cta ? [{ text: cta, size: 30, color: ACCENT, mono: true }] : []),
					]}
				/>
			</Sequence>
		</AbsoluteFill>
	);
}
