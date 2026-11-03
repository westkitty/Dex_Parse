import type { PlaybackEvent, Segment } from "./types.ts";

function pushEvent(
  events: PlaybackEvent[],
  segment: Segment,
  text: string,
  kind: PlaybackEvent["kind"] = segment.kind,
): void {
  if (text.length === 0) return;
  if (kind !== "pause" && kind !== "blank" && text.trim().length === 0) return;
  events.push({
    id: `${segment.id}.p${events.length + 1}`,
    order: events.length,
    kind,
    text,
    speaker: segment.speaker,
    delivery: segment.delivery,
    durationMs: segment.durationMs,
    line: segment.line,
    column: segment.column,
    segmentId: segment.id,
  });
}

function emitSegment(source: string, segment: Segment, events: PlaybackEvent[]): void {
  if (segment.kind === "blank" || segment.kind === "formatting") return;

  if (segment.kind === "sequence") {
    for (const child of segment.children ?? []) emitSegment(source, child, events);
    return;
  }

  if ((segment.kind === "dialogue" || segment.kind === "narration") && segment.children?.length) {
    const end = stripNewlineEnd(source, segment.end);
    let cursor = segment.contentStart ?? segment.start;
    const kids = [...segment.children].sort((a, b) => a.start - b.start);
    for (const child of kids) {
      if (child.start > cursor) {
        pushEvent(events, segment, source.slice(cursor, child.start));
      }
      emitSegment(source, child, events);
      cursor = Math.max(cursor, child.end);
    }
    if (cursor < end) pushEvent(events, segment, source.slice(cursor, end));
    return;
  }

  if (segment.kind === "dialogue") {
    const end = stripNewlineEnd(source, segment.end);
    const start = segment.contentStart ?? segment.start;
    pushEvent(events, segment, source.slice(start, end));
    return;
  }

  if (segment.kind === "narration" || segment.kind === "title" || segment.kind === "scene_heading") {
    const end = stripNewlineEnd(source, segment.end);
    pushEvent(events, segment, source.slice(segment.start, end).trimEnd());
    return;
  }

  const end = stripNewlineEnd(source, segment.end);
  pushEvent(events, segment, source.slice(segment.start, end).trim());
}

function stripNewlineEnd(source: string, end: number): number {
  let e = end;
  if (e > 0 && source[e - 1] === "\n") e -= 1;
  if (e > 0 && source[e - 1] === "\r") e -= 1;
  return e;
}

export function buildPlayback(source: string, segments: Segment[]): PlaybackEvent[] {
  const events: PlaybackEvent[] = [];
  for (const segment of segments) emitSegment(source, segment, events);
  return events.map((event, order) => ({ ...event, order, id: `${event.segmentId}.p${order + 1}` }));
}

export function formatPlayback(events: PlaybackEvent[]): string {
  return events
    .map((event) => {
      if (event.kind === "dialogue") {
        const who = event.speaker ?? "SPEAKER";
        const delivery = event.delivery ? ` (${event.delivery})` : "";
        return `${who}${delivery}: ${event.text}`;
      }
      return event.text;
    })
    .join("\n");
}
