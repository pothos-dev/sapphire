// Render-payload types for the server-side render (`/api/render`) and — since
// the desktop print/PDF path now needs the same server-quality HTML — the
// `Backend.renderConcept` seam.
//
// The shapes originally lived here (web-only), but now cross the IPC seam, so
// they live in the shared `$lib/types` module (mirroring the Rust
// `RenderPayload` serde shape, `serde rename_all = "camelCase"`). Re-exported
// here so existing web imports (`./render`) keep working unchanged.

export type { RenderPayload, FrontmatterField, OutlineHeading } from '$lib/types';
