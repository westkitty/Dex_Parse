import { useEffect, useRef, useState } from "react";
import {
  Check,
  ClipboardCopy,
  Download,
  FolderOpen,
  TriangleAlert,
} from "lucide-react";
import { buildCoverageFixture } from "@/lib/dexparse/fixture";
import {
  ambiguousTargets,
  applyAcceptedSuggestions,
  probeOllama,
  requestSuggestions,
  type Suggestion,
} from "@/lib/dexparse/ollama";
import { parseDocument } from "@/lib/dexparse/parser";
import { buildPlayback, formatPlayback } from "@/lib/dexparse/playback";
import { SAMPLE_SCRIPT } from "@/lib/dexparse/sample";
import { sha256Hex } from "@/lib/dexparse/source";
import { documentJson, toDocument } from "@/lib/dexparse/serialize";
import type { Kind, ParseOutput, PlaybackEvent, Segment } from "@/lib/dexparse/types";

const STORAGE_KEY = "dexparse.script.v1";
const KIND_LABEL: Record<Kind, string> = {
  dialogue: "Dialogue",
  scene_heading: "Scene",
  title: "Title",
  pause: "Pause",
  sfx: "Sound",
  music: "Music",
  ambience: "Ambience",
  narration: "Narration",
  blank: "Blank",
  formatting: "Formatting",
  sequence: "Cues",
  unknown: "Unknown",
  ambiguous: "Ambiguous",
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function focusScript(start: number, end: number) {
  const areas = document.querySelectorAll<HTMLTextAreaElement>("textarea[data-script]");
  const visible = [...areas].find((node) => node.getClientRects().length > 0) ?? areas[0];
  if (!visible) return;
  visible.focus();
  visible.setSelectionRange(start, Math.max(start, end));
}

function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function DexParseApp() {
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [parsedText, setParsedText] = useState(SAMPLE_SCRIPT);
  const [parsed, setParsed] = useState<ParseOutput>(() => parseDocument(SAMPLE_SCRIPT));
  const [revision, setRevision] = useState(1);
  const [hash, setHash] = useState("");
  const [mode, setMode] = useState<"deterministic" | "ollama">("deterministic");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connection, setConnection] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [note, setNote] = useState<string | null>(
    "Sample script loaded so you can try Parse. It is not your script.",
  );
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaNote, setOllamaNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"structure" | "playback" | "diagnostics">("structure");
  const [mobile, setMobile] = useState<"script" | "inspect">("script");
  const [leftPct, setLeftPct] = useState(46);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(200);
  const lastExport = useRef<string | null>(null);
  const drag = useRef<{ x: number; pct: number; width: number } | null>(null);
  const grammarRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const parseRef = useRef<() => void>(() => {});
  const dirty = script !== parsedText;
  const validation = parsed.validation;
  const playback = buildPlayback(parsedText, parsed.segments);

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(parsedText).then((value) => {
      if (!cancelled) setHash(value);
    });
    return () => {
      cancelled = true;
    };
  }, [parsedText]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved != null && saved !== SAMPLE_SCRIPT) {
        setScript(saved);
        setParsed(parseDocument(saved));
        setParsedText(saved);
        setRevision(1);
        setNote(null);
      }
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, script);
      } catch {
        /* quota */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [script]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        parseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runParse() {
    setParsing(true);
    setOllamaError(null);
    setOllamaNote(null);
    setSuggestions([]);
    setRejected([]);
    setCopyState(null);
    try {
      const { parseOffThread } = await import("@/lib/dexparse/parse-off-thread");
      let next = await parseOffThread(script);
      if (mode === "ollama") {
        const targets = ambiguousTargets(next);
        if (targets.length === 0) {
          setOllamaNote("Every span already has a deterministic classification. No model call was made.");
        } else {
          const result = await requestSuggestions({ endpoint, model, parsed: next });
          if (!result.ok) {
            setOllamaError(
              `${result.error} If Ollama is running on this computer, its origin list may be blocking this page. Deterministic results are still shown.`,
            );
          } else {
            setSuggestions(result.suggestions);
            setRejected(result.rejected);
            if (result.suggestions.length === 0) {
              setOllamaNote("The local model returned nothing DexParse could accept. Source text was not changed.");
            }
          }
        }
      }
      const rev = script === parsedText ? revision : revision + 1;
      setRevision(rev);
      setParsed(next);
      setParsedText(script);
      setNote(null);
      setMobile("inspect");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Parse failed.");
    } finally {
      setParsing(false);
    }
  }

  function accept(ids: string[]) {
    const next = applyAcceptedSuggestions(parsedText, parsed, suggestions, ids);
    setParsed(next);
    setSuggestions((current) => current.filter((item) => !ids.includes(item.id)));
  }

  function loadText(text: string, message: string | null) {
    setScript(text);
    setParsed(parseDocument(text));
    setParsedText(text);
    setRevision((value) => value + 1);
    setSuggestions([]);
    setRejected([]);
    setOllamaError(null);
    setOllamaNote(null);
    setNote(message);
    setSelectedId(null);
  }

  async function readFile(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md")) {
      setNote("Only local UTF-8 .txt and .md files can be imported.");
      return;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      loadText(text, `Imported ${file.name}. The file stayed on this device.`);
    } catch {
      setNote("That file is not valid UTF-8 text. Nothing was imported.");
    }
  }

  async function exportJson(force: boolean) {
    const name = `dexparse-r${revision}.json`;
    if (!force && lastExport.current === name) {
      setConfirmName(name);
      return;
    }
    const doc = await toDocument(revision, parsedText, parsed);
    download(name, documentJson(doc));
    lastExport.current = name;
    setConfirmName(null);
    setCopyState(`Exported ${name}`);
  }

  async function copyJson() {
    const doc = await toDocument(revision, parsedText, parsed);
    await navigator.clipboard.writeText(documentJson(doc));
    setCopyState("JSON copied.");
  }

  async function copyPlayback() {
    await navigator.clipboard.writeText(formatPlayback(playback));
    setCopyState("Playback copied.");
  }

  async function checkConnection() {
    setConnection("Checking loopback…");
    const result = await probeOllama(endpoint);
    if (!result.ok) {
      setModels([]);
      setConnection(result.error);
      return;
    }
    setModels(result.models);
    if (!model) setModel(result.models[0] ?? "");
    setConnection(`${result.models.length} local model${result.models.length === 1 ? "" : "s"} at ${endpoint}. Nothing will be downloaded.`);
  }

  parseRef.current = () => {
    void runParse();
  };

  const selected = findSegment(parsed.segments, selectedId);

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 md:px-4">
        <div className="mr-2 min-w-0">
          <p className="text-lg font-semibold tracking-tight">DexParse</p>
          <p className="text-xs text-subtle">Offline script classification</p>
        </div>
        <div className="flex rounded-md border border-line p-1" role="group" aria-label="Parser mode">
          <ModeButton
            pressed={mode === "deterministic"}
            onClick={() => setMode("deterministic")}
            label="Deterministic"
          />
          <ModeButton
            pressed={mode === "ollama"}
            onClick={() => setMode("ollama")}
            label="Local model"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={ghost} onClick={() => grammarRef.current?.showModal()}>
            Grammar
          </button>
          <button type="button" className={ghost} onClick={() => fileRef.current?.click()}>
            <FolderOpen className="size-4" aria-hidden="true" />
            Import
          </button>
          <button type="button" className={ghost} onClick={() => void exportJson(false)} disabled={dirty}>
            <Download className="size-4" aria-hidden="true" />
            Export
          </button>
          <button type="button" className={ghost} onClick={() => void copyJson()} disabled={dirty}>
            <ClipboardCopy className="size-4" aria-hidden="true" />
            Copy
          </button>
          <button type="button" className={primary} onClick={() => void runParse()} disabled={parsing}>
            {parsing ? "Parsing" : "Parse"}
            <kbd className="hidden rounded-sm bg-inset px-1.5 py-0.5 text-xs text-muted md:inline">Ctrl+Enter</kbd>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
            event.target.value = "";
          }}
        />
      </header>

      {mode === "ollama" ? (
        <div className="flex flex-wrap items-end gap-2 border-b border-line bg-surface px-3 py-2 md:px-4">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
            Loopback endpoint
            <input
              className={field}
              value={endpoint}
              spellCheck={false}
              onChange={(event) => setEndpoint(event.target.value)}
              aria-label="Ollama loopback endpoint"
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
            Local model
            <input
              className={field}
              value={model}
              list="ollama-models"
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
              placeholder="name already installed"
              aria-label="Local Ollama model"
            />
            <datalist id="ollama-models">
              {models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <button type="button" className={ghost} onClick={() => void checkConnection()}>
            Check connection
          </button>
          {connection ? <p className="max-w-xl text-xs text-muted">{connection}</p> : null}
        </div>
      ) : null}

      <div className="flex border-b border-line md:hidden">
        <button
          type="button"
          className={cn(mobileTab, mobile === "script" && "text-fg")}
          aria-pressed={mobile === "script"}
          onClick={() => setMobile("script")}
        >
          Script
        </button>
        <button
          type="button"
          className={cn(mobileTab, mobile === "inspect" && "text-fg")}
          aria-pressed={mobile === "inspect"}
          onClick={() => setMobile("inspect")}
        >
          Results
        </button>
      </div>

      <div className="hidden min-h-0 flex-1 md:grid" style={{ gridTemplateColumns: `${leftPct}% 0.5rem minmax(0, 1fr)` }}>
        <EditorPane
          script={script}
          onChange={setScript}
          onFile={(file) => void readFile(file)}
          onSample={() => loadText(SAMPLE_SCRIPT, "Sample script. It is not your script.")}
          onFixture={() =>
            loadText(
              buildCoverageFixture(),
              "Generated 6,667-character test fixture. It is not your script.",
            )
          }
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize script and results"
          tabIndex={0}
          className="cursor-col-resize bg-line hover:bg-line-strong"
          onPointerDown={(event) => {
            const parent = event.currentTarget.parentElement;
            if (!parent) return;
            drag.current = { x: event.clientX, pct: leftPct, width: parent.clientWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const next = drag.current.pct + ((event.clientX - drag.current.x) / drag.current.width) * 100;
            setLeftPct(Math.min(68, Math.max(28, next)));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setLeftPct((value) => Math.max(28, value - 2));
            if (event.key === "ArrowRight") setLeftPct((value) => Math.min(68, value + 2));
          }}
        />
        <InspectPane
          dirty={dirty}
          validation={validation}
          revision={revision}
          hash={hash}
          newline={newlineOf(parsedText)}
          note={note}
          ollamaError={ollamaError}
          ollamaNote={ollamaNote}
          suggestions={suggestions}
          rejected={rejected}
          onAccept={(id) => accept([id])}
          onAcceptAll={() => accept(suggestions.map((item) => item.id))}
          onDismiss={(id) => setSuggestions((current) => current.filter((item) => item.id !== id))}
          tab={tab}
          setTab={setTab}
          segments={parsed.segments}
          playback={playback}
          diagnostics={parsed.diagnostics}
          selectedId={selectedId}
          selected={selected}
          visibleCount={visibleCount}
          onMore={() => setVisibleCount((value) => value + 200)}
          onSelect={(segment) => {
            setSelectedId(segment.id);
            focusScript(segment.start, segment.end);
          }}
          onCopyPlayback={() => void copyPlayback()}
          copyState={copyState}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        {mobile === "script" ? (
          <EditorPane
            script={script}
            onChange={setScript}
            onFile={(file) => void readFile(file)}
            onSample={() => loadText(SAMPLE_SCRIPT, "Sample script. It is not your script.")}
            onFixture={() =>
              loadText(buildCoverageFixture(), "Generated 6,667-character test fixture. It is not your script.")
            }
          />
        ) : (
          <InspectPane
            dirty={dirty}
            validation={validation}
            revision={revision}
            hash={hash}
            newline={newlineOf(parsedText)}
            note={note}
            ollamaError={ollamaError}
            ollamaNote={ollamaNote}
            suggestions={suggestions}
            rejected={rejected}
            onAccept={(id) => accept([id])}
            onAcceptAll={() => accept(suggestions.map((item) => item.id))}
            onDismiss={(id) => setSuggestions((current) => current.filter((item) => item.id !== id))}
            tab={tab}
            setTab={setTab}
            segments={parsed.segments}
            playback={playback}
            diagnostics={parsed.diagnostics}
            selectedId={selectedId}
            selected={selected}
            visibleCount={visibleCount}
            onMore={() => setVisibleCount((value) => value + 200)}
            onSelect={(segment) => {
              setSelectedId(segment.id);
              setMobile("script");
              window.setTimeout(() => focusScript(segment.start, segment.end), 0);
            }}
            onCopyPlayback={() => void copyPlayback()}
            copyState={copyState}
          />
        )}
      </div>

      <dialog ref={grammarRef} className="dex-dialog">
        <form method="dialog" className="flex max-h-[80dvh] flex-col">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Parser grammar</h2>
            <p className="mt-1 text-sm text-muted">
              Rules are explicit. Ordinary prose with a colon is not dialogue. Source text is never rewritten.
            </p>
          </div>
          <div className="dex-scroll overflow-auto px-5 py-4 text-sm leading-relaxed text-muted">
            <ul className="flex flex-col gap-2">
              <li>NAME: text — spoken dialogue. One to three name tokens, then a colon.</li>
              <li>ALL CAPS names and Title Case names both count. A single Title Case label such as Note or Remember is narration.</li>
              <li>NAME: [quietly] text — delivery direction. NAME (whispering): text — parenthetical delivery.</li>
              <li>INT. or EXT. location, a dash, then DAY, NIGHT, or another listed time — scene heading.</li>
              <li>TITLE: text, a markdown heading, or a line underlined with equals — title.</li>
              <li>[pause 2s], [SFX: …], [MUSIC: …], [AMBIENCE: …] — cues. Missing units stay pauses and raise a warning.</li>
              <li>Any other bracket is preserved as unknown and counted as not interpreted.</li>
              <li>Blank lines stay blank. The original characters are the source of truth.</li>
            </ul>
            <p className="mt-4 text-xs">
              Ollama is optional, loopback only, and never required. Suggestions do not change the script until you accept them.
            </p>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <button type="submit" className={primary}>
              Close
            </button>
          </div>
        </form>
      </dialog>

      {confirmName ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 md:items-center" role="presentation">
          <div
            role="dialog"
            aria-labelledby="overwrite-title"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="overwrite-title" className="text-lg font-semibold">
              Export again?
            </h2>
            <p className="mt-2 text-sm text-muted">
              {confirmName} was already exported this session. Exporting again may replace that download. The script itself is not modified.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={ghost} onClick={() => setConfirmName(null)}>
                Cancel
              </button>
              <button type="button" className={primary} onClick={() => void exportJson(true)}>
                Export again
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ghost =
  "inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-elevated px-3 text-sm font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";
const primary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-accent px-3 text-sm font-medium text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";
const field =
  "h-11 rounded-sm border border-line bg-inset px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const mobileTab = "h-11 flex-1 text-sm font-medium text-subtle";

function ModeButton({ pressed, onClick, label }: { pressed: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-11 rounded-sm px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        pressed ? "bg-accent text-accent-fg" : "text-muted",
      )}
    >
      {label}
    </button>
  );
}

function EditorPane({
  script,
  onChange,
  onFile,
  onSample,
  onFixture,
}: {
  script: string;
  onChange: (value: string) => void;
  onFile: (file: File) => void;
  onSample: () => void;
  onFixture: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col md:h-full" aria-label="Original script">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2 md:px-4">
        <div>
          <h2 className="text-xs font-medium tracking-wide text-muted">SCRIPT</h2>
          <p className="text-xs text-subtle">ORIGINAL — AUTHORITATIVE</p>
        </div>
        <p className="font-mono text-xs text-subtle tabular-nums">{script.length} characters</p>
      </div>
      <textarea
        data-script="true"
        aria-label="Original script, authoritative"
        value={script}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(event) => onChange(event.target.value)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className="dex-scroll mx-3 mb-2 min-h-0 flex-1 resize-none rounded-md border border-line bg-inset p-3 font-mono text-sm leading-relaxed text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:mx-4"
      />
      <div className="flex flex-wrap gap-2 px-3 pb-3 md:px-4">
        <button type="button" className={ghost} onClick={onSample}>
          Load sample
        </button>
        <button type="button" className={ghost} onClick={onFixture}>
          Load 6,667-character test fixture
        </button>
      </div>
    </section>
  );
}

function InspectPane(props: {
  dirty: boolean;
  validation: ParseOutput["validation"];
  revision: number;
  hash: string;
  newline: string;
  note: string | null;
  ollamaError: string | null;
  ollamaNote: string | null;
  suggestions: Suggestion[];
  rejected: string[];
  onAccept: (id: string) => void;
  onAcceptAll: () => void;
  onDismiss: (id: string) => void;
  tab: "structure" | "playback" | "diagnostics";
  setTab: (tab: "structure" | "playback" | "diagnostics") => void;
  segments: Segment[];
  playback: PlaybackEvent[];
  diagnostics: ParseOutput["diagnostics"];
  selectedId: string | null;
  selected: Segment | null;
  visibleCount: number;
  onMore: () => void;
  onSelect: (segment: Segment) => void;
  onCopyPlayback: () => void;
  copyState: string | null;
}) {
  const verified = !props.dirty && props.validation.status === "verified" && props.validation.sourceChars > 0;
  const partial = !props.dirty && props.validation.status === "partial";
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col md:h-full" aria-label="Parse results">
      <div className="border-b border-line px-3 py-3 md:px-4" aria-live="polite" data-testid="validation-status">
        {props.dirty ? (
          <p className="text-sm text-warn">Source changed since this classification. Parse again. Nothing was rewritten.</p>
        ) : verified ? (
          <p className="flex items-start gap-2 text-sm text-ok">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>every character of the script is classified ({props.validation.classifiedChars})</span>
          </p>
        ) : partial ? (
          <div className="text-sm">
            <p className="flex items-start gap-2 text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {props.validation.classifiedChars} of {props.validation.sourceChars} characters classified
              </span>
            </p>
            <p className="mt-1 pl-6 text-muted">
              {props.validation.unclassifiedChars} preserved but not interpreted
            </p>
          </div>
        ) : props.validation.status === "invalid" ? (
          <p className="text-sm text-danger">Coverage failed. The source text was not modified.</p>
        ) : (
          <p className="text-sm text-muted">Empty script. Paste text to classify it.</p>
        )}
        {props.validation.warningCount > 0 && !props.dirty ? (
          <p className="mt-1 text-xs text-warn">{props.validation.warningCount} warning{props.validation.warningCount === 1 ? "" : "s"}</p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-subtle tabular-nums">
          <div>
            <dt className="text-muted">Revision</dt>
            <dd>{props.revision}</dd>
          </div>
          <div>
            <dt className="text-muted">Newline</dt>
            <dd className="uppercase">{props.newline}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted">SHA-256</dt>
            <dd className="truncate" title={props.hash}>
              {props.hash ? `${props.hash.slice(0, 12)}…${props.hash.slice(-6)}` : "…"}
            </dd>
          </div>
        </dl>
        {props.note ? <p className="mt-2 text-xs text-muted">{props.note}</p> : null}
        {props.copyState ? <p className="mt-1 text-xs text-muted">{props.copyState}</p> : null}
      </div>

      {props.ollamaError ? (
        <p className="border-b border-line px-3 py-2 text-xs text-danger md:px-4">{props.ollamaError}</p>
      ) : null}
      {props.ollamaNote ? (
        <p className="border-b border-line px-3 py-2 text-xs text-muted md:px-4">{props.ollamaNote}</p>
      ) : null}
      {props.suggestions.length > 0 ? (
        <div className="border-b border-line px-3 py-2 md:px-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted">Suggestions, not applied</h3>
            <button type="button" className={ghost} onClick={props.onAcceptAll}>
              Accept all
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {props.suggestions.map((item) => (
              <li key={item.id} className="rounded-sm border border-line bg-inset p-2 text-xs">
                <p className="font-mono text-muted">
                  {item.deterministicKind} → {item.kind}
                </p>
                {item.note ? <p className="mt-1 text-subtle">{item.note}</p> : null}
                <div className="mt-2 flex gap-2">
                  <button type="button" className={primary} onClick={() => props.onAccept(item.id)}>
                    Accept
                  </button>
                  <button type="button" className={ghost} onClick={() => props.onDismiss(item.id)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {props.rejected.length > 0 ? (
            <p className="mt-2 text-xs text-subtle">{props.rejected.length} model response{props.rejected.length === 1 ? "" : "s"} rejected.</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex border-b border-line" role="tablist" aria-label="Result views">
        {(["structure", "playback", "diagnostics"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={props.tab === name}
            className={cn("h-11 flex-1 text-sm capitalize", props.tab === name ? "text-fg" : "text-subtle")}
            onClick={() => props.setTab(name)}
          >
            {name === "structure" ? "Blocks" : name === "playback" ? "Playback" : "Diagnostics"}
          </button>
        ))}
      </div>

      <div className="dex-scroll min-h-0 flex-1 overflow-auto">
        {props.tab === "structure" ? (
          <div>
            {props.selected ? <Properties segment={props.selected} /> : null}
            <ul>
              {props.segments.slice(0, props.visibleCount).map((segment) => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  selectedId={props.selectedId}
                  onSelect={props.onSelect}
                />
              ))}
            </ul>
            {props.segments.length > props.visibleCount ? (
              <button type="button" className={cn(ghost, "m-3")} onClick={props.onMore}>
                Show more
              </button>
            ) : null}
          </div>
        ) : null}
        {props.tab === "playback" ? (
          <div className="px-3 py-3 md:px-4">
            <div className="mb-3 flex justify-end">
              <button type="button" className={ghost} onClick={props.onCopyPlayback}>
                Copy playback
              </button>
            </div>
            <ol className="flex flex-col gap-2">
              {props.playback.slice(0, props.visibleCount).map((event) => (
                <li key={event.id} className="dex-row rounded-sm border border-line bg-inset px-3 py-2">
                  <p className="text-xs text-subtle">
                    {KIND_LABEL[event.kind]} · L{event.line}
                    {event.speaker ? ` · ${event.speaker}` : ""}
                    {event.delivery ? ` · ${event.delivery}` : ""}
                    {event.durationMs != null ? ` · ${event.durationMs} ms` : ""}
                  </p>
                  <p className="mt-1 font-mono text-sm whitespace-pre-wrap">{event.text}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {props.tab === "diagnostics" ? (
          <ul className="px-3 py-3 md:px-4">
            {props.diagnostics.length === 0 ? (
              <li className="text-sm text-muted">No warnings. Coverage is exact for the last parse.</li>
            ) : (
              props.diagnostics.map((item, index) => (
                <li key={`${item.code}-${index}`} className="border-b border-line py-3 text-sm">
                  <p className={cn(item.severity === "error" ? "text-danger" : item.severity === "warning" ? "text-warn" : "text-muted")}>
                    {item.message}
                  </p>
                  <p className="mt-1 font-mono text-xs text-subtle">
                    {item.code}
                    {item.segmentId ? ` · ${item.segmentId}` : ""}
                  </p>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function SegmentRow({
  segment,
  selectedId,
  onSelect,
  nested,
}: {
  segment: Segment;
  selectedId: string | null;
  onSelect: (segment: Segment) => void;
  nested?: boolean;
}) {
  const selected = segment.id === selectedId;
  return (
    <>
      <li className="dex-row">
        <button
          type="button"
          onClick={() => onSelect(segment)}
          className={cn(
            "flex w-full flex-col gap-1 border-b border-line py-2 text-left md:pr-4",
            nested ? "pr-3 pl-8" : "px-3 md:px-4",
            selected ? "bg-elevated" : "hover:bg-surface",
          )}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("text-xs font-medium", segment.kind === "unknown" || segment.kind === "ambiguous" ? "text-danger" : "text-muted")}>
              {KIND_LABEL[segment.kind]}
              {segment.speaker ? ` · ${segment.speaker}` : ""}
              {segment.origin === "ollama-accepted" ? " · accepted" : ""}
            </span>
            <span className="font-mono text-xs text-subtle tabular-nums">
              L{segment.line}:{segment.column}
            </span>
          </span>
          <span className="truncate font-mono text-xs text-fg">{segment.raw.replace(/\s+/g, " ").trim() || "blank"}</span>
        </button>
      </li>
      {segment.children?.map((child) => (
        <SegmentRow key={child.id} segment={child} selectedId={selectedId} onSelect={onSelect} nested />
      ))}
    </>
  );
}

function Properties({ segment }: { segment: Segment }) {
  const rows: Array<[string, string | undefined]> = [
    ["Id", segment.id],
    ["Kind", KIND_LABEL[segment.kind]],
    ["Speaker", segment.speaker],
    ["Delivery", segment.delivery],
    ["Cue", segment.cueType],
    ["Duration", segment.durationMs != null ? `${segment.durationMs} ms` : undefined],
    ["Location", segment.location],
    ["Time", segment.timeOfDay],
    ["Detail", segment.detail],
    ["Range", `${segment.start}–${segment.end}`],
    ["Origin", segment.origin],
  ];
  return (
    <div className="border-b border-line bg-surface px-3 py-3 md:px-4">
      <h3 className="text-xs font-medium text-muted">Properties</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows
          .filter((row) => row[1])
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-subtle">{label}</dt>
              <dd className="truncate font-mono text-fg" title={value}>
                {value}
              </dd>
            </div>
          ))}
      </dl>
      <pre className="mt-2 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">{segment.raw}</pre>
    </div>
  );
}

function findSegment(segments: Segment[], id: string | null): Segment | null {
  if (!id) return null;
  for (const segment of segments) {
    if (segment.id === id) return segment;
    for (const child of segment.children ?? []) if (child.id === id) return child;
  }
  return null;
}

function newlineOf(text: string): string {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\r" && text[i + 1] === "\n") {
      crlf += 1;
      i += 1;
    } else if (text[i] === "\n") lf += 1;
    else if (text[i] === "\r") cr += 1;
  }
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (crlf) return "crlf";
  if (cr) return "cr";
  return "lf";
}
