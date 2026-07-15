// Web-local types for the server-side render payload (`/api/render`).
//
// Deliberately NOT part of the shared `Backend` interface: server render is a
// web-only concern (the desktop uses CodeMirror, not server render), so the
// seam stays unpolluted. These mirror the Rust `RenderPayload` serde shape
// (`serde rename_all = "camelCase"`).

/** One frontmatter entry for the read-only Properties view. */
export interface FrontmatterField {
  key: string;
  /** scalar → one value; sequence (e.g. `tags`) → several */
  values: string[];
}

/** One outline heading (document order): level, text, de-duplicated slug. */
export interface OutlineHeading {
  level: number;
  text: string;
  slug: string;
}

/** The rendered read-only view of a Concept. */
export interface RenderPayload {
  /** rendered body HTML (frontmatter excluded; links resolved to viewer nav) */
  html: string;
  frontmatter: FrontmatterField[];
  outline: OutlineHeading[];
}
