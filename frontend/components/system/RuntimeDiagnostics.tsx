"use client";

import { useEffect } from "react";

const CHUNK_PATH_FRAGMENT = "/_next/static/chunks/";

function extractMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

function logDiagnostic(title: string, lines: string[], error?: unknown) {
  console.warn(`[frontend diagnostics] ${title}`);
  for (const line of lines) {
    console.warn(`[frontend diagnostics] ${line}`);
  }
  if (error) {
    console.error(error);
  }
}

export default function RuntimeDiagnostics() {
  useEffect(() => {
    const seen = new Set<string>();

    const warnOnce = (key: string, title: string, lines: string[], error?: unknown) => {
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      logDiagnostic(title, lines, error);
    };

    if (process.env.NODE_ENV === "development") {
      console.info("[frontend diagnostics] Development runtime active. Full Next.js overlays and unminified stack traces should be available.");
    } else {
      console.warn("[frontend diagnostics] Production runtime active. Browser errors may be minified unless source maps were built.");
    }

    const handleChunkWarning = (detail: string, error?: unknown) => {
      warnOnce(
        `chunk:${detail}`,
        "Detected a stale or failed Next.js chunk load.",
        [
          "The browser requested a JavaScript file under /_next/static/chunks/ that the server could not serve.",
          "Hard-refresh the page first.",
          "If this is local development, restart the frontend in development mode so chunks rebuild on demand.",
          "If it still fails, remove `.next` and restart the frontend to clear stale build artifacts.",
        ],
        error,
      );
    };

    const handleServerActionWarning = (detail: string, error?: unknown) => {
      warnOnce(
        `server-action:${detail}`,
        "Detected a server action manifest mismatch.",
        [
          "The browser tab is likely using HTML from an older or newer build than the running server.",
          "Hard-refresh the page to reload the latest action manifest.",
          "If this is local development, restart the frontend after switching runtimes or rebuilding.",
        ],
        error,
      );
    };

    const onError = (event: ErrorEvent) => {
      const scriptTarget = event.target instanceof HTMLScriptElement ? event.target : null;
      const scriptSrc = scriptTarget?.src || "";
      const message = extractMessage(event.error) || String(event.message || "");

      if (
        message.includes("ChunkLoadError")
        || message.includes("Failed to load chunk")
        || scriptSrc.includes(CHUNK_PATH_FRAGMENT)
      ) {
        handleChunkWarning(message || scriptSrc, event.error || event.message);
      }

      if (message.includes("Failed to find Server Action")) {
        handleServerActionWarning(message, event.error || event.message);
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = extractMessage(event.reason);

      if (message.includes("ChunkLoadError") || message.includes("Failed to load chunk")) {
        handleChunkWarning(message, event.reason);
      }

      if (message.includes("Failed to find Server Action")) {
        handleServerActionWarning(message, event.reason);
      }
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
