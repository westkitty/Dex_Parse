/**
 * Generated coverage fixture. This is not a user script.
 * The string length is exactly 6,667 UTF-16 code units.
 */
const HEADER = [
  "TITLE: Generated coverage fixture",
  "",
  "This is a generated DexParse test fixture, not a user script.",
  "",
  "INT. COUNTING ROOM — NIGHT",
  "",
  "A lamp hums over an empty bench.",
  "",
  "MAYA: Mark the span [pause 1s] and keep going.",
  "JON (quietly): The count has to close.",
  "MAYA: [softly] Listen [SFX: clock tick] then wait.",
  "",
  "[MUSIC: single piano note]",
  "[AMBIENCE: faint hiss]",
  "[SFX: page turn]",
  "",
].join("\n");

const UNIT = "Narration fills the remaining classified characters.\n";

export function buildCoverageFixture(): string {
  const target = 6667;
  if (HEADER.length >= target) {
    throw new Error(`Fixture header is ${HEADER.length}, which is already past ${target}.`);
  }
  let body = "";
  const remain = target - HEADER.length;
  while (body.length + UNIT.length <= remain) body += UNIT;
  const left = remain - body.length;
  if (left > 0) body += "x".repeat(left);
  const full = HEADER + body;
  if (full.length !== target) {
    throw new Error(`Fixture length ${full.length} !== ${target}`);
  }
  return full;
}
