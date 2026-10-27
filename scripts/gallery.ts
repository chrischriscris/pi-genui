// Print every example widget, e.g. `bun scripts/gallery.ts 90 deploy`.
import { renderWidget } from "../src/core/render.ts";
import { Runtime } from "../src/core/runtime.ts";
import { normalizeSpec } from "../src/core/spec.ts";
import { plainStyle } from "../src/core/style.ts";
import { EXAMPLES } from "../src/examples.ts";

const width = Number(process.argv[2] ?? process.stdout.columns ?? 80);
const names = process.argv.slice(3);
for (const [name, args] of Object.entries(EXAMPLES)) {
	if (names.length > 0 && !names.includes(name)) continue;
	const rt = new Runtime(normalizeSpec(args));
	console.log(`\n${name}${rt.interactive ? " (interactive)" : ""}`);
	console.log(renderWidget(rt, width, plainStyle, { live: rt.interactive, partial: false, title: rt.spec.title }).join("\n"));
}
