import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.js";
import { DashboardPage } from "./routes/dashboard.js";
import { LeaksPage } from "./routes/leaks.js";

const rootRoute = createRootRoute({ component: () => (<AppShell><Outlet /></AppShell>) });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: DashboardPage });
const leaksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/leaks", component: LeaksPage });

const routeTree = rootRoute.addChildren([dashboardRoute, leaksRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
