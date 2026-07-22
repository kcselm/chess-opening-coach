import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/leaks", label: "Leaks" },
  { to: "/games", label: "Games" },
  { to: "/tree", label: "Tree" },
  { to: "/study", label: "Study" },
  { to: "/drill", label: "Drill" },
  { to: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ width: 180, background: "#1e1e28", color: "#ddd", padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>&#9823; Opening Coach</div>
        {NAV.map((n) => (
          <div key={n.to} style={{ margin: "8px 0" }}>
            <Link to={n.to} style={{ color: "#ddd", textDecoration: "none" }}>{n.label}</Link>
          </div>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  );
}
