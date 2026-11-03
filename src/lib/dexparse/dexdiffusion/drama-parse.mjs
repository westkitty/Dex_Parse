/* eslint-disable no-useless-escape -- regexes are kept character-for-character identical to DexDiffusion drama.js so drift is easy to diff. */
// Faithful port of DexDiffusion's Drama ("Audio > Script") deterministic parser.
//
// Reference implementation: westkitty/Image_Gen operator-console/drama.js
// (parseScript, parseCue, verifySourceCoverage, reconstructLineText), verified
// against Image_Gen commit df765a1. The output object is byte-for-byte the
// `parsed` value DexDiffusion returns from POST /api/drama/parse and stores in a
// drama project. Golden fixtures and a live parity test keep the two in step;
// change this file only together with a regenerated golden file
// (scripts/dexdiffusion-golden.mjs).
//
// Plain ESM with no imports, so the browser app, the Node CLI
// (bin/dexparse-dexdiffusion.mjs) and node --test can all load it.

export const DD_SCHEMA = "dexdiffusion.drama_project.v2";
export const DD_REFERENCE_COMMIT = "df765a1";
export const DD_KINDS = ["dialogue", "narration", "direction"];
export const DD_DEFAULT_SETTINGS = Object.freeze({
  line_gap_s: 0.35,
  scene_gap_s: 1.0,
  narrator_name: "NARRATOR",
  default_language: "en",
});
export const DD_SPAN_CLASSES = ["dialogue", "narration", "heading", "direction", "pause", "syntax"];
/** DexDiffusion's LLM parse refuses scripts longer than this; the deterministic parse has no limit. */
export const DD_LLM_MAX_CHARS = 14000;

const HEADING_RES = [
  /^\s*(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s+\S.*$/i,
  /^\s*#{1,3}\s+(\S.*?)\s*#*\s*$/,
  /^\s*={2,}\s*(\S.*?)\s*={2,}\s*$/,
  /^\s*(?:SCENE|ACT|CHAPTER)\s+(?:\d+|[IVXLC]+)\b[:.\- ]*.*$/i,
];
const STOP_NAMES = new Set([
  "NOTE", "NOTES", "TITLE", "SETTING", "TIME", "LOCATION", "SCENE", "INT", "EXT", "CAST", "AUTHOR", "DATE", "CHARACTERS",
]);
const DIALOGUE_RE = /^\s*([A-Za-z][A-Za-z0-9 _.'\-]{0,38}?)\s*(?:\(([^)]{1,60})\))?\s*:\s*(\S.*)$/;
const PAUSE_RE = /^\s*[\[(]\s*(?:pause|beat|silence)\s*(\d+(?:\.\d+)?)?\s*s?\s*[\])]\s*$/i;
const FULL_DIRECTION_RE = /^\s*[\[(][^\]):]{1,120}[\])]\s*$/;
const CUE_RE = /^\s*[\[(]\s*(SFX|SOUND|FX|MUSIC|AMBIENCE|AMBIENT|BED|ATMOS(?:PHERE)?)\s*[:\-\u2013\u2014]\s*([^\])]{1,200}?)\s*[\])]\s*$/i;
const CUE_ROLE = {
  sfx: "sfx", sound: "sfx", fx: "sfx", music: "music",
  ambience: "ambience", ambient: "ambience", bed: "ambience", atmos: "ambience", atmosphere: "ambience",
};

export function parseCue(text) {
  const m = CUE_RE.exec(text);
  if (!m) return null;
  const params = {};
  const desc = [];
  for (const raw of m[2].split(",")) {
    const t = raw.trim();
    let x;
    if ((x = /^fade[- ]?in\s+(\d+(?:\.\d+)?)\s*s?(?:ec(?:onds)?)?$/i.exec(t))) params.fade_in_s = Number(x[1]);
    else if ((x = /^fade[- ]?out\s+(\d+(?:\.\d+)?)\s*s?(?:ec(?:onds)?)?$/i.exec(t))) params.fade_out_s = Number(x[1]);
    else if (
      (x = /^(?:for|duration)\s+(\d+(?:\.\d+)?)\s*s?(?:ec(?:onds)?)?$/i.exec(t)) ||
      (x = /^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds)?)?\s+long$/i.exec(t))
    ) params.duration_s = Number(x[1]);
    else if (/^loop(?:ed|ing)?$/i.test(t)) params.loop = true;
    else if (/^optional$/i.test(t)) params.optional = true;
    else if (/^required$/i.test(t)) params.required = true;
    else if (/^no[- ]duck$/i.test(t)) params.duck = false;
    else if (/^duck$/i.test(t)) params.duck = true;
    else if (t) desc.push(t);
  }
  return { role: CUE_ROLE[m[1].toLowerCase()], description: desc.join(", ").slice(0, 160), params };
}

