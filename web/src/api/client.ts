import { hc } from "hono/client";
import type { AppType } from "@coc/server/routes/app.js";

// dev: Vite proxies /api -> http://localhost:8787
export const api = hc<AppType>("/api");
