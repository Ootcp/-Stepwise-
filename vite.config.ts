import { defineConfig, type Plugin } from "vite";
import { createApiHandler } from "./server/api.ts";

/**
 * Mounts the `/api/*` proxy inside the Vite dev and preview servers. Keeping it a plugin
 * means `npm run dev` is the only process needed, and the API key never reaches the browser.
 */
function shijiApi(): Plugin {
	const handler = createApiHandler();
	return {
		name: "shiji-api",
		configureServer(server) {
			server.middlewares.use(handler);
		},
		configurePreviewServer(server) {
			server.middlewares.use(handler);
		},
	};
}

export default defineConfig({
	root: "web",
	plugins: [shijiApi()],
	server: { port: 5173, strictPort: true },
	preview: { port: 4173, strictPort: true },
	build: { outDir: "../dist", emptyOutDir: true },
});