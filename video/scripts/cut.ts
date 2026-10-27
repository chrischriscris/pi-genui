// The edit: which stretches of the recording make the video, how fast, and what the captions say.
// Stretches are named by the marks record/launch.ts sets.

export interface Segment {
	from: string;
	to: string;
	/** Playback speed; ignored when `fit` is set. */
	speed?: number;
	/** Seconds this stretch should take, however long it ran. Moments where only Pi's spinner moved shrink first. */
	fit?: number;
}

export interface Scene {
	/** Which recording in recordings/ it comes from (default "launch"), so one scene can be retaken alone. */
	take?: string;
	title: string;
	sub: string;
	segments: Segment[];
}

export const INTRO_SECONDS = 3.2;
export const OUTRO_SECONDS = 4.5;

export const SCENES: Scene[] = [
	{
		take: "extra",
		title: "Ask for anything with a shape",
		sub: "It answers with a chart, right in the reply, and keeps writing after it.",
		segments: [
			{ from: "s1.type", to: "s1.sent", fit: 1.3 },
			{ from: "s1.sent", to: "s1.idle", fit: 4.5 },
			{ from: "s1.idle", to: "s1.hover", fit: 0.5 },
			{ from: "s1.hover", to: "s1.end", fit: 3 },
		],
	},
	{
		title: "Calculators stay live",
		sub: "Drag a slider, hover the chart, or press Alt+G to use the keys.",
		segments: [
			{ from: "s2.type", to: "s2.sent", fit: 1.2 },
			{ from: "s2.sent", to: "s2.idle", fit: 3.5 },
			{ from: "s2.idle", to: "s2.altg", fit: 0.4 },
			{ from: "s2.altg", to: "s2.drag", fit: 2.2 },
			{ from: "s2.drag", to: "s2.cross", fit: 3.2 },
			{ from: "s2.cross", to: "s2.end", fit: 2.4 },
		],
	},
	{
		title: "Questions don't block",
		sub: "The model finishes its reply. Answer when you're ready; it comes back as a message.",
		segments: [
			{ from: "s3.type", to: "s3.sent", fit: 1.4 },
			{ from: "s3.sent", to: "s3.idle", fit: 4 },
			{ from: "s3.idle", to: "s3.click", fit: 0.8 },
			{ from: "s3.click", to: "s3.answering", fit: 3.5 },
			{ from: "s3.answering", to: "s3.answered", fit: 3.2 },
			{ from: "s3.answered", to: "s3.end", fit: 1.2 },
		],
	},
	{
		title: "Or it waits, when it has to",
		sub: "With wait: true the widget takes the keyboard until you pick.",
		segments: [
			{ from: "s4.type", to: "s4.sent", fit: 1.1 },
			{ from: "s4.sent", to: "s4.live", fit: 2.6 },
			{ from: "s4.live", to: "s4.pick", fit: 2 },
			{ from: "s4.pick", to: "s4.idle", fit: 1.8 },
			{ from: "s4.idle", to: "s4.end", fit: 1 },
		],
	},
	{
		take: "m",
		title: "23 components, and room for yours",
		sub: "Charts, tables, trees, flows, heatmaps, forms. Other extensions can add more.",
		segments: [
			{ from: "m.dashboard.shown", to: "m.dashboard.end", fit: 1.6 },
			{ from: "m.architecture.shown", to: "m.architecture.end", fit: 1.5 },
			{ from: "m.activity.shown", to: "m.activity.end", fit: 2 },
			{ from: "m.explore.shown", to: "m.explore.end", fit: 2 },
		],
	},
];
