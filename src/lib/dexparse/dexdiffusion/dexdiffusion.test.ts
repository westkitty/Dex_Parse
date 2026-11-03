import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../parser.ts";
import { toDocument } from "../serialize.ts";
import { sha256Hex } from "../source.ts";
import { SAMPLE_SCRIPT } from "../sample.ts";
import { buildDexDiffusionView, dexDiffusionRequest, dexDiffusionRequestJson, scriptFromJson } from "./compat.ts";
import { assertDexDiffusionUrl } from "./bridge.mjs";
import { DD_REFERENCE_COMMIT, parseScript, verifySourceCoverage } from "./drama-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
interface GoldenCase {
  name: string;
  script: string;
  opts: { narrator?: string };
  parsed: unknown;
  coverage: unknown;
  project: { title: string; source_sha256: string; source_coverage: { ok: boolean | null }; actors: string[] };
}
const golden = JSON.parse(readFileSync(join(here, "fixtures/golden.json"), "utf8")) as {
  reference: { commit: string; schema: string };
  cases: GoldenCase[];
};
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("DexDiffusion Drama parser port (golden fixtures from the real drama.js)", () => {
  it("was generated from the reference commit the port names", () => {
    assert.equal(golden.reference.commit, DD_REFERENCE_COMMIT);
    assert.equal(golden.reference.schema, "dexdiffusion.drama_project.v2");
    assert.ok(golden.cases.length >= 10);
  });

  for (const c of golden.cases) {
    it(`parses "${c.name}" exactly like DexDiffusion`, () => {
      const parsed = parseScript(c.script, c.opts);
      assert.deepEqual(plain(parsed), c.parsed);
      assert.deepEqual(plain(verifySourceCoverage(c.script, parsed)), c.coverage);
    });
  }
});

describe("round trip: DexParse export → DexDiffusion project", () => {
  for (const c of golden.cases.filter((x) => !x.opts.narrator)) {
    it(`keeps "${c.name}" byte-identical and hashes it the way DexDiffusion does`, async () => {
      const doc = await toDocument(1, c.script, parseDocument(c.script));
      // DexParse export → DexDiffusion request file → JSON on disk → back.
      const body = JSON.parse(dexDiffusionRequestJson(doc.source.text)) as { script: string; mode: string; settings: { narrator_name: string } };
      assert.equal(body.script, c.script);
      assert.equal(body.mode, "deterministic");
      assert.equal(body.settings.narrator_name, "NARRATOR");
      // DexDiffusion stamps source_sha256 = sha256(source_script); DexParse's source.sha256 must match it.
      assert.equal(doc.source.sha256, c.project.source_sha256);
      assert.equal(await sha256Hex(body.script), c.project.source_sha256);
      // What DexDiffusion would build from that body is what DexParse predicts.
      assert.deepEqual(plain(parseScript(body.script, { narrator: body.settings.narrator_name })), c.parsed);
      // Import of the request file or of the resulting DexDiffusion project recovers the same script.
      assert.equal(scriptFromJson(body)?.text, c.script);
      assert.equal(scriptFromJson({ schema: "dexdiffusion.drama_project.v2", source_script: c.script, title: c.project.title })?.text, c.script);
      assert.equal(scriptFromJson(JSON.parse(JSON.stringify(doc)))?.text, c.script);
    });
  }
});

