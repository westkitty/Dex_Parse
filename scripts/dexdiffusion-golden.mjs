#!/usr/bin/env node
/**
 * Regenerate src/lib/dexparse/dexdiffusion/fixtures/golden.json from the REAL
 * DexDiffusion Drama parser (westkitty/Image_Gen operator-console/drama.js).
 *
 *   node scripts/dexdiffusion-golden.mjs ../Image_Gen
 *
 * The golden file records, for each fixture script, exactly what DexDiffusion
 * returns from parseScript and verifySourceCoverage and the source hash and
 * coverage stamp it writes into a new drama project. The DexParse test suite
 * checks its port against this file, so it runs without Image_Gen present.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const imageGen = resolve(process.argv[2] ?? process.env.DEXDIFFUSION_ROOT ?? join(root, "..", "Image_Gen"));
const dramaPath = join(imageGen, "operator-console", "drama.js");
const D = createRequire(import.meta.url)(dramaPath);
let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", imageGen, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout */
}

const fx = (name) => readFileSync(join(root, "src/lib/dexparse/dexdiffusion/fixtures", name), "utf8");
const { SAMPLE_SCRIPT } = await import(join(root, "src/lib/dexparse/sample.ts"));
const { buildCoverageFixture } = await import(join(root, "src/lib/dexparse/fixture.ts"));

const cases = [
  ["dexparse-sample", SAMPLE_SCRIPT, {}],
  ["dexparse-coverage-6667", buildCoverageFixture(), {}],
  ["studio-drama", fx("studio-drama.txt"), {}],
  ["studio-drama-custom-narrator", fx("studio-drama.txt"), { narrator: "Storyteller" }],
  ["crlf", fx("crlf.txt"), {}],
  ["lone-cr", "MAYA: one\r[beat]\rJON: two\r", {}],
  ["divergent", fx("divergent.txt"), {}],
  ["empty", "", {}],
  ["whitespace-only", "  \n\t\n", {}],
  ["narration-only", "The sea was calm.\nNobody spoke.\n\nMorning came.", {}],
  ["unicode", "ナオキ: こんにちは。\nJosé: ¿Dónde está?\nZOË: Ça va. 🎧\n[SFX: café noise — duck]", {}],
  ["title-case-cast", "Anna: Hello.\nBen: Hi.\nAnna: Ready?\nBen: Always.", {}],
  ["stop-names", "NOTE: not a speaker\nCAST: nobody\nSCENE 3\nAUTHOR: me", {}],
];

const out = {
  reference: { repo: "westkitty/Image_Gen", file: "operator-console/drama.js", commit, schema: D.SCHEMA },
  generated_by: "scripts/dexdiffusion-golden.mjs",
  cases: cases.map(([name, script, opts]) => {
    // Snapshot before newProject: it stamps rev/source_sha onto the shared line objects.
    const parsed = JSON.parse(JSON.stringify(D.parseScript(script, opts)));
    const coverage = D.verifySourceCoverage(script, D.parseScript(script, opts));
    const project = D.newProject({ source_script: script, parsed: D.parseScript(script, opts), settings: opts.narrator ? { narrator_name: opts.narrator } : undefined });
    return {
      name,
      script,
      opts,
      parsed,
      coverage,
      project: { title: project.title, source_sha256: project.source_sha256, source_coverage: project.source_coverage, actors: project.actors.map((a) => a.speaker_key) },
    };
  }),
};
const target = join(root, "src/lib/dexparse/dexdiffusion/fixtures/golden.json");
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${out.cases.length} cases from ${dramaPath} @ ${commit} → ${target}`);
