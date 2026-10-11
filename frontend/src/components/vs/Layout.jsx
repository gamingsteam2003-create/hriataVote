import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ShieldCheck, Menu, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth, ROLE_HOME } from "@/context/AuthContext";

export const DEV_CREDIT = "Built and developed by Hriata_khuptong";

export const Logo = ({ to = "/", light }) => (
  <Link to={to} className="flex items-center gap-2.5" data-testid="brand-logo">
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-400 shadow-sm">
      <ShieldCheck className="h-5 w-5 text-white" aria-hidden />
    </span>
    <span className={`text-lg font-bold tracking-tight ${light ? "text-white" : "text-navy"}`}>VoteSecure</span>
  </Link>
);

export const Footer = () => (
  <footer className="border-t border-slate-200 bg-white py-8">
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-slate-500 sm:flex-row">
      <Logo />
      <nav className="flex gap-6">
        <Link to="/privacy" className="hover:text-sky-600" data-testid="footer-privacy-link">Privacy &amp; rules</Link>
        <Link to="/results" className="hover:text-sky-600" data-testid="footer-results-link">Results</Link>
      </nav>
      <span data-testid="developer-credit">Built and developed by <span className="font-semibold text-navy">Hriata_khuptong</span></span>
    </div>
  </footer>
);

const links = [
  { to: "/", label: "Home" },
  { to: "/#elections", label: "Elections" },
  { to: "/#how-it-works", label: "How it works" },
  { to: "/results", label: "Results" },
  { to: "/privacy", label: "Privacy & rules" },
];

export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = links.map((l) => (
    <a key={l.to} href={l.to} onClick={() => setOpen(false)} className="text-sm font-medium text-slate-600 transition-colors hover:text-sky-600" data-testid={`nav-${l.label.split(" ")[0].toLowerCase()}`}>{l.label}</a>
  ));
  const cta = user ? (
    <Button asChild data-testid="nav-dashboard-btn"><Link to={ROLE_HOME[user.role]} onClick={() => setOpen(false)}>Open dashboard</Link></Button>
  ) : (
    <>
      <Button asChild variant="outline" data-testid="nav-login-btn"><Link to="/login" onClick={() => setOpen(false)}>Login</Link></Button>
      <Button asChild data-testid="nav-register-btn"><Link to="/register" onClick={() => setOpen(false)}>Register</Link></Button>
    </>
  );
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Logo />
          <nav className="hidden items-center gap-7 lg:flex">{nav}</nav>
          <div className="hidden items-center gap-2 lg:flex">{cta}</div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="mobile-menu-btn"><Menu /></Button>
        </div>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-5 bg-white pt-12">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {nav}
          <div className="flex flex-col gap-2">{cta}</div>
        </SheetContent>
      </Sheet>
      <main className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  );
}

export function LogoutButton() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Button variant="ghost" size="sm" onClick={async () => { await logout(); navigate("/login"); }} data-testid="logout-btn">
      <LogOut className="mr-2 h-4 w-4" /> Sign out
    </Button>
  );
}

export const SideLink = ({ to, label, icon: Icon, onClick, end }) => (
  <NavLink to={to} end={end} onClick={onClick} data-testid={`sidenav-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? "bg-sky-500/20 font-semibold text-white ring-1 ring-sky-400/30" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
    <Icon className="h-4 w-4" aria-hidden /> {label}
  </NavLink>
);
