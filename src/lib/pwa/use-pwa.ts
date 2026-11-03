import { useCallback, useEffect, useRef, useState } from "react";
import { previewPathPrefix } from "../preview-path-prefix.ts";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaState {
  /** The browser is offline. Parsing still works; DexParse never needs the network. */
  offline: boolean;
  /** A newer DexParse is downloaded and waiting. */
  updateReady: boolean;
  /** The browser offered an install prompt (Chrome/Edge). */
  canInstall: boolean;
  /** Running as an installed app window. */
  installed: boolean;
  /** Service worker controls this page, so a reload works offline. */
  offlineReady: boolean;
  install: () => Promise<void>;
  applyUpdate: () => void;
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Register <base>sw.js in production builds only, and never inside path-prefixed preview hosts. */
export function shouldRegisterServiceWorker(env: {
  prod: boolean;
  hasServiceWorker: boolean;
  secure: boolean;
  hostname: string;
  pathname: string;
}): boolean {
  if (!env.prod || !env.hasServiceWorker || !env.secure) return false;
  return !previewPathPrefix(env.hostname, env.pathname);
}

export function usePwa(): PwaState {
  const [offline, setOffline] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const waiting = useRef<ServiceWorker | null>(null);
  const promptEvent = useRef<BeforeInstallPromptEvent | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const standalone = window.matchMedia?.("(display-mode: standalone)");
    setInstalled(Boolean(standalone?.matches) || (navigator as { standalone?: boolean }).standalone === true);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptEvent.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      promptEvent.current = null;
      setCanInstall(false);
      setInstalled(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let timer: number | undefined;
    let onVisible: (() => void) | undefined;
    if (
      shouldRegisterServiceWorker({
        prod: import.meta.env.PROD,
        hasServiceWorker: "serviceWorker" in navigator,
        secure: window.isSecureContext,
        hostname: window.location.hostname,
        pathname: window.location.pathname,
      })
    ) {
      const sw = navigator.serviceWorker;
      const markWaiting = (worker: ServiceWorker | null) => {
        if (worker && sw.controller) {
          waiting.current = worker;
          setUpdateReady(true);
        }
      };
      sw.addEventListener("controllerchange", () => {
        setOfflineReady(true);
        if (reloading.current) window.location.reload();
      });
      sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .then((registration) => {
          if (sw.controller) setOfflineReady(true);
          void sw.ready.then(() => {
            if (sw.controller) setOfflineReady(true);
          });
          markWaiting(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed") markWaiting(worker);
            });
          });
          const check = () => void registration.update().catch(() => {});
          timer = window.setInterval(check, UPDATE_CHECK_MS);
          onVisible = () => {
            if (document.visibilityState === "visible" && navigator.onLine) check();
          };
          document.addEventListener("visibilitychange", onVisible);
        })
        .catch(() => {
          /* the app works without a worker; it just will not load offline */
        });
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) window.clearInterval(timer);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const install = useCallback(async () => {
    const event = promptEvent.current;
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => null);
    promptEvent.current = null;
    setCanInstall(false);
  }, []);

  const applyUpdate = useCallback(() => {
    const worker = waiting.current;
    if (!worker) {
      window.location.reload();
      return;
    }
    reloading.current = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return { offline, updateReady, canInstall, installed, offlineReady, install, applyUpdate };
}
