# pi-genui

![The model answering with a chart, hovered](https://raw.githubusercontent.com/chrischriscris/pi-genui/main/media/1-cities-hover.png)

A one-minute demo is in `media/pi-genui-launch.mp4` (cut with Remotion from a real session; see `video/`), and the uncut session in `media/pi-genui-demo.mp4`.

Generative UI for [Pi](https://pi.dev): the model can draw charts, tables, diagrams, forms and calculators right inside the terminal chat, the way ChatGPT and Claude show inline widgets, but with terminal-native components instead of HTML.

It adds one tool, `render_ui`. The model can call it anywhere in an answer and keep writing after it. The widget draws in place while the arguments stream in. Widgets with inputs don't block the model: it finishes its reply, you answer whenever you like (mouse, or Alt+G for the keyboard), and the answer reaches the model as a new message. When the model can't continue without an answer, it passes `wait: true` and the widget takes the keyboard right away.

## Try it

```bash
pi install npm:pi-genui      # keep it installed
pi -e npm:pi-genui           # or try it for one session
```

Mouse support needs Pi's fullscreen mode (`"tuiMode": "fullscreen"` in settings); everything else works in the default mode too.

`/genui-demo <name>` shows the bundled examples without calling the model: `dashboard`, `interest` (sliders that recompute a chart), `deploy` (a form with buttons), `pick` (table row picker), `architecture`, `activity` and `explore` (tabs).

Then ask Pi things whose answer has a shape ("compare the 6 largest US cities by population") or that need a decision from you ("ask me what stack I want before scaffolding").

## Spec

```json
{
  "title": "Loan",
  "state": { "rate": 6, "years": 30 },
  "calc": { "pay": "pmt(rate / 1200, years * 12, 400000)" },
  "view": [
    { "slider": "rate", "max": 12, "step": 0.25, "unit": "%" },
    { "slider": "years", "min": 5, "max": 40 },
    { "stat": "Monthly payment", "value": "=pay", "format": "currency" },
    { "line": "=range(years + 1).map(y => round(400000 * (1 - y / years)))", "height": 6 }
  ]
}
```

- A node leads with its component, which holds its main argument: `{"bar": {...}}` is a bar chart of that data, `{"slider": "rate"}` binds `state.rate`, `{"row": [...]}` lays out children. The long form `{"type": "bar", "data": {...}}` is accepted too.
- A string starting with `=` is a JavaScript expression over state, `calc` and a few helpers (`range sum avg round clamp pmt fmt`, plus `Math`). Text can embed `{{expr}}`. `calc` names expressions, evaluated in order.
- Everything evaluates in one `node:vm` script per change, with a 150 ms timeout. That stops runaway loops but isn't a security boundary; the model can already run shell commands.
- A widget asks when it has inputs or buttons and isn't a calculator. Calculators (inputs that only feed `=` values) never report back. A question without buttons gets a Submit button, so it can be answered by mouse alone.
- Calling `render_ui` again with the same title in the same reply replaces that widget; the earlier one shrinks to a line. Answered widgets are never replaced, and later replies always add a new widget, so before-and-after stays visible.

Components: `col row box tabs divider`, `text md note kv stat`, `table tree flow`, `bar line progress heatmap`, and the inputs `select multi input slider toggle buttons`. `bar` takes `vertical`, `line` takes `spark`, `text` takes `style: heading`. A table with `bind` is a row picker. Common aliases (`card`, `kpi`, `columns`, `checkbox`, ...) are accepted.

## Context

The tool description is generated from each component's one-line `doc`, about 570 tokens. Validation errors carry the usage line of the component that went wrong, so the model learns details only when it needs them.

Old widget specs shrink in what the model re-reads: before each request, `render_ui` calls from earlier turns keep their first 3 items of every list and the first 160 characters of long text, and their result gains a one-line summary of the whole widget ("bar(6), table(40 rows), stat×3"). The trimmed call is still a real spec with no placeholder in it, because models copy their earlier calls: replacing old specs with a `{"elided": …}` stub made the model send that stub as the arguments of new widgets. The newest widget stays verbatim so it can still be edited. A message is rewritten once, at the turn boundary, so prompt caching stays effective. Results report scalar computed values only, never chart series.

## Keyboard and mouse

Keys while a widget has the keyboard: Tab/Shift+Tab or ↑↓ between controls, ←→ to adjust, Space to toggle, 1-9 to pick, Enter for the next control (or submit on the last). Esc returns to the chat; for a `wait` widget, it closes it. Alt+G picks up the latest widget still waiting, scrolling it back into view in fullscreen mode if later output pushed it away; clicking a text field picks it up too.

In Pi's fullscreen mode (`"tuiMode": "fullscreen"`), widgets take clicks, drags, wheel and hover:

- Click options, checkboxes, toggles, table rows, tabs and buttons; click or drag a slider. Clicking a button or the submit of a waiting widget answers it.
- A widget taller than the screen scrolls with the wheel while it has the keyboard, and its "↑/↓ N more" lines page it. Clicking never shifts the content under the pointer.
- Hover highlights the item under the pointer and puts a tooltip on the bottom border: bar values with their share of the total, heatmap cells, full table rows, and a crosshair on line charts with every series' value at that point.
- Answered widgets freeze, so the transcript shows what was answered; calculators stay playable.

## Extending

Other Pi extensions add components through the event bus:

```ts
pi.events.emit("genui:component", { name: "gantt", def: { doc: "[{label,start,end}]", main: "tasks", render: (node, width, ctx, path) => [...] } });
```

A component is `render(node, width, ctx, path) → lines`, plus optional key and pointer handlers, a tooltip, and a `doc` line that goes straight into the tool description. In-process code can call `registerComponent` from the package directly.

## Layout

- `src/core/`: the renderer, independent of Pi apart from pi-tui's width helpers: spec, registry, runtime (state, focus, keys), expression evaluation, render, pointer hit-testing and validation.
- `src/components/`: the components.
- `src/pi/`: the Pi adapter: the tool and its renderers, answers and focus, context compression, theme and key mapping, `/genui-demo`.

Since the core only produces lines for a width and consumes key and pointer events, it can also back a side pane for agents that can't draw inline (Claude Code, Codex).

## Limits

- Inputs need Pi's interactive mode. In print, JSON or RPC mode, display widgets still return, and inputs tell the model to ask in text.
- Mouse needs fullscreen mode. Under tmux, zellij or screen, Pi only reports motion while a button is held, so hover needs a direct terminal (clicks and drags still work).

## Development

```bash
bun install
pi -e ./src/index.ts           # run Pi with your checkout
bun scripts/gallery.ts 100     # print every example in plain text
```

`bun test` runs the suite: every example at several widths, in color and plain text, partially streamed JSON, key and pointer interactions, expressions and context compression. `bun run typecheck` runs tsc.
