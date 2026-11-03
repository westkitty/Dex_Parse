import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldRegisterServiceWorker } from "./use-pwa.ts";

const base = { prod: true, hasServiceWorker: true, secure: true, hostname: "127.0.0.1", pathname: "/" };

describe("shouldRegisterServiceWorker", () => {
  it("registers in a secure production page", () => {
    assert.equal(shouldRegisterServiceWorker(base), true);
  });
  it("never registers in dev, without support, or on an insecure origin", () => {
    assert.equal(shouldRegisterServiceWorker({ ...base, prod: false }), false);
    assert.equal(shouldRegisterServiceWorker({ ...base, hasServiceWorker: false }), false);
    assert.equal(shouldRegisterServiceWorker({ ...base, secure: false }), false);
  });
  it("skips path-prefixed preview hosts where /sw.js is not the app's", () => {
    assert.equal(shouldRegisterServiceWorker({ ...base, hostname: "preview.grok.mil", pathname: "/hds-abc-3000-xy/" }), false);
  });
});
