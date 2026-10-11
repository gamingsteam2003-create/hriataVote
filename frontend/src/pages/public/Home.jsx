import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, KeyRound, Fingerprint, Link2, Scale, UserPlus, BadgeCheck, Vote, FileCheck2, CalendarClock, Lock, Eye, Users, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, fmt } from "@/lib/api";
import { EmptyState, StatusBadge } from "@/components/vs/common";

const TRUST = [
  [Users, "Verified students", "Only registry-verified students can participate"],
  [Lock, "Secure & private", "Ballots are stored without voter identity"],
  [Eye, "Transparent process", "Hash-linked, tamper-evident audit records"],
  [FileCheck2, "Trusted results", "Reconciled before they are finalized"],
];
const PILLARS = [
  [KeyRound, "Argon2id credentials & server sessions", "Passwords are hashed with Argon2id. Sessions are held on the server in HttpOnly cookies with CSRF protection, throttling and rotation."],
  [Fingerprint, "Registry-backed verification", "Student identity is compared with a registry imported by an authorised college representative and approved by an administrator."],
  [Vote, "One accepted ballot per voter", "A database uniqueness constraint, not the browser, prevents a second ballot, including concurrent or retried submissions."],
  [Link2, "Hash-linked audit trail", "Administrative actions are written to a SHA-256 hash-chained log with HMAC-signed external checkpoints that auditors can verify."],
  [Scale, "Reconciled, controlled results", "Results are counted on the server only after closing, reconciled against participation records and finalized once, optionally with two-person approval."],
  [ShieldCheck, "Honest about limitations", "VoteSecure is a controlled college-election application, not an end-to-end verifiable voting protocol. The privacy page explains what that means."],
];
const STEPS = [
  [UserPlus, "Register", "Create an account with your college registration number, department and semester."],
  [BadgeCheck, "Get verified", "Your details are compared with the official registry and reviewed by an election administrator."],
  [Vote, "Vote once", "When an election you are eligible for is open, review your ballot and submit it. The server confirms acceptance."],
  [FileCheck2, "See results", "After reconciliation and finalization, results are published according to each election's disclosure policy."],
];

function ElectionCards() {
  const { data, isLoading } = useQuery({ queryKey: ["public-elections"], queryFn: async () => (await api.get("/public/elections")).data.items });
  if (isLoading) return <p className="text-sm text-slate-500">Loading elections…</p>;
  if (!data?.length) return <EmptyState icon={CalendarClock} title="No elections have been scheduled." testId="home-elections-empty">Scheduled and active elections will appear here once administrators publish them.</EmptyState>;
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-election-list">
      {data.map((e) => (
        <article key={e.id} className="vs-card p-5 transition-shadow hover:shadow-md" data-testid={`home-election-${e.id}`}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-navy">{e.title}</h3>
            <StatusBadge status={e.state} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{e.academic_year} · {e.scope === "college" ? "College-wide" : e.departments.join(", ")}</p>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600"><CalendarClock className="h-4 w-4 text-slate-400" /> {fmt(e.opens_at)} – {fmt(e.closes_at)}</p>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div>
      <section className="px-4 pt-6 sm:px-6">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-2xl bg-navy shadow-xl">
          <img src="/images/campus-building.jpg" alt="ICFAI University Mizoram campus building illuminated at night" className="absolute inset-0 h-full w-full object-cover object-center sm:object-right" />
          <div className="absolute inset-0 bg-gradient-to-b from-navy/90 via-navy/65 to-navy/40 sm:bg-gradient-to-r sm:from-navy sm:via-navy/85 sm:to-navy/20" aria-hidden />
          <div className="relative max-w-2xl px-8 py-20 sm:px-12 lg:py-28 vs-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-cyan-200 backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" /> Secure Online College Election Management
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">Secure Elections.<br />Trusted Results.</h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-200">
              VoteSecure verifies students against an official registry, runs elections through a strict server-enforced lifecycle, accepts exactly one ballot per eligible voter, and publishes reconciled results with a verifiable audit trail.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" data-testid="hero-register-btn"><Link to="/register">Get started</Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="hero-login-btn"><Link to="/login">Sign in</Link></Button>
            </div>
          </div>
        </div>
        <div className="relative mx-auto -mt-8 grid max-w-6xl gap-4 px-2 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map(([Icon, t, d]) => (
            <div key={t} className="vs-card flex items-start gap-3 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-50"><Icon className="h-5 w-5 text-sky-600" /></span>
              <div><p className="text-sm font-semibold text-navy">{t}</p><p className="text-xs text-slate-500">{d}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section id="elections" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-20">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold text-navy sm:text-3xl">Upcoming &amp; recent elections</h2>
          <Link to="/results" className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:underline" data-testid="home-results-link">Published results <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <ElectionCards />
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <h2 className="text-2xl font-bold text-navy sm:text-3xl">How it works for students</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-4">
            {STEPS.map(([Icon, t, d], i) => (
              <li key={t}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-navy text-white"><Icon className="h-5 w-5" /></span>
                <p className="mt-4 text-xs font-semibold text-sky-600">Step {i + 1}</p>
                <h3 className="mt-1 font-semibold text-navy">{t}</h3>
                <p className="mt-1.5 text-sm text-slate-500">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">Security and privacy, described accurately</h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-500">Database-backed ballot privacy safeguards with clearly documented limits. <Link to="/privacy" className="font-medium text-sky-600 hover:underline">Read the details.</Link></p>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(([Icon, t, d], i) => (
            <div key={t} className="vs-card p-6 transition-shadow hover:shadow-md vs-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50"><Icon className="h-5 w-5 text-sky-600" /></span>
              <h3 className="mt-4 font-semibold text-navy">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
