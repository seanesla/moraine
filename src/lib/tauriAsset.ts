import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Resolve a repo-relative resource path to a URL the webview can load.
 *
 * In a packaged Tauri build, `convertFileSrc` returns an asset://localhost/...
 * URL for the path inside the bundle's resource dir (populated via
 * tauri.conf.json's `bundle.resources`). In dev, Vite serves files from
 * `public/` at the root; resources outside `public/` are not served, so
 * callers that need dev access must also put copies under `public/` or
 * handle the load failure gracefully.
 */
export function tauriAssetUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return convertFileSrc(clean);
  }
  return `/${clean}`;
}
