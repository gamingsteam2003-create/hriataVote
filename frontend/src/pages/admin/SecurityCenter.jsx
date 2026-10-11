import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Lock, Ban, AlertTriangle, ScrollText, HeartPulse } from "lucide-react";
import { api, fmt } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, StatCard, StatusBadge } from "@/components/vs/common";

const CAT_ICON = { failed_logins: Lock, rate_limits: AlertTriangle, unauthorized: Ban, suspicious: ShieldAlert };

function toneFor(severity, count) {
  if (!count) return "green";
  return severity === "high" ? "red" : severity === "medium" ? "amber" : "blue";
}

export default function SecurityCenter() {
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["admin-security"],
    queryFn: async () => (await api.get("/admin/security")).data,
    refetchInterval: 20000,
  });
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-8" data-testid="security-center-page">
      <PageHeader title="Security command center"
        subtitle={`Live view of genuine security events and system health. No passwords, tokens or ballot choices are shown. Updated ${fmt(new Date(dataUpdatedAt).toISOString())}.`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {data.categories.map((cat) => (
          <StatCard key={cat.key} testId={`security-cat-${cat.key}`} label={cat.label} icon={CAT_ICON[cat.key] || ShieldAlert}
            value={cat.count_24h} tone={toneFor(cat.severity, cat.count_24h)} hint={`last 24h · ${cat.count_7d} in 7 days`} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard testId="security-audit-status" label="Audit-chain integrity" icon={ScrollText}
          value={<StatusBadge status={data.audit.ok ? "verified" : "failed"} testId="security-audit-badge" />}
          tone={data.audit.ok ? "green" : "red"}
          hint={data.audit.ok ? `${data.audit.checked} events verified` : (data.audit.problem || "Inconsistency detected")} />
        <StatCard testId="security-locked" label="Locked accounts" icon={Lock} value={data.locked_accounts}
          tone={data.locked_accounts ? "amber" : "green"} hint="Accounts in failed-attempt lockout" />
        <StatCard testId="security-health" label="System health" icon={HeartPulse}
          value={<StatusBadge status={data.health.service === "ok" ? "active" : "failed"} />}
          hint={`DB ${data.health.ping_ms} ms · ${data.health.active_sessions} active session(s) · ${data.health.env}`} />
      </div>

      <section data-testid="security-recon-failures">
        <h2 className="mb-3 font-display font-semibold text-navy">Reconciliation discrepancies</h2>
        {!data.reconciliation_failures.length ? (
          <EmptyState title="No reconciliation discrepancies recorded." testId="security-recon-empty">
            Failed reconciliations block finalization until the listed checks are resolved.
          </EmptyState>
        ) : (
          <ul className="vs-card divide-y divide-slate-200">
            {data.reconciliation_failures.map((r) => (
              <li key={`${r.election_id}-${r.run_at}`} className="p-4" data-testid={`security-recon-${r.election_id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-navy">{r.title || r.election_id}</span>
                  <span className="text-xs text-slate-500">{fmt(r.run_at)}</span>
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs text-rose-600">
                  {r.failed_checks.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display font-semibold text-navy">Security events (last 7 days)</h2>
        {!data.events.length ? <EmptyState title="No security events recorded." testId="security-events-empty" /> : (
          <DataTable head={["Time", "Kind", "Severity", "Source (hashed)", "Detail", "Recommended action"]} testId="security-events-table">
            {data.events.map((s) => (
              <tr key={s.id} data-testid={`security-event-${s.id}`}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{fmt(s.at)}</td>
                <td className="px-4 py-2 font-mono text-xs">{s.kind}</td>
                <td className="px-4 py-2"><StatusBadge status={s.severity} /></td>
                <td className="px-4 py-2 font-mono text-[11px] text-slate-500">{s.ip_hash || "—"}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{s.detail}</td>
                <td className="px-4 py-2 text-xs text-slate-600">{s.recommended}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </div>
  );
}
