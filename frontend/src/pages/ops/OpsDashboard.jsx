import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Database, HardDrive, Timer, Users } from "lucide-react";
import { api, fmt } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/vs/common";
import { chartTooltip } from "@/pages/admin/AdminOverview";

export default function OpsDashboard() {
  const { data, isLoading, dataUpdatedAt } = useQuery({ queryKey: ["ops"], queryFn: async () => (await api.get("/ops/status")).data, refetchInterval: 15000 });
  if (isLoading) return <Loading />;
  const hours = {};
  data.request_metrics.forEach((m) => { hours[m.hour] = { hour: m.hour.slice(11), ...(hours[m.hour] || {}), [m.class]: m.count }; });
  const series = Object.values(hours);
  return (
    <div className="space-y-8">
      <PageHeader title="System status" subtitle={`Sanitized operational diagnostics. No ballot content or personal data is shown. Updated ${fmt(new Date(dataUpdatedAt).toISOString())}.`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="API service" value={<StatusBadge status={data.service.status === "ok" ? "active" : "failed"} testId="ops-service-status" />} hint={`env: ${data.service.env} · since ${fmt(data.service.started_at)}`} icon={Activity} testId="ops-service" />
        <StatCard label="Database" value={`${data.database.ping_ms} ms`} hint={data.database.transactions_supported ? "Multi-document transactions available" : "Standalone: compensating rollback in use"} icon={Database} testId="ops-db" />
        <StatCard label="Active sessions" value={data.active_sessions} icon={Users} testId="ops-sessions" />
        <StatCard label="Security events (24h)" value={Object.values(data.security_by_kind).reduce((a, b) => a + b, 0)} icon={Timer} testId="ops-security-count" />
      </div>
      <section className="vs-card p-5">
        <h2 className="mb-3 font-display font-semibold">API responses per hour (24h, UTC)</h2>
        {!series.length ? <p className="text-sm text-slate-500">No requests recorded yet.</p> : (
          <ResponsiveContainer width="100%" height={220}><AreaChart data={series}><CartesianGrid stroke="#E2E8F0" vertical={false} /><XAxis dataKey="hour" stroke="#64748B" fontSize={11} /><YAxis stroke="#64748B" fontSize={11} allowDecimals={false} /><Tooltip {...chartTooltip} />
            <Area dataKey="2xx" stackId="1" stroke="#10B981" fill="#10B98133" /><Area dataKey="4xx" stackId="1" stroke="#F59E0B" fill="#F59E0B33" /><Area dataKey="5xx" stackId="1" stroke="#F43F5E" fill="#F43F5E55" /></AreaChart></ResponsiveContainer>
        )}
        {data.error_routes.length > 0 && <ul className="mt-4 space-y-1 text-xs text-rose-600" data-testid="ops-error-routes">{data.error_routes.map((r) => <li key={r.route} className="font-mono">{r.route}: {r.count} server error(s)</li>)}</ul>}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vs-card p-5" data-testid="ops-jobs">
          <h2 className="mb-3 font-display font-semibold">Background jobs</h2>
          {!data.jobs.length ? <p className="text-sm text-slate-500">No job runs recorded.</p> : data.jobs.map((j) => <div key={j.id} className="flex justify-between text-sm"><span className="font-mono">{j.id}</span><span className="flex items-center gap-2"><StatusBadge status={j.ok ? "active" : "failed"} /><span className="text-xs text-slate-500">{fmt(j.last_run)}</span></span></div>)}
        </section>
        <section className="vs-card p-5" data-testid="ops-backup">
          <h2 className="mb-3 flex items-center gap-2 font-display font-semibold"><HardDrive className="h-4 w-4" /> Backups</h2>
          {data.backup ? <pre className="overflow-x-auto font-mono text-xs text-slate-600">{JSON.stringify(data.backup, null, 2)}</pre> : <p className="text-sm text-slate-500">Backup monitoring is not configured in this environment. Set BACKUP_STATUS_FILE and run the documented backup script to report status here.</p>}
        </section>
      </div>
      <section>
        <h2 className="mb-3 font-display font-semibold">Security events (24h)</h2>
        {!data.security_events.length ? <EmptyState title="No security events in the last 24 hours." testId="ops-events-empty" /> : (
          <DataTable head={["Time", "Kind", "Severity", "Source (hashed)", "Detail"]} testId="ops-events-table">
            {data.security_events.map((s) => <tr key={s.id}><td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{fmt(s.at)}</td><td className="px-4 py-2 font-mono text-xs">{s.kind}</td><td className="px-4 py-2"><StatusBadge status={s.severity} /></td><td className="px-4 py-2 font-mono text-[11px] text-slate-500">{s.ip_hash || "—"}</td><td className="px-4 py-2 text-xs text-slate-500">{s.detail}</td></tr>)}
          </DataTable>
        )}
      </section>
    </div>
  );
}
