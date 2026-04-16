#!/usr/bin/env node

const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cwd = path.resolve(__dirname, "..");
const port = String(process.env.PORT || "3000");
const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
const requestedRuntime = String(
  process.env.FRONTEND_RUNTIME || process.env.NODE_ENV || "development"
).toLowerCase();

let runtime = requestedRuntime === "production" ? "production" : "development";

const buildIdPath = path.join(cwd, ".next", "BUILD_ID");
if (runtime === "production" && !existsSync(buildIdPath)) {
  console.warn("[frontend] Production runtime was requested but .next/BUILD_ID is missing.");
  console.warn("[frontend] Falling back to `next dev` so errors stay readable and chunks rebuild on demand.");
  console.warn("[frontend] Run `npm run build` before production starts, or use `pm2 start ecosystem.config.js --env production` after a build.");
  runtime = "development";
}

const args = runtime === "production"
  ? ["start", "--hostname", "0.0.0.0", "--port", port]
  : ["dev", "--hostname", "0.0.0.0", "--port", port];

const childEnv = {
  ...process.env,
  NODE_ENV: runtime,
  NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
};

console.warn(`[frontend] Starting Next.js in ${runtime} mode on port ${port}.`);
if (runtime === "development") {
  console.warn("[frontend] Full React/Next error overlays and unminified stack traces should now be available.");
  console.warn("[frontend] If chunk errors persist, hard-refresh the browser or clear stale /_next assets.");
} else {
  console.warn("[frontend] Production runtime enabled. Browser stacks may be minified unless source maps are built.");
}

const child = spawn(process.execPath, [nextBin, ...args], {
  cwd,
  env: childEnv,
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
  process.on(signal, () => forwardSignal(signal));
});

child.on("error", (error) => {
  console.error("[frontend] Failed to launch Next.js runtime.");
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
