import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

export interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	inverse?: boolean;
}

/** Text in one style; `width` is set for a single wide character. */
export type Run = [text: string, style: number, width?: number];

export interface Screen {
	/** Video frame (after the intro) this screen appears at. */
	at: number;
	/** Indices into `lines`, one per row. */
	lines: number[];
	mouse: [x: number, y: number] | null;
}

export interface Timeline {
	cols: number;
	rows: number;
	fps: number;
	intro: number;
	outro: number;
	/** Length of the terminal part, in frames. */
	durationInFrames: number;
	styles: Style[];
	lines: Run[][];
	frames: Screen[];
	captions: Array<{ from: number; to: number; title: string; sub: string }>;
}

export const TIMELINE_FILE = "timeline.json";

export async function loadTimeline(): Promise<Timeline> {
	const response = await fetch(staticFile(TIMELINE_FILE));
	if (!response.ok) throw new Error(`${TIMELINE_FILE} is missing: run bun run timeline`);
	return (await response.json()) as Timeline;
}

/** The timeline, holding the render until it has loaded. */
export function useTimeline(): Timeline | undefined {
	const [timeline, setTimeline] = useState<Timeline>();
	const [handle] = useState(() => delayRender("Loading the timeline"));
	useEffect(() => {
		loadTimeline()
			.then((t) => {
				setTimeline(t);
				continueRender(handle);
			})
			.catch((error) => cancelRender(error));
	}, [handle]);
	return timeline;
}

/** The screen showing at `frame`. */
export function screenAt(timeline: Timeline, frame: number): Screen {
	const { frames } = timeline;
	let lo = 0;
	let hi = frames.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (frames[mid]!.at <= frame) lo = mid;
		else hi = mid - 1;
	}
	return frames[lo]!;
}