const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();
export const keyOf = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
const headingTitle = (line) => {
  for (const re of HEADING_RES) {
    const m = re.exec(line);
    if (m) return (m[1] || line).trim().replace(/^#+\s*/, "");
  }
  return null;
};
function speakerOk(name) {
  const n = name.trim();
  if (!n || STOP_NAMES.has(n.toUpperCase()) || n.split(/\s+/).length > 4) return false;
  if (/[!?,;]/.test(n)) return false;
  return true;
}
function leadingDirections(text) {
  const dirs = [];
  let rest = text.trimStart();
  let m;
  const re = /^[\[(]([^\])]{1,80})[\])]\s*/;
  while ((m = re.exec(rest))) {
    dirs.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  return { direction: dirs.join(", "), rest };
}

export const normalizeNewlines = (s) => String(s == null ? "" : s).replace(/\r\n?/g, "\n");

function leadingDirectionSpans(text) {
  const out = [];
  let at = 0;
  let m;
  const re = /^[\[(]([^\])]{1,80})[\])]\s*/;
  while ((m = re.exec(text.slice(at)))) {
    out.push([at, at + m[0].trimEnd().length]);
    at += m[0].length;
  }
  return { groups: out, restAt: at };
}

/** DexDiffusion drama.js parseScript, unchanged in behaviour. */
export function parseScript(source, opts = {}) {
  const narrator = (opts.narrator || DD_DEFAULT_SETTINGS.narrator_name).trim() || "NARRATOR";
  const original = normalizeNewlines(source);
  const raw = original.split("\n");
  const starts = [];
  let off = 0;
  for (const l of raw) {
    starts.push(off);
    off += l.length + 1;
  }
  const cand = new Map();
  let anyCaps = false;
  raw.forEach((l) => {
    const m = DIALOGUE_RE.exec(l);
    if (m && speakerOk(m[1]) && !headingTitle(l)) {
      const k = keyOf(m[1]);
      cand.set(k, (cand.get(k) || 0) + 1);
      if (isAllCaps(m[1].trim())) anyCaps = true;
    }
  });
  const accepted = (name) => {
    const k = keyOf(name);
    return isAllCaps(name.trim()) || (cand.get(k) || 0) >= 2 || !anyCaps;
  };

  const scenes = [];
  let scene = null;
  let lineNo = 0;
  const warnings = [];
  const spans = [];
  const span = (s, e, cls, line) => {
    if (e > s) spans.push({ start: s, end: e, class: cls, line: line || null });
  };
  const bounds = (i) => {
    const l = raw[i];
    return [starts[i] + (l.length - l.trimStart().length), starts[i] + l.trimEnd().length];
  };
  const newScene = (title) => {
    scene = { id: "sc-" + String(scenes.length + 1).padStart(2, "0"), title: title || "Scene " + (scenes.length + 1), lines: [] };
    scenes.push(scene);
    return scene;
  };
  const mk = (o) =>
    Object.assign(
      {
        id: "ln-" + String(++lineNo).padStart(3, "0"),
        speaker: o.speaker,
        speaker_key: keyOf(o.speaker),
        kind: o.kind,
        text: o.text,
        direction: o.direction || "",
        pause_before_s: o.pause_before_s == null ? null : o.pause_before_s,
        pause_after_s: null,
        render: o.kind !== "direction",
        src: o.src,
        takes: [],
        active_take_id: null,
      },
      o.cue ? { cue: o.cue } : {},
    );
  const push = (o) => {
    if (!scene) newScene(null);
    scene.lines.push(mk(o));
    return scene.lines[scene.lines.length - 1];
  };
  let cur = null;
  let nar = null;
  let pendingPause = null;
  const flushNar = () => {
    if (nar) {
      const ln = push({ speaker: narrator, kind: "narration", text: nar.text, src: { start: nar.s, end: nar.e }, pause_before_s: nar.pause });
      for (const [a, b] of nar.spans) span(a, b, "narration", ln);
      nar = null;
    }
  };
  const endAll = () => {
    flushNar();
    cur = null;
  };
  const spokenSpans = (from, to, line) => {
    const { groups, restAt } = leadingDirectionSpans(original.slice(from, to));
    for (const [a, b] of groups) span(from + a, from + b, "direction", line);
    span(from + restAt, to, "dialogue", line);
  };

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const t = line.trim();
    const s = starts[i];
    const e = s + line.length;
    if (!t) {
      endAll();
      continue;
    }
    const [c0, c1] = bounds(i);
    const h = headingTitle(line);
    if (h) {
      endAll();
      span(c0, c1, "heading");
      newScene(h);
      continue;
    }
    const pz = PAUSE_RE.exec(line);
    if (pz) {
      endAll();
      span(c0, c1, "pause");
      pendingPause = pz[1] ? Number(pz[1]) : 0.6;
      continue;
    }
    const cueParsed = parseCue(line);
    if (cueParsed) {
      endAll();
      const ln = push({ speaker: narrator, kind: "direction", text: t.replace(/^[\[(]\s*|\s*[\])]$/g, ""), src: { start: s, end: e }, cue: cueParsed });
      span(c0, c1, "direction", ln);
      continue;
    }
    if (FULL_DIRECTION_RE.test(line) && !DIALOGUE_RE.test(line)) {
      endAll();
      const ln = push({ speaker: narrator, kind: "direction", text: t.replace(/^[\[(]\s*|\s*[\])]$/g, ""), src: { start: s, end: e } });
      span(c0, c1, "direction", ln);
      continue;
    }
    const dm = DIALOGUE_RE.exec(line);
    if (dm && speakerOk(dm[1]) && accepted(dm[1])) {
      endAll();
      const ld = leadingDirections(dm[3]);
      const dir = [dm[2], ld.direction].filter(Boolean).join(", ");
      const textStart = e - dm[3].length;
      cur = push({ speaker: dm[1].trim(), kind: "dialogue", text: ld.rest, direction: dir, src: { start: textStart, end: e }, pause_before_s: pendingPause });
      pendingPause = null;
      span(c0, textStart, "syntax", cur);
      spokenSpans(textStart, c1, cur);
      continue;
    }
    if (
      isAllCaps(t) && t.length <= 30 && !/[.!?]$/.test(t) && speakerOk(t) &&
      i + 1 < raw.length && raw[i + 1].trim() && !headingTitle(raw[i + 1]) &&
      !(cur && starts[i] === cur.src.end + 1)
    ) {
      endAll();
      let j = i + 1;
      let dir = "";
      const par = /^\s*[\[(]([^\])]{1,80})[\])]\s*$/.exec(raw[j]);
      const parIdx = par ? j : -1;
      if (par) {
        dir = par[1].trim();
        j++;
      }
      const body = [];
      let bs = null;
      let be = null;
      const bodyIdx = [];
      while (j < raw.length && raw[j].trim() && !headingTitle(raw[j])) {
        if (bs == null) bs = starts[j];
        be = starts[j] + raw[j].length;
        body.push(raw[j].trim());
        bodyIdx.push(j);
        j++;
      }
      if (body.length) {
        const ld = leadingDirections(body.join(" "));
        const ln = push({ speaker: t, kind: "dialogue", text: ld.rest, direction: [dir, ld.direction].filter(Boolean).join(", "), src: { start: bs, end: be }, pause_before_s: pendingPause });
        pendingPause = null;
        span(c0, c1, "syntax", ln);
        if (parIdx >= 0) {
          const [pa, pb] = bounds(parIdx);
          span(pa, pb, "direction", ln);
        }
        bodyIdx.forEach((bi, k) => {
          const [ba, bb] = bounds(bi);
          if (k === 0) spokenSpans(ba, bb, ln);
          else span(ba, bb, "dialogue", ln);
        });
        i = j - 1;
        continue;
      }
    }
    if (cur) {
      cur.text += " " + t;
      cur.src.end = e;
      span(c0, c1, "dialogue", cur);
      continue;
    }
    if (nar) {
      nar.text += " " + t;
      nar.e = e;
      nar.spans.push([c0, c1]);
      continue;
    }
    nar = { text: t, s, e, pause: pendingPause, spans: [[c0, c1]] };
    pendingPause = null;
  }
  endAll();
  const speakers = new Map();
  for (const sc of scenes)
    for (const l of sc.lines) {
      if (l.kind === "direction") continue;
      const k = l.speaker_key;
      if (!speakers.has(k)) speakers.set(k, { key: k, name: l.speaker, lines: 0, kinds: { dialogue: 0, narration: 0 } });
      const sp = speakers.get(k);
      sp.lines++;
      sp.kinds[l.kind]++;
    }
  if (!scenes.length) warnings.push('No lines were found. Use "NAME: text" lines, screenplay cues, or plain narration paragraphs.');
  else if (![...speakers.values()].some((s) => s.kinds.dialogue))
    warnings.push('No dialogue lines were detected (only narration). Use "NAME: text" if you expected speakers.');
  const firstHeading = (scenes.length && headingTitle(raw.find((l) => headingTitle(l)) || "")) || null;
  const outSpans = spans
    .map((x) => ({ start: x.start, end: x.end, class: x.class, line_id: x.line ? x.line.id : null }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { source_length: original.length, title: firstHeading, scenes, speakers: [...speakers.values()], warnings, spans: outSpans };
}

export const normalizeSpoken = (s) => String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();

export function reconstructLineText(text, line) {
  const slice = text.slice(line.src.start, line.src.end);
  if (line.kind === "direction") return normalizeSpoken(slice.replace(/^\s*[\[(]\s*|\s*[\])]\s*$/g, ""));
  const { restAt } = leadingDirectionSpans(slice.trimStart());
  return normalizeSpoken(slice.trimStart().slice(restAt));
}

/** DexDiffusion drama.js verifySourceCoverage, unchanged in behaviour. */
export function verifySourceCoverage(source, parsed) {
  const text = normalizeNewlines(source);
  const cover = new Int8Array(text.length).fill(-1);
  const counts = Object.fromEntries(DD_SPAN_CLASSES.map((c) => [c, 0]));
  const problems = [];
  (parsed.spans || []).forEach((sp, idx) => {
    if (!DD_SPAN_CLASSES.includes(sp.class) || !(sp.start >= 0 && sp.end <= text.length && sp.end > sp.start)) {
      problems.push({ index: idx, reason: "invalid-span" });
      return;
    }
    const ci = DD_SPAN_CLASSES.indexOf(sp.class);
    for (let k = sp.start; k < sp.end; k++)
      if (cover[k] < 0) {
        cover[k] = ci;
        if (!/\s/.test(text[k])) counts[sp.class]++;
      }
  });
  const unclassified = [];
  for (let k = 0; k < text.length; k++) {
    if (cover[k] >= 0 || /\s/.test(text[k])) continue;
    const start = k;
    while (k + 1 < text.length && cover[k + 1] < 0 && !/\s/.test(text[k + 1])) k++;
    unclassified.push({ start, end: k + 1 });
  }
  const mismatches = [];
  for (const sc of parsed.scenes || [])
    for (const l of sc.lines) {
      if (!l.src || l.edited) continue;
      if (reconstructLineText(text, l) !== normalizeSpoken(l.text)) mismatches.push({ line_id: l.id, scene_id: sc.id, reason: "text-differs-from-source" });
    }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) + unclassified.reduce((a, u) => a + (u.end - u.start), 0);
  return {
    ok: !unclassified.length && !mismatches.length && !problems.length,
    unclassified,
    mismatches,
    problems,
    counts,
    classified_chars: total - unclassified.reduce((a, u) => a + (u.end - u.start), 0),
    total_chars: total,
  };
}
