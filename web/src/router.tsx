import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { DashboardPage } from "./routes/dashboard.js";
import { LeaksPage } from "./routes/leaks.js";
import { GamesPage } from "./routes/games.js";
import { ReviewPage } from "./routes/review.js";
import { StudyPage } from "./routes/study.js";
import { TreePage } from "./routes/tree.js";
import { DrillPage } from "./routes/drill.js";

const rootRoute = createRootRoute({ component: () => (<AppShell><Outlet /></AppShell>) });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const leaksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/leaks", component: LeaksPage });
const gamesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/games", component: GamesPage });
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/games/$id", component: ReviewPage,
  validateSearch: (s: Record<string, unknown>): { ply?: number } => {
    const ply = Number(s.ply);
    return Number.isFinite(ply) ? { ply } : {};
  },
});
const studyRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/study", component: StudyPage,
  validateSearch: (s: Record<string, unknown>): { epd?: string; source?: "masters" | "rating" } => {
    const epd = typeof s.epd === "string" ? s.epd : undefined;
    const source = s.source === "rating" ? "rating" : s.source === "masters" ? "masters" : undefined;
    return { ...(epd ? { epd } : {}), ...(source ? { source } : {}) };
  },
});

const treeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tree", component: TreePage });

const drillRoute = createRoute({
  getParentRoute: () => rootRoute, path: "/drill", component: DrillPage,
  validateSearch: (s: Record<string, unknown>): { epd?: string; color?: "white" | "black"; source?: "masters" | "rating" } => {
    const epd = typeof s.epd === "string" ? s.epd : undefined;
    const color = s.color === "black" ? "black" : s.color === "white" ? "white" : undefined;
    const source = s.source === "rating" ? "rating" : s.source === "masters" ? "masters" : undefined;
    return { ...(epd ? { epd } : {}), ...(color ? { color } : {}), ...(source ? { source } : {}) };
  },
});

const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute, studyRoute, treeRoute, drillRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
