import {
  ATX_RE,
  DIALOGUE_RE,
  EQUALS_RULE_RE,
  RULE_RE,
  SCENE_PREFIX_RE,
  SCENE_RE,
  equalsCount,
  findBrackets,
  hasLower,
  onlyBrackets,
  PROSE_STARTERS,
  speakerTokens,
  type FoundBracket,
} from "./grammar.ts";
import type { CueType, Diagnostic, Kind, Segment } from "./types.ts";
import { finalize } from "./validator.ts";
import type { ParseOutput } from "./types.ts";

interface LineRec {
  line: number;
  start: number;
  contentEnd: number;
  end: number;
  text: string;
}

function splitLines(source: string, from: number, to: number): LineRec[] {
  const lines: LineRec[] = [];
  let i = from;
  let lineNo = 1;
  if (from > 0) {
    lineNo = 1;
    for (let k = 0; k < from; k += 1) {
      if (source[k] === "\n" || (source[k] === "\r" && source[k + 1] !== "\n")) lineNo += 1;
    }
  }
  while (i < to) {
    let j = i;
    while (j < to && source[j] !== "\n" && source[j] !== "\r") j += 1;
    const contentEnd = j;
    if (j < to && source[j] === "\r" && source[j + 1] === "\n") j += 2;
    else if (j < to && (source[j] === "\n" || source[j] === "\r")) j += 1;
    lines.push({
      line: lineNo,
      start: i,
      contentEnd,
      end: j,
      text: source.slice(i, contentEnd),
    });
    lineNo += 1;
    i = j;
  }
  return lines;
}

function columnAt(source: string, index: number): number {
  let i = index - 1;
  while (i >= 0 && source[i] !== "\n" && source[i] !== "\r") i -= 1;
  return index - i;
}

function baseSegment(
  source: string,
  start: number,
  end: number,
  kind: Kind,
  extra: Partial<Segment> = {},
): Segment {
  return {
    id: "",
    kind,
    raw: source.slice(start, end),
    start,
    end,
    line: extra.line ?? 1,
    column: extra.column ?? columnAt(source, start),
    warnings: extra.warnings ?? [],
    origin: "deterministic",
    ambiguous: extra.ambiguous,
    speaker: extra.speaker,
    delivery: extra.delivery,
    cueType: extra.cueType,
    detail: extra.detail,
    durationMs: extra.durationMs,
    location: extra.location,
    timeOfDay: extra.timeOfDay,
    headingLevel: extra.headingLevel,
    contentStart: extra.contentStart,
    children: extra.children,
  };
}

function warn(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  start: number,
  end: number,
): Diagnostic {
  return { code, severity, message, start, end };
}

function cueFromBracket(source: string, bracket: FoundBracket, line: number): Segment {
  const info = bracket.info;
  const warnings: Diagnostic[] = [];
  let kind: Kind = "unknown";
  let cueType: CueType | undefined;
  if (info.kind === "pause") {
    kind = "pause";
    cueType = "pause";
    if (info.warning === "pause_duration_missing") {
      warnings.push(
        warn(
          "pause_duration_missing",
          "warning",
          "Pause has no duration. Expected a form like [pause 2s] or [pause 500ms]. The bracket was preserved.",
          bracket.start,
          bracket.end,
        ),
      );
    } else if (info.warning === "pause_duration_invalid") {
      warnings.push(
        warn(
          "pause_duration_invalid",
          "warning",
          `Pause duration "${info.warningDetail ?? ""}" is not a number with a unit (s, ms, or min). The bracket was preserved.`,
          bracket.start,
          bracket.end,
        ),
      );
    }
  } else if (info.kind === "sfx" || info.kind === "music" || info.kind === "ambience") {
    kind = info.kind;
    cueType = info.kind;
  } else if (info.kind === "delivery") {
    kind = "unknown";
    warnings.push(
      warn(
        "unknown_instruction",
        "error",
        `Standalone bracket “[${info.detail ?? ""}]” is a delivery phrase, not a pause or sound cue. It was preserved and left unclassified.`,
        bracket.start,
        bracket.end,
      ),
    );
  } else {
    kind = "unknown";
    warnings.push(
      warn(
        "unknown_instruction",
        "error",
        `Unrecognized instruction “[${(info.detail ?? bracket.inner).trim()}]”. It was preserved and not converted into another type.`,
        bracket.start,
        bracket.end,
      ),
    );
  }
  return baseSegment(source, bracket.start, bracket.end, kind, {
    line,
    cueType,
    detail: info.detail,
    durationMs: info.durationMs,
    warnings,
  });
}

