import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LayoutDashboard, Trophy, Settings, UserCheck, Database, Users, Vote, Stamp, ScrollText, UserCog, Activity, FileSearch, ShieldAlert, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth, ROLE_HOME } from "@/context/AuthContext";
import { Logo, LogoutButton, SideLink, DEV_CREDIT } from "@/components/vs/Layout";
import { Loading, StatusBadge } from "@/components/vs/common";

const NAV = {
  student: [["/app/student", "Dashboard", LayoutDashboard], ["/app/results", "Results", Trophy]],
  admin: [["/app/admin", "Dashboard", LayoutDashboard], ["/app/admin/verification", "Student verification", UserCheck], ["/app/admin/registry", "Registry", Database],
    ["/app/admin/students", "Students", Users], ["/app/admin/elections", "Elections", Vote], ["/app/admin/approvals", "Approvals", Stamp],
    ["/app/admin/security", "Security center", ShieldAlert], ["/app/audit", "Audit logs", ScrollText], ["/app/admin/users", "Staff accounts", UserCog]],
  auditor: [["/app/auditor", "Dashboard", LayoutDashboard], ["/app/audit", "Audit logs", ScrollText], ["/app/auditor/results", "Reconciliation", FileSearch]],
  operator: [["/app/ops", "System status", Activity]],
};
const ROLE_LABEL = { student: "Student voter", admin: "Election administrator", auditor: "Election auditor", operator: "System operator" };

export function RequireAuth({ roles, allowPasswordChange }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <Loading label="Checking session…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (user.must_change_password && !allowPasswordChange) return <Navigate to="/app/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={ROLE_HOME[user.role]} replace />;
  return <Outlet />;
}

function SideNav({ items, onNavigate }) {
  return (
    <div className="flex h-full flex-col justify-between bg-navy p-4">
      <div>
        <div className="mb-8 px-2 pt-1"><Logo light /></div>
        <nav className="space-y-1" aria-label="Main">
          {items.map(([to, label, icon]) => <SideLink key={to} to={to} label={label} icon={icon} end={to.split("/").length <= 3} onClick={onNavigate} />)}
        </nav>
      </div>
      <p className="px-2 text-[11px] leading-relaxed text-slate-400" data-testid="app-developer-credit">{DEV_CREDIT}</p>
    </div>
  );
}

export default function AppShell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const items = [...(NAV[user.role] || []), ["/app/settings", "Settings", Settings]];
  const display = user.student?.full_name || user.name || user.email;
  const initials = display.split(/[\s@]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 md:block"><SideNav items={items} /></aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SideNav items={items} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-xl lg:px-8">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation" data-testid="app-mobile-nav-btn"><Menu /></Button>
            <span className="md:hidden"><Logo to={ROLE_HOME[user.role]} /></span>
          </div>
          <div className="flex items-center gap-3">
            {user.student && <StatusBadge status={user.student.verification_status} testId="header-verification-badge" />}
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-navy" data-testid="session-user-name">{display}</div>
              <div className="text-xs text-slate-500" data-testid="session-user-role">{ROLE_LABEL[user.role]}</div>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-navy text-xs font-semibold text-white" aria-hidden>{initials}</span>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl vs-rise"><Outlet /></div>
        </main>
        <p className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">{DEV_CREDIT}</p>
      </div>
    </div>
  );
}
