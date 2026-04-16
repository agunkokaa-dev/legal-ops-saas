module.exports = {
  apps: [
    {
      name: "frontend",
      cwd: __dirname,
      script: "scripts/run-next-runtime.js",
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        FRONTEND_RUNTIME: "development",
        NODE_ENV: "development",
        PORT: process.env.PORT || 3000,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_FRONTEND_DIAGNOSTICS: "1",
        FRONTEND_DEBUG_SOURCEMAPS: "1",
      },
      env_production: {
        FRONTEND_RUNTIME: "production",
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_FRONTEND_DIAGNOSTICS: "1",
      },
    },
  ],
};