describe("request body", () => {
  it("matches POST /api/drama/projects and only sets a title when given", () => {
    assert.deepEqual(dexDiffusionRequest("A: b"), { script: "A: b", mode: "deterministic", settings: { narrator_name: "NARRATOR" } });
    assert.deepEqual(dexDiffusionRequest("A: b", { title: "  Pilot ", narrator: " Voice " }), {
      title: "Pilot",
      script: "A: b",
      mode: "deterministic",
      settings: { narrator_name: "Voice" },
    });
    assert.equal(dexDiffusionRequest("x", { title: "t".repeat(300) }).title?.length, 120);
  });

  it("recognizes only known JSON shapes", () => {
    assert.equal(scriptFromJson({ hello: 1 }), null);
    assert.equal(scriptFromJson([]), null);
    assert.equal(scriptFromJson({ schema: "other.v1", source_script: "x" }), null);
    assert.equal(scriptFromJson({ project: { schema: "dexdiffusion.drama_project.v1", source_script: "old" } })?.text, "old");
    assert.equal(scriptFromJson({ script: "x", settings: { narrator_name: "N" } })?.narrator, "N");
  });

  it("only talks to loopback or a tailnet host", () => {
    assert.equal(assertDexDiffusionUrl("http://127.0.0.1:31337/x"), "http://127.0.0.1:31337");
    assert.equal(assertDexDiffusionUrl("http://localhost:31337"), "http://localhost:31337");
    assert.equal(assertDexDiffusionUrl("https://bigmac.tailafb7e8.ts.net:11443"), "https://bigmac.tailafb7e8.ts.net:11443");
    assert.throws(() => assertDexDiffusionUrl("http://bigmac.tailafb7e8.ts.net"), /Refusing/);
    assert.throws(() => assertDexDiffusionUrl("https://example.com"), /Refusing/);
    assert.throws(() => assertDexDiffusionUrl("http://u:p@127.0.0.1:31337"), /credentials/);
    assert.throws(() => assertDexDiffusionUrl("file:///etc/passwd"), /http/);
  });
});

describe("compatibility report", () => {
  const view = (text: string) => buildDexDiffusionView(text, parseDocument(text).segments);
  const codes = (text: string) => view(text).issues.map((i) => `${i.line}:${i.code}`);

  it("is clean for a script both grammars read the same way", () => {
    const text = "# Pilot\n\nMAYA: Hello.\n\n[pause 2s]\n\nJON (quietly): Hi.\n\n[SFX: door]\n\nThe room is dark.\n";
    const v = view(text);
    assert.deepEqual(v.issues, []);
    assert.equal(v.ready, true);
    assert.equal(v.warnings, 0);
    assert.deepEqual(v.parsed.speakers.map((s) => s.name), ["MAYA", "JON", "NARRATOR"]);
  });

  it("flags pauses DexDiffusion cannot time, unknown cue tags and TITLE lines", () => {
    assert.deepEqual(codes("TITLE: Pilot\n\n[pause 500ms]\n\n[AMB: rain]\n"), ["1:dd-title-spoken", "3:dd-pause-unit", "5:dd-cue-tag", "5:dd-source-check"]);
  });

  it("flags inline cues DexDiffusion keeps inside the spoken text", () => {
    const v = view("MAYA: Wait [pause 1s] now.\n");
    assert.equal(v.issues[0].code, "dd-inline-cue");
    assert.equal(v.issues[0].severity, "info");
  });

  it("flags lines DexDiffusion joins onto the dialogue above", () => {
    assert.deepEqual(codes("MAYA: One.\nRemember: prose here.\n"), ["2:dd-joined"]);
  });

  it("explains screenplay-style cues instead of calling them errors", () => {
    const v = view("TOM\n(whispering)\nGo back.\n");
    assert.ok(v.issues.length > 0);
    assert.ok(v.issues.every((i) => i.code === "dd-screenplay-cue" && i.severity === "info"));
    assert.equal(v.parsed.scenes[0].lines[0].speaker, "TOM");
  });

  it("reports DexDiffusion's own failing source check", () => {
    const v = view("[AMB: rain]\nMore text.\n");
    assert.equal(v.coverage.ok, false);
    assert.equal(v.ready, false);
    assert.ok(v.issues.some((i) => i.code === "dd-source-check"));
  });

  it("maps CRLF scripts to the right original offsets", () => {
    const text = "MAYA: one\r\n[pause 250ms]\r\n";
    const issue = view(text).issues.find((i) => i.code === "dd-pause-unit");
    assert.ok(issue);
    assert.equal(text.slice(issue.start, issue.end).trim(), "[pause 250ms]");
  });

  it("covers the bundled sample", () => {
    const v = view(SAMPLE_SCRIPT);
    assert.equal(v.ready, true);
    assert.deepEqual(v.issues.map((i) => i.code), ["dd-title-spoken", "dd-inline-cue", "dd-inline-cue"]);
  });
});

