import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

/** Vite base ("/" locally, "/Dex_Parse/" on GitHub Pages). Always ends with "/". */
const BASE = import.meta.env.BASE_URL;

const APP_NAME = "DexParse";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Offline script parser. Deterministic classification, local validation, optional loopback model.",
      },
      { name: "theme-color", content: "#0c0e11" },
      { name: "color-scheme", content: "dark" },
      { name: "application-name", content: APP_NAME },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: `${BASE}favicon.svg` },
      { rel: "icon", type: "image/png", sizes: "192x192", href: `${BASE}icons/icon-192.png` },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: `${BASE}manifest.webmanifest` },
      { rel: "apple-touch-icon", sizes: "180x180", href: `${BASE}icons/apple-touch-icon.png` },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
