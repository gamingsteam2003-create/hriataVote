import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, Clock, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, fmt } from "@/lib/api";
import { EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/vs/common";

const STATUS_COPY = {
  pending: "Your details were not found in the official registry yet. An administrator will review your request once the registry is updated.",
  under_review: "Your registration is awaiting review by an election administrator.",
  verified: "Your student identity is verified. You can vote in elections you are eligible for.",
  rejected: "Your verification request was rejected.",
  suspended: "Your verification is suspended. Contact the election office.",
};

function VerificationCard({ me }) {
  const p = me.profile;
  return (
    <section className="vs-card p-6" data-testid="verification-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Verification status</p>
          <div className="mt-2"><StatusBadge status={p.verification_status} testId="student-verification-status" /></div>
        </div>
        <BadgeCheck className={`h-8 w-8 ${p.verification_status === "verified" ? "text-emerald-500" : "text-slate-300"}`} />
      </div>
      <p className="mt-4 text-sm text-slate-600">{STATUS_COPY[p.verification_status]}</p>
      {me.decision?.status === "rejected" && me.decision.reason && <p className="mt-2 text-sm text-rose-600" data-testid="rejection-reason">Reason: {me.decision.reason}</p>}
      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200 pt-5 text-sm" data-testid="student-profile-summary">
        <div><dt className="text-xs text-slate-500">Name</dt><dd className="text-slate-700">{p.full_name}</dd></div>
        <div><dt className="text-xs text-slate-500">Registration no.</dt><dd className="font-mono text-slate-700">{p.registration_number}</dd></div>
        <div><dt className="text-xs text-slate-500">Department</dt><dd className="text-slate-700">{p.department}</dd></div>
        <div><dt className="text-xs text-slate-500">Semester</dt><dd className="text-slate-700">{p.semester}</dd></div>
      </dl>
    </section>
  );
}

function ElectionRow({ e }) {
  const a = e.availability;
  return (
    <li className="vs-card flex flex-col justify-between gap-4 p-5" data-testid={`student-election-${e.id}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display font-semibold text-navy">{e.title}</p>
          <StatusBadge status={e.state} />
          {a.participated && <StatusBadge status="accepted" className="normal-case" testId={`participated-badge-${e.id}`} />}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3 w-3" /> {fmt(e.opens_at)} – {fmt(e.closes_at)}</p>
        {a.participated ? <p className="mt-1 text-xs text-emerald-600">Your ballot was recorded on {fmt(a.participated_at)}.</p>
          : a.reason ? <p className="mt-1 text-xs text-amber-700" data-testid={`unavailable-reason-${e.id}`}>{a.reason}</p>
          : a.eligible && !a.can_vote ? <p className="mt-1 text-xs text-slate-500">You are eligible. Voting is available only while the election is open.</p> : null}
      </div>
      <Button asChild variant={a.can_vote ? "default" : "outline"} className={a.can_vote ? "" : "border-slate-300"} data-testid={`open-election-${e.id}`}>
        <Link to={`/app/student/elections/${e.id}`}>{a.can_vote ? "Vote now" : "View details"}</Link>
      </Button>
    </li>
  );
}

export default function StudentDashboard() {
  const me = useQuery({ queryKey: ["student-me"], queryFn: async () => (await api.get("/students/me")).data });
  const els = useQuery({ queryKey: ["student-elections"], queryFn: async () => (await api.get("/student/elections")).data.items, refetchInterval: 30000 });
  const parts = useQuery({ queryKey: ["participation"], queryFn: async () => (await api.get("/participation/me")).data.items });
  if (me.isLoading) return <Loading />;
  return (
    <div>
      <PageHeader title={`Welcome, ${me.data.profile.full_name.split(" ")[0]}`} subtitle={`Registration no. ${me.data.profile.registration_number} · ${me.data.profile.department} · Semester ${me.data.profile.semester}`} />
      {els.data && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Verification status" value={<StatusBadge status={me.data.profile.verification_status} className="text-sm" />} testId="stat-verification" />
          <StatCard label="Eligible elections" value={els.data.filter((e) => e.availability.eligible).length} tone="blue" testId="stat-eligible" />
          <StatCard label="Voted" value={els.data.filter((e) => e.availability.participated).length} tone="green" testId="stat-voted" />
          <StatCard label="Awaiting your vote" value={els.data.filter((e) => e.availability.eligible && !e.availability.participated && ["scheduled", "open", "paused"].includes(e.state)).length} tone="amber" testId="stat-awaiting" />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <VerificationCard me={me.data} />
          <section className="vs-card p-6" data-testid="participation-card">
            <h2 className="font-display font-semibold">Participation</h2>
            {!parts.data?.length ? <p className="mt-3 text-sm text-slate-500">You have not voted in any election yet.</p> : (
              <ul className="mt-3 space-y-3 text-sm">
                {parts.data.map((p) => <li key={p.election_id} className="flex justify-between gap-3"><span className="text-slate-700">{p.election_title}</span><span className="text-xs text-slate-500">{fmt(p.accepted_at)}</span></li>)}
              </ul>
            )}
          </section>
        </div>
        <section>
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><Vote className="h-5 w-5 text-sky-600" /> Elections</h2>
          {els.isLoading ? <Loading /> : !els.data?.length ? (
            <EmptyState icon={CalendarClock} title="No elections have been created." testId="student-elections-empty">Elections appear here once administrators schedule them.</EmptyState>
          ) : <ul className="grid gap-4 md:grid-cols-2" data-testid="student-election-list">{els.data.map((e) => <ElectionRow key={e.id} e={e} />)}</ul>}
        </section>
      </div>
    </div>
  );
}
