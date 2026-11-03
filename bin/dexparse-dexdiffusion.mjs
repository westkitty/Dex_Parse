#!/usr/bin/env node
/**
 * dexparse-dexdiffusion: hand a script to DexDiffusion's Drama ("Audio > Script")
 * feature exactly the way DexDiffusion's own UI does.
 *
 *   dexparse-dexdiffusion parse    <script|json|->            same JSON as POST /api/drama/parse, computed locally
 *   dexparse-dexdiffusion coverage <script|json|->            DexDiffusion's source-coverage proof, computed locally
 *   dexparse-dexdiffusion request  <script|json|->            the POST /api/drama/projects body (what DexParse exports)
 *   dexparse-dexdiffusion verify   <script|json|-> [--url U]  parse on the running DexDiffusion and diff it with the local result
 *   dexparse-dexdiffusion send     <script|json|-> [--url U]  create an (unsaved) Drama project in DexDiffusion
 *   dexparse-dexdiffusion status   [--url U]                  GET /api/version
 *
 * Options: --title T, --narrator N, --url U (default $DEXDIFFUSION_URL or http://127.0.0.1:31337),
 *          --allow-any-host (only for a DexDiffusion that is not on loopback or *.ts.net).
 * Inputs: a .txt/.md script, a DexParse export (dexparse-rN.json), a DexDiffusion request
 * (dexdiffusion-drama-rN.json), or a saved DexDiffusion drama project JSON. Nothing is
 * saved to disk in DexDiffusion: press "Save project" there when you want to keep it.
 */
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { parseScript, verifySourceCoverage, DD_REFERENCE_COMMIT } from "../src/lib/dexparse/dexdiffusion/drama-parse.mjs";
import {
  DEXDIFFUSION_DEFAULT_URL,
  assertDexDiffusionUrl,
  dexDiffusionHeaders,
  dexDiffusionRequest,
  scriptFromJson,
} from "../src/lib/dexparse/dexdiffusion/bridge.mjs";

const USAGE = `usage: dexparse-dexdiffusion <parse|coverage|request|verify|send|status> [file|-] [--title T] [--narrator N] [--url U]`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--allow-any-host") out.allowAnyHost = true;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      out[k] = inline ?? argv[++i];
      if (out[k] === undefined) throw new Error(`--${k} needs a value`);
    } else out._.push(a);
  }
  return out;
}

function readInput(file) {
  if (!file) throw new Error("missing input file (use - for stdin)");
  const buf = file === "-" ? readFileSync(0) : readFileSync(file);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  if (/\.json$/i.test(file) || (file === "-" && /^\s*\{/.test(text))) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      if (file !== "-") throw new Error(`${file} is not valid JSON`);
    }
    if (json !== undefined) {
      const got = scriptFromJson(json);
      if (!got) throw new Error(`${file} is not a DexParse export, a DexDiffusion request, or a DexDiffusion drama project`);
      return got;
    }
  }
  return { text, from: "script" };
}

async function call(base, path, init = {}, allowAnyHost = false) {
  const origin = assertDexDiffusionUrl(base, { allowAnyHost });
  let res;
  try {
    res = await fetch(origin + path, {
      ...init,
      headers: dexDiffusionHeaders(origin),
      signal: AbortSignal.timeout(Number(process.env.DEXDIFFUSION_TIMEOUT_MS || 20000)),
    });
  } catch (e) {
    const err = new Error(`DexDiffusion is not reachable at ${origin} (${e.cause?.code || e.name || e.message}). Start it with bin/dexdiffusion, or pass --url.`);
    err.exitCode = 2;
    throw err;
  }
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* not json */
  }
  if (!res.ok && !(res.status === 422 && json)) {
    const err = new Error(`DexDiffusion ${path} answered ${res.status}: ${(json && (json.error || json.message)) || body.slice(0, 200)}`);
    err.exitCode = 3;
    throw err;
  }
  return { status: res.status, json };
}

const print = (o) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, file] = args._;
  if (!cmd || args.help) {
    process.stdout.write(USAGE + "\n");
    return cmd ? 0 : 1;
  }
  const url = args.url || process.env.DEXDIFFUSION_URL || DEXDIFFUSION_DEFAULT_URL;
  if (cmd === "status") {
    const r = await call(url, "/api/version", { method: "GET" }, args.allowAnyHost);
    print(r.json);
    return 0;
  }
  const input = readInput(file);
  const narrator = args.narrator ?? input.narrator;
  const title = args.title ?? input.title;
  if (cmd === "parse") {
    print({ ok: true, parsed: parseScript(input.text, { narrator }), mode: "deterministic" });
    return 0;
  }
  if (cmd === "coverage") {
    const c = verifySourceCoverage(input.text, parseScript(input.text, { narrator }));
    print(c);
    return c.ok ? 0 : 4;
  }
  if (cmd === "request") {
    print(dexDiffusionRequest(input.text, { title, narrator }));
    return 0;
  }
  if (cmd === "verify") {
    const local = parseScript(input.text, { narrator });
    const r = await call(url, "/api/drama/parse", { method: "POST", body: JSON.stringify({ script: input.text, mode: "deterministic" }) }, args.allowAnyHost);
    const remote = r.json && r.json.parsed;
    // /api/drama/parse does not take a narrator; compare like with like.
    const comparable = narrator ? parseScript(input.text) : local;
    const same = isDeepStrictEqual(JSON.parse(JSON.stringify(comparable)), remote);
    print({ ok: same, url, local_reference: `drama.js@${DD_REFERENCE_COMMIT}`, scenes: remote?.scenes?.length ?? null, lines: remote ? remote.scenes.reduce((n, s) => n + s.lines.length, 0) : null, speakers: remote?.speakers?.map((s) => s.name) ?? null });
    if (!same) process.stderr.write("DexDiffusion's parse differs from DexParse's local port. Update DexParse (see docs/DEXDIFFUSION.md).\n");
    return same ? 0 : 5;
  }
  if (cmd === "send") {
    const body = dexDiffusionRequest(input.text, { title, narrator });
    const r = await call(url, "/api/drama/projects", { method: "POST", body: JSON.stringify(body) }, args.allowAnyHost);
    const p = r.json && r.json.project;
    if (!p) {
      print(r.json);
      return 3;
    }
    print({
      ok: true,
      url,
      project_id: p.id,
      title: p.title,
      scenes: p.scenes.length,
      lines: p.scenes.reduce((n, s) => n + s.lines.length, 0),
      speakers: (p.actors || []).map((a) => a.speaker),
      // The API view exposes { source: { rev, sha256, coverage } }; saved project files use source_sha256 / source_coverage.
      source_sha256: p.source?.sha256 ?? p.source_sha256 ?? null,
      source_coverage_ok: (p.source?.coverage ?? p.source_coverage)?.ok ?? null,
      saved: !!p.saved,
      next: "Open DexDiffusion > Audio > Script, pick this project, bind voices, and press Save project to keep it.",
    });
    return 0;
  }
  throw new Error(`unknown command ${cmd}\n${USAGE}`);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`dexparse-dexdiffusion: ${e.message}\n`);
    process.exit(e.exitCode || 1);
  },
);
