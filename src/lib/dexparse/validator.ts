import type { Diagnostic, ParseOutput, Segment, Validation } from "./types.ts";

export function reconstruct(segments: Segment[]): string {
  return segments.map((s) => s.raw).join("");
}

function pushUnclassified(segment: Segment, into: number): number {
  if (segment.kind === "unknown" || segment.kind === "ambiguous") {
    return into + (segment.end - segment.start);
  }
  let n = into;
  for (const child of segment.children ?? []) {
    if (child.kind === "unknown" || child.kind === "ambiguous") n += child.end - child.start;
  }
  return n;
}

export function validate(source: string, segments: Segment[]): Validation {
  const gaps: Validation["gaps"] = [];
  const overlaps: Validation["overlaps"] = [];
  let cursor = 0;
  let rawMismatch = false;

  for (const segment of segments) {
    if (segment.start < cursor) {
      overlaps.push({ start: segment.start, end: Math.min(segment.end, cursor) });
    } else if (segment.start > cursor) {
      gaps.push({ start: cursor, end: segment.start });
    }
    if (segment.end < segment.start) rawMismatch = true;
    if (segment.raw !== source.slice(segment.start, segment.end)) rawMismatch = true;
    for (const child of segment.children ?? []) {
      if (child.start < segment.start || child.end > segment.end) rawMismatch = true;
      if (child.raw !== source.slice(child.start, child.end)) rawMismatch = true;
    }
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < source.length) gaps.push({ start: cursor, end: source.length });

  const reconstructedMatches =
    !rawMismatch && gaps.length === 0 && overlaps.length === 0 && reconstruct(segments) === source;

  let unclassified = 0;
  let ambiguityCount = 0;
  let unknownCount = 0;
  const walk = (segment: Segment) => {
    if (segment.kind === "ambiguous" || segment.ambiguous) ambiguityCount += 1;
    if (segment.kind === "unknown") unknownCount += 1;
    for (const child of segment.children ?? []) {
      if (child.kind === "unknown") unknownCount += 1;
      if (child.kind === "ambiguous" || child.ambiguous) ambiguityCount += 1;
    }
  };
  for (const segment of segments) {
    unclassified = pushUnclassified(segment, unclassified);
    walk(segment);
  }

  const sourceChars = source.length;
  const accountedChars = reconstructedMatches ? sourceChars : Math.max(0, sourceChars - gapSpan(gaps));
  const unclassifiedChars = reconstructedMatches ? unclassified : sourceChars;
  const classifiedChars = reconstructedMatches ? sourceChars - unclassifiedChars : 0;

  return {
    sourceChars,
    accountedChars,
    classifiedChars,
    unclassifiedChars,
    coverageComplete: gaps.length === 0 && overlaps.length === 0 && !rawMismatch,
    reconstructedMatches,
    gaps,
    overlaps,
    ambiguityCount,
    unknownCount,
    warningCount: 0,
    errorCount: 0,
    status: "partial",
  };
}

function gapSpan(gaps: { start: number; end: number }[]): number {
  return gaps.reduce((n, g) => n + (g.end - g.start), 0);
}

export function collectDiagnostics(segments: Segment[], validation: Validation): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const walk = (segment: Segment) => {
    for (const warning of segment.warnings) {
      diagnostics.push({ ...warning, segmentId: warning.segmentId ?? segment.id });
    }
    for (const child of segment.children ?? []) walk(child);
  };
  for (const segment of segments) walk(segment);

  if (!validation.reconstructedMatches || !validation.coverageComplete) {
    diagnostics.push({
      code: "coverage_mismatch",
      severity: "error",
      message:
        "Parser coverage failed: the original text cannot be reconstructed exactly. This is an engine fault, not a script problem. No source text was changed.",
    });
  }
  return diagnostics;
}

export function finalize(source: string, segments: Segment[]): ParseOutput {
  const structural = validate(source, segments);
  const diagnostics = collectDiagnostics(segments, structural);
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  let status: Validation["status"] = "verified";
  if (!structural.coverageComplete || !structural.reconstructedMatches) status = "invalid";
  else if (structural.unclassifiedChars > 0 || structural.ambiguityCount > 0 || structural.unknownCount > 0)
    status = "partial";

  const validation: Validation = {
    ...structural,
    warningCount,
    errorCount,
    status,
  };
  return { segments, diagnostics, validation };
}
