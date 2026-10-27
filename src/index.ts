// Pi loads the default export. The rest is the renderer core, for embedding it elsewhere
// (a side pane for agents that can't draw inline) or adding components in-process.
export { default } from "./pi/extension.ts";
export { componentNames, registerComponent, toNode } from "./core/registry.ts";
export { layoutWidget, renderWidget } from "./core/render.ts";
export { Runtime } from "./core/runtime.ts";
export { normalizeSpec } from "./core/spec.ts";
export type { ComponentDef, Outcome, RenderCtx, Style, UiNode, UiSpec } from "./core/types.ts";
export { validate } from "./core/validate.ts";
