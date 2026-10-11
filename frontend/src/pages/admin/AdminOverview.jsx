import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Database, PieChart as PieChartIcon, ShieldAlert, UserCheck, Users, Vote } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/vs/common";
import { useAuth } from "@/context/AuthContext";

export const chartTooltip = { contentStyle: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8, color: "#0A1F44" } };

export function OverviewStats({ d }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total students" value={d.students.total} icon={Users} testId="stat-students" />
        <StatCard label="Verified" value={d.students.verified || 0} tone="blue" icon={UserCheck} testId="stat-verified" />
        <StatCard label="Pending" value={d.pending_verification} tone="amber" testId="stat-pending" />
        <StatCard label="Rejected" value={d.students.rejected || 0} tone="red" testId="stat-rejected" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Registry records" value={d.registry_count} icon={Database} testId="stat-registry" />
        <StatCard label="Security alerts (24h)" value={d.security_alerts_24h} hint="medium & high severity" icon={ShieldAlert} testId="stat-alerts" />
      </div>
    </div>
  );
}

export function TurnoutChart({ rows }) {
  if (!rows.length) return <EmptyState icon={BarChart3} title="No turnout data yet." testId="turnout-empty">Turnout appears once an election has opened.</EmptyState>;
  return (
    <div className="vs-card p-5" data-testid="turnout-chart">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={rows.map((r) => ({ name: r.title.slice(0, 18), turnout: r.turnout_pct }))}>
          <CartesianGrid stroke="#E2E8F0" vertical={false} />
          <XAxis dataKey="name" stroke="#64748B" fontSize={12} />
          <YAxis stroke="#64748B" fontSize={12} unit="%" domain={[0, 100]} />
          <Tooltip {...chartTooltip} />
          <Bar dataKey="turnout" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TurnoutDonut({ rows }) {
  const eligible = rows.reduce((a, r) => a + r.eligible, 0);
  const participated = rows.reduce((a, r) => a + r.participated, 0);
  const pct = eligible ? Math.round((participated / eligible) * 100) : 0;
  if (!eligible) return <EmptyState icon={PieChartIcon} title="No turnout data yet." testId="turnout-donut-empty">A donut appears once an election has eligible voters.</EmptyState>;
  const chartData = [{ name: "Voted", value: participated }, { name: "Not yet voted", value: Math.max(0, eligible - participated) }];
  return (
    <div className="vs-card p-5" data-testid="turnout-donut">
      <h2 className="mb-2 flex items-center gap-2 font-display font-semibold"><PieChartIcon className="h-4 w-4 text-sky-600" /> Overall turnout</h2>
      <div className="relative">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} startAngle={90} endAngle={-270} paddingAngle={2} stroke="none">
              <Cell fill="#0EA5E9" /><Cell fill="#E2E8F0" />
            </Pie>
            <Tooltip {...chartTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-navy" data-testid="turnout-donut-pct">{pct}%</span>
          <span className="text-xs text-slate-500">{participated} / {eligible} voted</span>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">Aggregate across {rows.length} active election(s)</p>
    </div>
  );
}

export default function AdminOverview() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: async () => (await api.get("/analytics/overview")).data, refetchInterval: 30000 });
  if (isLoading) return <Loading />;
  const states = Object.entries(data.elections);
  return (
    <div>
      <PageHeader title="Administrator overview" subtitle="Live figures calculated by the server from database records." />
      {!user.mfa_enabled && <p className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800" data-testid="mfa-warning">Two-factor authentication is not enabled on your account. <Link to="/app/settings" className="underline">Enable it in Settings.</Link></p>}
      <OverviewStats d={data} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-3 font-display font-semibold">Turnout by election</h2>
          <TurnoutChart rows={data.turnout} />
        </section>
        <div className="space-y-6">
          <TurnoutDonut rows={data.turnout} />
          <section className="vs-card p-5" data-testid="elections-by-state">
            <h2 className="mb-4 flex items-center gap-2 font-display font-semibold"><Vote className="h-4 w-4 text-sky-600" /> Elections by state</h2>
            {!states.length ? <p className="text-sm text-slate-500">No elections have been created.</p> : (
              <ul className="space-y-2">{states.map(([s, n]) => <li key={s} className="flex justify-between text-sm"><StatusBadge status={s} /><span className="font-mono">{n}</span></li>)}</ul>
            )}
            <Link to="/app/admin/elections" className="mt-5 inline-block text-sm text-sky-600 hover:underline" data-testid="overview-manage-elections">Manage elections</Link>
          </section>
        </div>
      </div>
    </div>
  );
}
