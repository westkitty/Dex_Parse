import { parseDocument } from "./parser.ts";
import type { ParseOutput } from "./types.ts";

/**
 * Yields a frame, then parses off the UI thread when Worker is available.
 * Falls back to the same deterministic parser on the main thread.
 */
export function parseOffThread(source: string): Promise<ParseOutput> {
  return new Promise((resolve, reject) => {
    const runInline = () => {
      try {
        resolve(parseDocument(source));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Parse failed."));
      }
    };

    if (typeof Worker === "undefined" || typeof window === "undefined") {
      setTimeout(runInline, 0);
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
    } catch {
      setTimeout(runInline, 0);
      return;
    }

    const timer = setTimeout(() => {
      worker.terminate();
      runInline();
    }, 30_000);

    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: ParseOutput; error?: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data?.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data?.error || "Parse worker failed."));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      runInline();
    };
    worker.postMessage({ source });
  });
}
