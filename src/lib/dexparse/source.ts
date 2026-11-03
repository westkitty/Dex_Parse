import type { NewlineStyle } from "./types.ts";

export function detectNewline(text: string): NewlineStyle {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\r" && text[i + 1] === "\n") {
      crlf += 1;
      i += 1;
    } else if (ch === "\n") lf += 1;
    else if (ch === "\r") cr += 1;
  }
  const kinds = [crlf, lf, cr].filter((n) => n > 0).length;
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (crlf) return "crlf";
  if (cr) return "cr";
  return "lf";
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function assertLoopbackUrl(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Endpoint is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https loopback endpoints are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Credentials in the endpoint URL are not allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(
      "Only verified loopback endpoints are allowed (localhost, 127.0.0.1, or ::1). Scripts are never sent to a cloud model.",
    );
  }
  return url;
}
