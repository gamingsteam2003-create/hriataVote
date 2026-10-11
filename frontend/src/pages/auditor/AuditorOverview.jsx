import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt } from "@/lib/api";
import { ErrorNote, Field, Loading, PageHeader, StatusBadge } from "@/components/vs/common";
import { OverviewStats } from "@/pages/admin/AdminOverview";
import { ElectionsTable } from "@/pages/admin/Elections";

function Findings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["findings"], queryFn: async () => (await api.get("/audit/findings")).data.items });
  const [f, setF] = useState({ severity: "info", title: "", detail: "", election_id: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError("");
    try { await api.post("/audit/findings", f); toast.success("Finding recorded"); setF({ severity: "info", title: "", detail: "", election_id: "" }); qc.invalidateQueries({ queryKey: ["findings"] }); }
    catch (err) { setError(errMsg(err)); }
  };
  return (
    <section className="space-y-4">
      <h2 className="font-display text-lg font-semibold">Audit findings</h2>
      <form onSubmit={submit} className="vs-card grid gap-4 p-5 md:grid-cols-[140px_1fr]" data-testid="finding-form">
        <Field label="Severity" htmlFor="fd-sev"><select id="fd-sev" className="vs-input" value={f.severity} onChange={set("severity")} data-testid="finding-severity-select">{["info", "low", "medium", "high"].map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Title" htmlFor="fd-title"><input id="fd-title" className="vs-input" value={f.title} onChange={set("title")} required data-testid="finding-title-input" /></Field>
        <div className="md:col-span-2"><Field label="Finding or recommendation" htmlFor="fd-detail"><textarea id="fd-detail" rows={3} className="vs-input" value={f.detail} onChange={set("detail")} required data-testid="finding-detail-input" /></Field></div>
        <div className="md:col-span-2"><ErrorNote>{error}</ErrorNote></div>
        <Button type="submit" className="w-fit" data-testid="finding-submit-btn">Record finding</Button>
      </form>
      {!data?.length ? <p className="text-sm text-slate-500">No findings recorded.</p> : (
        <ul className="vs-card divide-y divide-slate-200" data-testid="findings-list">{data.map((x) => <li key={x.id} className="p-4"><div className="flex items-center gap-2"><StatusBadge status={x.severity} /><span className="font-medium">{x.title}</span></div><p className="mt-1 whitespace-pre-line text-sm text-slate-600">{x.detail}</p><p className="mt-1 text-xs text-slate-500">{x.recorded_by_email} · {fmt(x.created_at)}</p></li>)}</ul>
      )}
    </section>
  );
}

export default function AuditorOverview() {
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: async () => (await api.get("/analytics/overview")).data });
  return (
    <div className="space-y-10">
      <PageHeader title="Auditor overview" subtitle="Read-only access to election configuration, participation summaries and audit records." />
      {isLoading ? <Loading /> : <OverviewStats d={data} />}
      <section><h2 className="mb-4 font-display text-lg font-semibold">Election records</h2><ElectionsTable /></section>
      <Findings />
    </div>
  );
}
