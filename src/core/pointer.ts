import { type HitRegion, hitTest, ratioIn } from "./hit.ts";
import { SCROLL_KIND } from "./render.ts";
import type { PointerMode, Runtime } from "./runtime.ts";
import type { Outcome } from "./types.ts";

export interface MouseInput {
	type: "press" | "release" | "move" | "drag" | "click" | "wheel";
	button: string;
	/** Columns and rows relative to the widget's first line. */
	x: number;
	y: number;
	/** Wheel lines; negative scrolls up. */
	wheel?: number;
}

const WHEEL_LINES = 3;
const PAGE_LINES = 10;

export interface MouseOutcome {
	handled: boolean;
	render?: boolean;
	/** Send the rest of the gesture here, so a slider drag isn't also a text selection. */
	capture?: boolean;
	/** A button was clicked in a live widget. */
	outcome?: Outcome;
}

/**
 * Turns mouse events into hover, clicks and slider drags on a runtime. Presses on targets are
 * claimed so the host follows up with drag and click events; presses elsewhere are left alone,
 * which keeps text selection working.
 */
export class PointerController {
	private dragging: HitRegion | undefined;

	constructor(private readonly rt: Runtime) {}

	handle(event: MouseInput, regions: HitRegion[], mode: PointerMode | undefined): MouseOutcome | undefined {
		if (!mode) return undefined;
		const pointer = hitTest(regions, event.x, event.y);
		switch (event.type) {
			case "move": {
				const changed = this.rt.setHover(pointer);
				return pointer || changed ? { handled: true, render: changed } : undefined;
			}
			case "press": {
				if (event.button !== "left" || !pointer) return undefined;
				if (pointer.target.kind === "slider") {
					this.dragging = regions.find((r) => r.target === pointer.target && r.line === event.y);
					this.rt.pointer(pointer, "press", mode);
				}
				return { handled: true, render: true, capture: this.dragging !== undefined };
			}
			case "drag": {
				if (!this.dragging) return undefined;
				this.rt.pointer({ target: this.dragging.target, ratio: ratioIn(this.dragging, event.x) }, "drag", mode);
				return { handled: true, render: true };
			}
			case "release": {
				const wasDragging = this.dragging !== undefined;
				this.dragging = undefined;
				return wasDragging ? { handled: true } : undefined;
			}
			case "wheel": {
				// Only a widget cut to the screen scrolls itself; otherwise the transcript scrolls.
				if (!regions.some((r) => r.target.kind === SCROLL_KIND) || !event.wheel) return undefined;
				this.rt.scrollBy(Math.sign(event.wheel) * WHEEL_LINES);
				return { handled: true, render: true };
			}
			case "click": {
				if (event.button !== "left" || !pointer) return undefined;
				if (pointer.target.kind === SCROLL_KIND) {
					this.rt.scrollBy((pointer.target.index ?? 1) * PAGE_LINES);
					return { handled: true, render: true };
				}
				// A drag that ended on the knob still produces a click; the press already applied it.
				if (pointer.target.kind === "slider") return { handled: true };
				const result = this.rt.pointer(pointer, "click", mode);
				if (typeof result === "object") return { handled: true, render: true, outcome: result };
				return { handled: true, render: true };
			}
			default:
				return undefined;
		}
	}
}
