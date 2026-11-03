export const DEXDIFFUSION_DEFAULT_URL: string;
export interface DexDiffusionRequest {
  title?: string;
  script: string;
  mode: "deterministic";
  settings: { narrator_name: string };
}
export function dexDiffusionRequest(script: string, options?: { title?: string; narrator?: string }): DexDiffusionRequest;
export function scriptFromJson(
  json: unknown,
): { text: string; from: string; title?: string; narrator?: string } | null;
export function assertDexDiffusionUrl(raw: string, options?: { allowAnyHost?: boolean }): string;
export function dexDiffusionHeaders(origin: string): Record<string, string>;
