import { n as parseDocument } from "./routes-Dh4IA_PA.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/parse-off-thread-pvI5ZKF9.js
/**
* Yields a frame, then parses off the UI thread when Worker is available.
* Falls back to the same deterministic parser on the main thread.
*/
function parseOffThread(source) {
	return new Promise((resolve, reject) => {
		const runInline = () => {
			try {
				resolve(parseDocument(source));
			} catch (error) {
				reject(error instanceof Error ? error : /* @__PURE__ */ new Error("Parse failed."));
			}
		};
		if (typeof Worker === "undefined" || typeof window === "undefined") {
			setTimeout(runInline, 0);
			return;
		}
		let worker;
		try {
			worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
		} catch {
			setTimeout(runInline, 0);
			return;
		}
		const timer = setTimeout(() => {
			worker.terminate();
			runInline();
		}, 3e4);
		worker.onmessage = (event) => {
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
//#endregion
export { parseOffThread };
