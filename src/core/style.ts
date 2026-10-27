import type { Style } from "./types.ts";

/** No colors or attributes: for tests, logs and non-interactive output. */
export const plainStyle: Style = {
	fg: (_tone, text) => text,
	series: (_index, text) => text,
	bold: (text) => text,
	italic: (text) => text,
	inverse: (text) => text,
	border: (text) => text,
	heading: (text) => text,
};
