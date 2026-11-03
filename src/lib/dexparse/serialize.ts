import { buildPlayback } from "./playback.ts";
import { detectNewline, sha256Hex } from "./source.ts";
import type { DexDocument, ParseOutput, SourceRevision } from "./types.ts";
import { SCHEMA_ID, SCHEMA_VERSION } from "./types.ts";

export async function sourceRevision(revision: number, text: string): Promise<SourceRevision> {
  return {
    revision,
    text,
    sha256: await sha256Hex(text),
    charCount: text.length,
    newline: detectNewline(text),
    encoding: "utf-8",
  };
}

export async function toDocument(
  revision: number,
  text: string,
  parsed: ParseOutput,
): Promise<DexDocument> {
  const anyAccepted = parsed.segments.some(
    (s) => s.origin === "ollama-accepted" || s.children?.some((c) => c.origin === "ollama-accepted"),
  );
  return {
    schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    generator: anyAccepted ? "dexparse-deterministic+ollama-accepted" : "dexparse-deterministic",
    source: await sourceRevision(revision, text),
    segments: parsed.segments,
    diagnostics: parsed.diagnostics,
    validation: parsed.validation,
    playback: buildPlayback(text, parsed.segments),
  };
}

export function documentJson(doc: DexDocument): string {
  return JSON.stringify(doc, null, 2);
}
