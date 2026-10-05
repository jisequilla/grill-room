/**
 * The two path tokens stored handoff markdown carries, and how export fills
 * them. Shared by the server (export) and the client (the handoff viewer),
 * which is why it lives outside `server/handoff.ts`: that module imports the
 * database.
 */

/** Stands for the working bundle directory (HANDOFF.md, issues, briefs) in stored markdown; export replaces it. */
export const BUNDLE_TOKEN = "{{BUNDLE}}";

/** Stands for the durable bundle directory (spec.md, intent.md, decisions.md) in stored markdown; export replaces it. */
export const DOCS_TOKEN = "{{DOCS}}";

/**
 * A durable file name, ending where the name ends: at the end of the text, at
 * a character that cannot continue a file name, or at a `.` that ends a
 * sentence (followed by the end of the text or by anything but a letter or
 * digit). So `spec.md.` and `spec.md)` match, while `spec.md.bak`,
 * `spec.mdx` and `specs.md` do not.
 */
const DURABLE_NAME = String.raw`(spec\.md|intent\.md|decisions\.md)(?=$|[^A-Za-z0-9._-]|\.(?:$|[^A-Za-z0-9]))`;

function escaped(token: string): string {
  return token.replace(/[{}]/g, "\\$&");
}

const BUNDLE_DURABLE = new RegExp(`${escaped(BUNDLE_TOKEN)}/${DURABLE_NAME}`, "g");
const DOCS_DURABLE = new RegExp(`${escaped(DOCS_TOKEN)}/${DURABLE_NAME}`, "g");

/**
 * Moves the durable files' paths from {@link BUNDLE_TOKEN} to
 * {@link DOCS_TOKEN}: text stored before the export split names the spec,
 * intent and decisions under the working bundle, where they no longer live.
 * Every other path is left as it is.
 */
export function withDocsToken(markdown: string): string {
  return markdown.replace(BUNDLE_DURABLE, `${DOCS_TOKEN}/$1`);
}

/** The exact inverse of {@link withDocsToken}: how a text rendered before {@link DOCS_TOKEN} existed read. */
export function withBundleToken(markdown: string): string {
  return markdown.replace(DOCS_DURABLE, `${BUNDLE_TOKEN}/$1`);
}

/** Fills both tokens, after moving any old durable path to {@link DOCS_TOKEN}. */
export function fillBundlePath(markdown: string, bundlePath: string, docsPath: string): string {
  return withDocsToken(markdown).split(DOCS_TOKEN).join(docsPath).split(BUNDLE_TOKEN).join(bundlePath);
}
