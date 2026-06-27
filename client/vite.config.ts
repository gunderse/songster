import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const clientPort = Number(process.env.SONGSTER_CLIENT_PORT ?? 4337);
const serverPort = Number(process.env.SONGSTER_SERVER_PORT ?? process.env.PORT ?? 4338);
const proxyTarget = `http://127.0.0.1:${serverPort}`;

// Paths the client should hand off to the Node server (snippets, themed assets, voice, sockets).
const proxiedPaths = [
  "/healthz",
  "/api",
  "/audio",
  "/music",
  "/backgrounds",
  "/reveal-audio",
  "/showcase",
  "/sounds",
  "/effects",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so phones on the LAN can reach the dev client.
    host: process.env.SONGSTER_BIND_HOST?.trim() || true,
    allowedHosts: true,
    port: clientPort,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(proxiedPaths.map((path) => [path, { target: proxyTarget }])),
      "/socket.io": { target: proxyTarget, ws: true },
    },
  },
});