// Live parity against the real DexDiffusion source when it is checked out next to DexParse
// (or DEXDIFFUSION_ROOT points at an Image_Gen checkout). Skipped otherwise.
const imageGen = process.env.DEXDIFFUSION_ROOT ?? join(repoRoot, "..", "Image_Gen");
const dramaJs = join(imageGen, "operator-console", "drama.js");
describe("live parity with Image_Gen/operator-console/drama.js", { skip: !existsSync(dramaJs) && `no ${dramaJs}` }, () => {
  it("matches the real parser on 3,000 generated scripts", () => {
    const D = createRequire(import.meta.url)(dramaJs) as {
      parseScript: typeof parseScript;
      verifySourceCoverage: typeof verifySourceCoverage;
      newProject: (input: { source_script: string; parsed: unknown }) => { source_sha256: string; source_coverage: { ok: boolean | null } };
    };
    const atoms = [
      "INT. LAB - NIGHT", "EXT. ROOF — DAY", "# Act One", "== Part ==", "SCENE 2", "ACT IV", "MAYA: Hello there.", "Maya: hi",
      "Dr. Reed (whispering): [softly] No.", "NOTE: x", "Note: something", "TITLE: The Thing", "[pause 2s]", "[pause 500ms]",
      "[pause]", "(beat)", "[silence 1.25 s]", "[SFX: door slams, for 1.5s, optional]", "[MUSIC: strings, fade out 3s, loop]",
      "[AMB: rain]", "[AMBIENCE - wind, duck]", "(ATMOS: hum, no-duck, 4s long)", "[unknown thing]", "(quietly)", "MAYA",
      "JOHN SMITH", "---", "The ratio is 3:1 tonight.", "She walks in.", "", "", "  indented line  ", "ナオキ: こんにちは",
      "José: Hola", "\t", "A, B: x", "HELLO!", "[SFX: a]  [pause 1s]", "O'Brien: yes", "ZOË: ça va 🎧",
    ];
    let seed = 20261102;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 3000; i += 1) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => atoms[Math.floor(rnd() * atoms.length)]);
      const nl = rnd() < 0.2 ? "\r\n" : rnd() < 0.05 ? "\r" : "\n";
      const script = lines.join(nl);
      const opts = rnd() < 0.2 ? { narrator: "Storyteller" } : {};
      const ours = parseScript(script, opts);
      assert.deepEqual(plain(ours), plain(D.parseScript(script, opts)), JSON.stringify(script));
      assert.deepEqual(plain(verifySourceCoverage(script, ours)), plain(D.verifySourceCoverage(script, D.parseScript(script, opts))));
    }
  });

  it("builds a DexDiffusion project whose hash and coverage match DexParse's export", async () => {
    const D = createRequire(import.meta.url)(dramaJs) as {
      parseScript: typeof parseScript;
      newProject: (input: { source_script: string; parsed: unknown }) => { source_sha256: string; source_coverage: { ok: boolean | null } };
    };
    for (const name of ["studio-drama.txt", "crlf.txt", "divergent.txt"]) {
      const script = readFileSync(join(here, "fixtures", name), "utf8");
      const doc = await toDocument(1, script, parseDocument(script));
      const body = dexDiffusionRequest(doc.source.text);
      const project = D.newProject({ source_script: body.script, parsed: D.parseScript(body.script) });
      assert.equal(project.source_sha256, doc.source.sha256, name);
      assert.equal(project.source_coverage.ok, buildDexDiffusionView(script, parseDocument(script).segments).coverage.ok, name);
    }
  });
});
