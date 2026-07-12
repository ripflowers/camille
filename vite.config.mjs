import { defineConfig } from "vite";
import { handleEdgeTtsNodeRequest } from "./src/server/edge-tts.mjs";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  plugins: [
    {
      name: "enstudy-edge-tts-dev-api",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url || "/", "http://127.0.0.1");
          if (url.pathname !== "/api/tts/edge" && url.pathname !== "/v1/audio/speech") {
            next();
            return;
          }
          void handleEdgeTtsNodeRequest(request, response).catch(next);
        });
      },
    },
  ],
});