function attachCueChildren(
  source: string,
  scanFrom: number,
  contentEnd: number,
  line: number,
): { children: Segment[]; warnings: Diagnostic[] } {
  const slice = source.slice(scanFrom, contentEnd);
  const found = findBrackets(slice, scanFrom);
  const warnings: Diagnostic[] = [];
  if (found.unclosed) {
    warnings.push(
      warn(
        "unclosed_bracket",
        "warning",
        "A “[” on this line has no closing “]”. The characters were preserved as text.",
        scanFrom,
        contentEnd,
      ),
    );
  }
  const children = found.brackets
    .filter((b) => b.info.kind !== "delivery")
    .map((b) => cueFromBracket(source, b, line));
  return { children, warnings };
}

function isTitleCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (DIALOGUE_RE.test(text)) return false;
  if (SCENE_PREFIX_RE.test(trimmed)) return false;
  if (ATX_RE.test(trimmed)) return false;
  const brackets = findBrackets(trimmed, 0);
  if (onlyBrackets(brackets.residue, brackets.brackets.length, brackets.unclosed)) return false;
  return true;
}

function parseBody(source: string, from: number, to: number): Segment[] {
  const lines = splitLines(source, from, to);
  const segments: Segment[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    const trimmed = line.text.trim();

    if (trimmed.length === 0) {
      segments.push(baseSegment(source, line.start, line.end, "blank", { line: line.line }));
      continue;
    }

    if (
      next &&
      equalsCount(next.text) >= 3 &&
      isTitleCandidate(line.text)
    ) {
      segments.push(
        baseSegment(source, line.start, next.end, "title", {
          line: line.line,
          detail: trimmed,
          contentStart: line.start + (line.text.length - line.text.trimStart().length),
        }),
      );
      i += 1;
      continue;
    }

    if (RULE_RE.test(line.text) || (EQUALS_RULE_RE.test(line.text) && equalsCount(line.text) >= 3)) {
      segments.push(
        baseSegment(source, line.start, line.end, "formatting", {
          line: line.line,
          detail: "rule",
        }),
      );
      continue;
    }

    const atx = ATX_RE.exec(trimmed);
    if (atx) {
      const hashes = atx[1].length;
      const lead = line.text.length - line.text.trimStart().length;
      segments.push(
        baseSegment(source, line.start, line.end, "title", {
          line: line.line,
          headingLevel: hashes,
          detail: atx[2].trim(),
          contentStart: line.start + lead,
        }),
      );
      continue;
    }

    if (SCENE_PREFIX_RE.test(trimmed)) {
      const scene = SCENE_RE.exec(trimmed);
      if (scene) {
        segments.push(
          baseSegment(source, line.start, line.end, "scene_heading", {
            line: line.line,
            location: scene[2].trim(),
            timeOfDay: scene[3].trim(),
            detail: trimmed,
          }),
        );
      } else {
        segments.push(
          baseSegment(source, line.start, line.end, "ambiguous", {
            line: line.line,
            ambiguous: true,
            warnings: [
              warn(
                "ambiguous_scene",
                "error",
                "This line starts like a scene heading (INT. or EXT.) but has no recognized time of day after a dash. It was preserved and not treated as narration or dialogue.",
                line.start,
                line.end,
              ),
            ],
          }),
        );
      }
      continue;
    }

    const dialogue = DIALOGUE_RE.exec(line.text);
    if (dialogue) {
      const indent = dialogue[1];
      const name = dialogue[2];
      const paren = dialogue[3];
      const body = dialogue[4];
      const tokens = speakerTokens(name);
      const single = tokens.length === 1 ? tokens[0] : "";
      const singleKey = single.toLowerCase().replace(/\.$/, "");
      const titleLabel = tokens.length === 1 && singleKey === "title";
      const proseLabel = tokens.length === 1 && hasLower(single) && PROSE_STARTERS.has(singleKey);

      if (titleLabel) {
        const bodyOffset = line.text.length - body.length;
        segments.push(
          baseSegment(source, line.start, line.end, "title", {
            line: line.line,
            detail: body.trim(),
            contentStart: line.start + bodyOffset,
          }),
        );
        continue;
      }

      if (proseLabel) {
        const { children, warnings } = attachCueChildren(source, line.start, line.contentEnd, line.line);
        warnings.unshift(
          warn(
            "prose_colon",
            "info",
            `“${single}” is a reserved prose label, not a speaker. The line was classified as narration. ALL CAPS names are still speakers (${single.toUpperCase()}: …).`,
            line.start,
            line.contentEnd,
          ),
        );
        segments.push(
          baseSegment(source, line.start, line.end, "narration", {
            line: line.line,
            contentStart: line.start + indent.length,
            children: children.length ? children : undefined,
            warnings,
          }),
        );
        continue;
      }

      const bodyOffset = line.text.length - body.length;
      let contentStart = line.start + bodyOffset;
      let delivery = paren?.trim() || undefined;
      const bodySlice = line.text.slice(bodyOffset);
      const leadBracket = findBrackets(bodySlice, contentStart).brackets[0];
      if (
        leadBracket &&
        leadBracket.start === contentStart &&
        leadBracket.info.kind === "delivery"
      ) {
        const phrase = leadBracket.info.detail?.trim();
        delivery = delivery && phrase ? `${delivery}; ${phrase}` : phrase || delivery;
        let consume = leadBracket.end - leadBracket.start;
        const after = contentStart + consume;
        if (source[after] === " " || source[after] === "\t") consume += 1;
        contentStart += consume;
      }

      const { children, warnings } = attachCueChildren(source, contentStart, line.contentEnd, line.line);
      segments.push(
        baseSegment(source, line.start, line.end, "dialogue", {
          line: line.line,
          speaker: name.trim(),
          delivery,
          contentStart,
          column: columnAt(source, line.start),
          children: children.length ? children : undefined,
          warnings,
        }),
      );
      continue;
    }

    const bracketScan = findBrackets(line.text, line.start);
    if (onlyBrackets(bracketScan.residue, bracketScan.brackets.length, bracketScan.unclosed)) {
      if (bracketScan.brackets.length === 1) {
        const only = cueFromBracket(source, bracketScan.brackets[0], line.line);
        segments.push(
          baseSegment(source, line.start, line.end, only.kind, {
            line: line.line,
            cueType: only.cueType,
            detail: only.detail,
            durationMs: only.durationMs,
            warnings: only.warnings,
            ambiguous: only.ambiguous,
            contentStart: only.start,
          }),
        );
      } else {
        const children = bracketScan.brackets.map((b) => cueFromBracket(source, b, line.line));
        segments.push(
          baseSegment(source, line.start, line.end, "sequence", {
            line: line.line,
            children,
          }),
        );
      }
      continue;
    }

    const { children, warnings } = attachCueChildren(source, line.start, line.contentEnd, line.line);
    segments.push(
      baseSegment(source, line.start, line.end, "narration", {
        line: line.line,
        contentStart: line.start + (line.text.length - line.text.trimStart().length),
        children: children.length ? children : undefined,
        warnings,
      }),
    );
  }
  return segments;
}

function assignIds(segments: Segment[]): void {
  segments.forEach((segment, index) => {
    segment.id = `seg-${String(index + 1).padStart(4, "0")}`;
    segment.warnings = segment.warnings.map((w) => ({ ...w, segmentId: segment.id }));
    segment.children?.forEach((child, childIndex) => {
      child.id = `${segment.id}.c${childIndex + 1}`;
      child.warnings = child.warnings.map((w) => ({ ...w, segmentId: child.id }));
    });
  });
}

/** Deterministic parse. Does not read the network, the clock, or the environment. */
export function parseDocument(source: string): ParseOutput {
  let segments: Segment[];
  if (source.charCodeAt(0) === 0xfeff) {
    const bom = baseSegment(source, 0, 1, "formatting", {
      line: 1,
      column: 1,
      detail: "bom",
      warnings: [
        warn(
          "bom_preserved",
          "info",
          "A leading byte-order mark was preserved as formatting and is not part of the script text.",
          0,
          1,
        ),
      ],
    });
    segments = [bom, ...parseBody(source, 1, source.length)];
  } else {
    segments = parseBody(source, 0, source.length);
  }
  assignIds(segments);
  return finalize(source, segments);
}
