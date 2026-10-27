# Launch video

The demo video is a real Pi session, recorded and then edited in [Remotion](https://remotion.dev). Nothing in it is mocked: the terminal is drawn from the recorded screens.

```bash
bun install
bun run record     # drive Pi against the real model (~5 min) → recordings/launch.json
bun run timeline   # cut and retime it (scripts/cut.ts) → public/timeline.json
bun run studio     # preview
bun run render     # → out/pi-genui-launch.mp4
```

- `record/launch.ts` runs Pi in a Rex session of its own (`record/rex.ts`), types the prompts, and drives the widgets with keys and mouse. It marks each beat (`s2.altg`, `s3.click`, …). The stage folder's `.pi/settings.json` hides thinking; `--approve` trusts it for that run only.
- `scripts/cut.ts` is the edit: which marked stretches play, at what speed or in how many seconds, and the captions. Model waits shrink first where only Pi's spinner moved.
- `src/` is the composition: intro card, the terminal window with captions, outro card. Pass `--props='{"cta":"pi install …"}'` to put an install line on the outro.

The model doesn't answer the same way twice: it sometimes blocks with `wait`, sometimes not, and now and then gets a spec wrong and retries. The recording script handles both answer paths; check the take before cutting it.
