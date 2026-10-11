import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, Pager, ReasonDialog, StatusBadge } from "@/components/vs/common";

export default function Verification() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [act, setAct] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["verif", status, q, page], queryFn: async () => (await api.get("/verification/requests", { params: { status, q, page } })).data });

  const decide = async (reason) => {
    try { await api.post(`/verification/requests/${act.req.id}/decision`, { decision: act.decision, reason }); }
    catch (e) { throw new Error(errMsg(e)); }
    toast.success(`Request ${act.decision === "approve" ? "approved" : "rejected"}`);
    qc.invalidateQueries({ queryKey: ["verif"] });
  };
  const rematch = async () => {
    try { const { data: r } = await api.post("/verification/rematch"); toast.success(`Re-matched ${r.rematched} request(s) against the registry`); qc.invalidateQueries({ queryKey: ["verif"] }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const needsReason = act && (act.decision === "reject" || act.req.match_result !== "matched");

  return (
    <div>
      <PageHeader title="Verification queue" subtitle="Compare each request with the official registry and record a decision."
        actions={<Button variant="outline" className="border-slate-300 bg-transparent" onClick={rematch} data-testid="rematch-btn">Re-match with registry</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <select className="vs-input sm:w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="verif-status-filter">
          <option value="open">Open requests</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All</option>
        </select>
        <input className="vs-input sm:w-72" placeholder="Search name or registration no." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="verif-search-input" />
      </div>
      {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={UserCheck} title="No pending verification requests." testId="verif-empty" /> : (
        <>
          <DataTable head={["Student", "Submitted", "Registry record", "Match", "Status", ""]} testId="verif-table">
            {data.items.map((r) => (
              <tr key={r.id} data-testid={`verif-row-${r.id}`}>
                <td className="px-4 py-3"><div className="font-medium">{r.student?.full_name}</div><div className="font-mono text-xs text-slate-500">{r.student?.registration_number} · {r.student?.department} · Sem {r.student?.semester}</div></td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmt(r.created_at)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.registry_record ? `${r.registry_record.full_name} · ${r.registry_record.department} · Sem ${r.registry_record.semester} · ${r.registry_record.enrollment_status}` : "Not in registry"}</td>
                <td className="px-4 py-3"><StatusBadge status={r.match_result} />{r.mismatch_fields?.length > 0 && <div className="mt-1 text-xs text-amber-700">{r.mismatch_fields.join(", ")}</div>}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-right">
                  {["pending", "under_review"].includes(r.status) ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => r.match_result === "matched" ? setAct({ req: r, decision: "approve" }) : setAct({ req: r, decision: "approve" })} data-testid={`admin-approve-student-btn-${r.id}`}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => setAct({ req: r, decision: "reject" })} data-testid={`admin-reject-student-btn-${r.id}`}>Reject</Button>
                    </div>
                  ) : <span className="text-xs text-slate-500">{r.review_notes}</span>}
                </td>
              </tr>
            ))}
          </DataTable>
          <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
        </>
      )}
      {act && (
        <ReasonDialog open={!!act} onOpenChange={(o) => !o && setAct(null)} danger={act.decision === "reject"}
          title={act.decision === "approve" ? "Approve verification" : "Reject verification"} minLength={needsReason ? (act.decision === "reject" ? 5 : 10) : 0}
          description={act.decision === "approve" && act.req.match_result !== "matched" ? "This request does NOT match the registry. Approval requires a justification of at least 10 characters." : `${act.req.student?.full_name} (${act.req.student?.registration_number})`}
          confirmLabel={act.decision === "approve" ? "Approve" : "Reject"} onConfirm={decide} testId="verif-decision-dialog" />
      )}
    </div>
  );
}
