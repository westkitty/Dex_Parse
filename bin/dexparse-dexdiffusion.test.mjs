import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "dexparse-dexdiffusion.mjs");
const FIX = join(here, "..", "src/lib/dexparse/dexdiffusion/fixtures");
const golden = JSON.parse(readFileSync(join(FIX, "golden.json"), "utf8"));
const gold = (name) => golden.cases.find((c) => c.name === name);

function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, DEXDIFFUSION_URL: "", ...env } }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

/** Minimal stand-in for DexDiffusion's /api/drama routes that records what it receives. */
async function fakeDexDiffusion(reply) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const out = reply(req.url, body ? JSON.parse(body) : null);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

describe("bin/dexparse-dexdiffusion.mjs", () => {
  it("parse prints the same JSON DexDiffusion's /api/drama/parse returns", async () => {
    const r = await run(["parse", join(FIX, "studio-drama.txt")]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true, parsed: gold("studio-drama").parsed, mode: "deterministic" });
  });

  it("keeps CRLF bytes and honours --narrator", async () => {
    const crlf = await run(["parse", join(FIX, "crlf.txt")]);
    assert.deepEqual(JSON.parse(crlf.stdout).parsed, gold("crlf").parsed);
    const n = await run(["parse", join(FIX, "studio-drama.txt"), "--narrator", "Storyteller"]);
    assert.deepEqual(JSON.parse(n.stdout).parsed, gold("studio-drama-custom-narrator").parsed);
  });

  it("request reads a DexParse export and a DexDiffusion project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dexparse-cli-"));
    const script = readFileSync(join(FIX, "crlf.txt"), "utf8");
    writeFileSync(join(dir, "dexparse-r1.json"), JSON.stringify({ schema: "dexparse.document/v1", source: { text: script } }));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ schema: "dexdiffusion.drama_project.v2", source_script: script, title: "Hall" }));
    const a = JSON.parse((await run(["request", join(dir, "dexparse-r1.json"), "--title", "Pilot"])).stdout);
    assert.deepEqual(a, { title: "Pilot", script, mode: "deterministic", settings: { narrator_name: "NARRATOR" } });
    const b = JSON.parse((await run(["request", join(dir, "project.json")])).stdout);
    assert.equal(b.script, script);
    assert.equal(b.title, "Hall");
    const bad = await run(["request", join(dir, "nope.json")]);
    assert.notEqual(bad.code, 0);
  });

  it("coverage exits non-zero when DexDiffusion's own source check would fail", async () => {
    assert.equal((await run(["coverage", join(FIX, "studio-drama.txt")])).code, 0);
    assert.equal((await run(["coverage", join(FIX, "divergent.txt")])).code, 4);
  });

  it("send posts the exact project body with DexDiffusion's guard headers", async () => {
    const fake = await fakeDexDiffusion((url, body) =>
      url === "/api/drama/projects"
        ? { status: 201, json: { ok: true, project: { id: "dp-0123abcd", title: body.title, saved: false, scenes: [{ lines: [1, 2] }], actors: [{ speaker: "MAYA" }], source: { rev: 1, sha256: "x", coverage: { ok: true } } } } }
        : { status: 404, json: { error: "nf" } },
    );
    try {
      const r = await run(["send", join(FIX, "crlf.txt"), "--title", "Hall"], { DEXDIFFUSION_URL: fake.url });
      assert.equal(r.code, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.project_id, "dp-0123abcd");
      assert.equal(out.saved, false);
      assert.equal(out.source_sha256, "x");
      assert.equal(out.source_coverage_ok, true);
      const [req] = fake.seen;
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/api/drama/projects");
      assert.equal(req.headers["content-type"], "application/json");
      assert.equal(req.headers["x-dex-request"], "1");
      assert.equal(req.headers.origin, fake.url);
      assert.deepEqual(req.body, { title: "Hall", script: readFileSync(join(FIX, "crlf.txt"), "utf8"), mode: "deterministic", settings: { narrator_name: "NARRATOR" } });
    } finally {
      await fake.close();
    }
  });

  it("verify passes when the backend parses identically and fails when it drifts", async () => {
    const good = gold("studio-drama").parsed;
    const fake = await fakeDexDiffusion((url, body) => {
      assert.equal(url, "/api/drama/parse");
      assert.equal(body.mode, "deterministic");
      return { json: { ok: true, parsed: body.script.includes("DRIFT") ? { ...good, title: "other" } : good, mode: "deterministic" } };
    });
    try {
      const ok = await run(["verify", join(FIX, "studio-drama.txt"), "--url", fake.url]);
      assert.equal(ok.code, 0, ok.stderr);
      assert.equal(JSON.parse(ok.stdout).ok, true);
      const dir = mkdtempSync(join(tmpdir(), "dexparse-cli-"));
      writeFileSync(join(dir, "drift.txt"), readFileSync(join(FIX, "studio-drama.txt"), "utf8") + "\nDRIFT\n");
      const drift = await run(["verify", join(dir, "drift.txt"), "--url", fake.url]);
      assert.equal(drift.code, 5);
    } finally {
      await fake.close();
    }
  });

  it("refuses non-loopback hosts and reports an unreachable backend", async () => {
    const remote = await run(["send", join(FIX, "crlf.txt"), "--url", "http://example.com"]);
    assert.equal(remote.code, 1);
    assert.match(remote.stderr, /Refusing/);
    const down = await run(["status", "--url", "http://127.0.0.1:9"]);
    assert.equal(down.code, 2);
    assert.match(down.stderr, /not reachable/);
  });
});
