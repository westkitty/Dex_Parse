// Small, dependency-free helpers shared by the DexParse app and the
// bin/dexparse-dexdiffusion.mjs CLI for talking to DexDiffusion's Drama
// ("Audio > Script") API.

export const DEXDIFFUSION_DEFAULT_URL = "http://127.0.0.1:31337";
const DEFAULT_NARRATOR = "NARRATOR";

/** Body for POST /api/drama/projects. `title` is optional; DexDiffusion falls back to the first heading. */
export function dexDiffusionRequest(script, options = {}) {
  const body = {
    script: String(script ?? ""),
    mode: "deterministic",
    settings: { narrator_name: String(options.narrator ?? "").trim() || DEFAULT_NARRATOR },
  };
  const title = String(options.title ?? "").trim();
  return title ? { title: title.slice(0, 120), ...body } : body;
}

/**
 * Recover script text from a JSON file: a DexDiffusion drama project
 * (dexdiffusion.drama_project.*, or an API reply wrapping one in `project`),
 * a DexDiffusion request body ({ script }), or a DexParse export.
 */
export function scriptFromJson(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (typeof json.schema === "string" && json.schema.startsWith("dexdiffusion.drama_project.") && typeof json.source_script === "string")
    return { text: json.source_script, from: "DexDiffusion drama project", title: typeof json.title === "string" ? json.title : undefined };
  if (json.project && typeof json.project === "object") {
    const inner = scriptFromJson(json.project);
    if (inner) return inner;
  }
  if (json.schema === "dexparse.document/v1" && json.source && typeof json.source.text === "string")
    return { text: json.source.text, from: "DexParse export" };
  if (typeof json.script === "string")
    return {
      text: json.script,
      from: "DexDiffusion script request",
      title: typeof json.title === "string" ? json.title : undefined,
      narrator: json.settings && typeof json.settings.narrator_name === "string" ? json.settings.narrator_name : undefined,
    };
  return null;
}

/**
 * DexDiffusion runs on this computer (127.0.0.1:31337) or on the user's
 * tailnet (*.ts.net over HTTPS). Anything else is refused unless explicitly allowed.
 */
export function assertDexDiffusionUrl(raw, { allowAnyHost = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error(`Not a valid DexDiffusion URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("DexDiffusion URL must use http or https.");
  if (url.username || url.password) throw new Error("DexDiffusion URL must not contain credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const tailnet = host.endsWith(".ts.net") && url.protocol === "https:";
  if (!loopback && !tailnet && !allowAnyHost)
    throw new Error(`Refusing to send a script to ${host}. Use 127.0.0.1, localhost, or an https *.ts.net tailnet host.`);
  return url.origin;
}

/** Headers DexDiffusion's request guard accepts for state-changing calls. */
export function dexDiffusionHeaders(origin) {
  return { "content-type": "application/json", accept: "application/json", origin, "x-dex-request": "1" };
}
