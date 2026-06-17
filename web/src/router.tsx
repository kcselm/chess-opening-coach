import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { DashboardPage } from "./routes/dashboard.js";
import { LeaksPage } from "./routes/leaks.js";
import { GamesPage } from "./routes/games.js";
import { ReviewPage } from "./routes/review.js";

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

const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute, gamesRoute, reviewRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
