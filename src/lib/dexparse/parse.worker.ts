import { parseDocument } from "./parser.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ source: string }>) => void) | null;
  postMessage: (data: unknown) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const result = parseDocument(event.data.source);
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Parse failed.",
    });
  }
};
