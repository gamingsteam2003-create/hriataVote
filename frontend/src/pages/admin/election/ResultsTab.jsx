import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSearch, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt } from "@/lib/api";
import { EmptyState, Loading, ReasonDialog, StatusBadge } from "@/components/vs/common";
import { PositionTotals } from "@/pages/public/PublicResults";

async function downloadReport(path, filename) {
  try {
    const res = await api.get(path, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch { toast.error("Download failed. Please try again."); }
}

export function ReconciliationReport({ r, eid }) {
  return (
    <article className="vs-card space-y-4 p-5" data-testid={`reconciliation-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">Run {fmt(r.run_at)} · {r.ballot_count} ballots · {r.participation_count} participation · {r.eligible_count} eligible</p>
        <div className="flex items-center gap-2"><StatusBadge status={r.passed ? "passed" : "failed"} />
          {eid && <Button size="sm" variant="outline" className="bg-transparent" onClick={() => downloadReport(`/elections/${eid}/reconciliations/${r.id}/report.pdf`, `reconciliation-${eid}.pdf`)} data-testid={`reconciliation-pdf-${r.id}`}><Download className="mr-1.5 h-4 w-4" /> Signed PDF</Button>}
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">{r.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-sm">{c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}<span>{c.label}{!c.passed && c.detail && <span className="block text-xs text-rose-600">{c.detail}</span>}</span></li>
      ))}</ul>
      <div className="space-y-5 border-t border-slate-200 pt-4">{r.totals.map((p) => <PositionTotals key={p.position_id} position={p} />)}</div>
    </article>
  );
}

export function FinalResult({ eid }) {
  const { data, isLoading } = useQuery({ queryKey: ["result", eid], queryFn: async () => (await api.get(`/results/${eid}`)).data });
  if (isLoading) return <Loading />;
  return (
    <div className="vs-card space-y-4 p-5" data-testid="final-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Finalized {fmt(data.finalized_at)} · {data.ballot_count} ballots · {data.published ? `published ${fmt(data.published_at)}` : "not published"}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="bg-transparent" onClick={() => downloadReport(`/results/${eid}/report.pdf`, `results-${eid}.pdf`)} data-testid="results-pdf-btn"><Download className="mr-1.5 h-4 w-4" /> Signed PDF</Button>
          <Button size="sm" variant="outline" className="bg-transparent" onClick={() => downloadReport(`/results/${eid}/report.csv`, `results-${eid}.csv`)} data-testid="results-csv-btn"><Download className="mr-1.5 h-4 w-4" /> CSV</Button>
        </div>
      </div>
      <div><p className="text-xs text-slate-500">Integrity hash</p><p className="vs-hash" data-testid="final-integrity-hash">{data.integrity_hash}</p></div>
      <div><p className="text-xs text-slate-500">Audit head at finalization</p><p className="vs-hash">{data.audit_head_hash}</p></div>
    </div>
  );
}

export default function ResultsTab({ e, isAdmin, reload }) {
  const qc = useQueryClient();
  const [act, setAct] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["recon", e.id], queryFn: async () => (await api.get(`/elections/${e.id}/reconciliations`)).data.items, enabled: ["closed", "finalized"].includes(e.state) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["recon", e.id] }); qc.invalidateQueries({ queryKey: ["result", e.id] }); reload(); };
  const reconcile = async () => { try { const { data: r } = await api.post(`/elections/${e.id}/reconcile`); toast[r.passed ? "success" : "error"](r.passed ? "Reconciliation passed" : "Reconciliation failed — investigate the failed checks"); refresh(); } catch (err) { toast.error(errMsg(err)); } };
  const run = async (reason) => {
    try {
      if (act === "finalize") await api.post(`/elections/${e.id}/finalize`, { reason });
      else if (act === "publish") await api.post(`/elections/${e.id}/publish`, { reason });
      else await api.post(`/elections/${e.id}/approvals`, { action: "finalize", reason });
    } catch (err) { throw new Error(errMsg(err)); }
    toast.success("Recorded"); refresh();
  };
  if (!["closed", "finalized"].includes(e.state)) return <EmptyState icon={FileSearch} title="Results are not available yet." testId="results-not-available">Candidate totals are calculated only after voting closes.</EmptyState>;
  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex flex-wrap gap-2" data-testid="result-actions">
          {e.state === "closed" && <Button onClick={reconcile} data-testid="reconcile-btn">Run reconciliation</Button>}
          {e.state === "closed" && e.result_status === "awaiting_approval" && e.policy.require_two_person && <Button variant="outline" className="bg-transparent" onClick={() => setAct("request_finalize")} data-testid="request-finalize-approval-btn">Request finalization approval</Button>}
          {e.state === "closed" && e.result_status === "awaiting_approval" && <Button variant="outline" className="border-sky-500/50 bg-transparent" onClick={() => setAct("finalize")} data-testid="finalize-btn">Finalize results</Button>}
          {e.state === "finalized" && e.result_status !== "published" && e.policy.disclosure === "public_after_publication" && <Button onClick={() => setAct("publish")} data-testid="publish-btn">Publish results</Button>}
        </div>
      )}
      {e.state === "finalized" && <FinalResult eid={e.id} />}
      <h3 className="font-display font-semibold">Reconciliation reports</h3>
      {isLoading ? <Loading /> : !data?.length ? <EmptyState title="No reconciliation has been run." testId="recon-empty" /> : data.map((r) => <ReconciliationReport key={r.id} r={r} eid={e.id} />)}
      {act && <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} title={{ finalize: "Finalize results", publish: "Publish results", request_finalize: "Request finalization approval" }[act]}
        description={act === "finalize" ? "Finalized results cannot be overwritten through the application." : undefined} onConfirm={run} testId="result-dialog" />}
    </div>
  );
}
