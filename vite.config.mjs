import { defineConfig } from "vite";
import { handleEdgeTtsNodeRequest } from "./src/server/edge-tts.mjs";
import { handleUserApiRequest } from "./src/server/users-api.mjs";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  plugins: [
    {
      name: "enstudy-dev-api",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          void (async () => {
            const url = new URL(request.url || "/", "http://127.0.0.1");
            if (await handleUserApiRequest(request, response, url)) return;
            if (url.pathname === "/api/tts/edge" || url.pathname === "/v1/audio/speech") {
              await handleEdgeTtsNodeRequest(request, response);
              return;
            }
            next();
          })().catch(next);
        });
      },
    },
  ],
});
