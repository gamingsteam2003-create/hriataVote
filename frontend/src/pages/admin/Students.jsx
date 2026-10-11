import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, Pager, ReasonDialog, StatusBadge } from "@/components/vs/common";
import { ResetTokenDialog } from "@/pages/admin/StaffUsers";

export default function Students() {
  const qc = useQueryClient();
  const [f, setF] = useState({ status: "", q: "", page: 1 });
  const [act, setAct] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["students", f], queryFn: async () => (await api.get("/admin/students", { params: f })).data });
  const run = async (reason) => {
    try { await api.post(`/admin/students/${act.s.id}/${act.op}`, { reason }); } catch (e) { throw new Error(errMsg(e)); }
    toast.success(`Student ${act.op === "suspend" ? "suspended" : "reactivated"}`); qc.invalidateQueries({ queryKey: ["students"] });
  };
  return (
    <div>
      <PageHeader title="Students" subtitle="Registered student accounts and their verification state." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <select className="vs-input sm:w-48" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} data-testid="students-status-filter">
          <option value="">All statuses</option>{["pending", "under_review", "verified", "rejected", "suspended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <input className="vs-input sm:w-72" placeholder="Search name or registration no." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} data-testid="students-search-input" />
      </div>
      {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={Users} title="No students found." testId="students-empty" /> : (
        <>
          <DataTable head={["Student", "Department", "Sem", "Verification", "Account", ""]} testId="students-table">
            {data.items.map((s) => (
              <tr key={s.id} data-testid={`student-row-${s.id}`}>
                <td className="px-4 py-3"><div>{s.full_name}</div><div className="font-mono text-xs text-slate-500">{s.registration_number}{s.email ? ` · ${s.email}` : ""}</div></td>
                <td className="px-4 py-3">{s.department}</td><td className="px-4 py-3">{s.semester}</td>
                <td className="px-4 py-3"><StatusBadge status={s.verification_status} /></td>
                <td className="px-4 py-3"><StatusBadge status={s.account_status} /></td>
                <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">
                  {s.verification_status === "verified" && <Button size="sm" variant="outline" className="border-rose-500/40 bg-transparent text-rose-700" onClick={() => setAct({ s, op: "suspend" })} data-testid={`suspend-btn-${s.id}`}>Suspend</Button>}
                  {s.verification_status === "suspended" && <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setAct({ s, op: "reactivate" })} data-testid={`reactivate-btn-${s.id}`}>Reactivate</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setResetFor({ id: s.id, label: `${s.full_name} (${s.registration_number})` })} data-testid={`student-reset-token-btn-${s.id}`}>Reset token</Button>
                </div></td>
              </tr>
            ))}
          </DataTable>
          <Pager page={f.page} size={data.size} total={data.total} onPage={(p) => setF({ ...f, page: p })} />
        </>
      )}
      {act && <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} danger={act.op === "suspend"} title={act.op === "suspend" ? "Suspend student" : "Reactivate student"} description={`${act.s.full_name} (${act.s.registration_number})`} onConfirm={run} testId="student-status-dialog" />}
      <ResetTokenDialog target={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}
