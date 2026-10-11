import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { DataTable, EmptyState, ErrorNote, Field, Loading, Pager, StatusBadge } from "@/components/vs/common";

function ChangeForm({ e, onDone }) {
  const [f, setF] = useState({ registration_number: "", action: "add", reason: "" });
  const [error, setError] = useState("");
  const submit = async (ev) => {
    ev.preventDefault(); setError("");
    try { await api.post(`/elections/${e.id}/eligibility/change`, f); toast.success("Eligibility updated"); setF({ ...f, registration_number: "", reason: "" }); onDone(); }
    catch (err) { setError(errMsg(err)); }
  };
  return (
    <form onSubmit={submit} className="vs-card grid gap-4 p-5 md:grid-cols-[1fr_140px_2fr_auto] md:items-end" data-testid="eligibility-change-form">
      <Field label="Registration number" htmlFor="ec-reg"><input id="ec-reg" className="vs-input font-mono uppercase" value={f.registration_number} onChange={(ev) => setF({ ...f, registration_number: ev.target.value })} required data-testid="elig-change-reg-input" /></Field>
      <Field label="Change" htmlFor="ec-act"><select id="ec-act" className="vs-input" value={f.action} onChange={(ev) => setF({ ...f, action: ev.target.value })} data-testid="elig-change-action-select"><option value="add">Add</option><option value="revoke">Revoke</option></select></Field>
      <Field label="Reason (audited)" htmlFor="ec-reason"><input id="ec-reason" className="vs-input" value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} required minLength={5} data-testid="elig-change-reason-input" /></Field>
      <Button type="submit" data-testid="elig-change-submit-btn">Apply</Button>
      <div className="md:col-span-4"><ErrorNote>{error}</ErrorNote></div>
    </form>
  );
}

export default function EligibilityTab({ e, reload }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["eligibility", e.id, page], queryFn: async () => (await api.get(`/elections/${e.id}/eligibility`, { params: { page } })).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["eligibility", e.id] }); reload(); };
  const call = async (path, msg) => { try { await api.post(path); toast.success(msg); refresh(); } catch (err) { toast.error(errMsg(err)); } };
  const draft = e.state === "draft";
  return (
    <div className="space-y-6">
      <div className="vs-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          <p>Eligibility is computed from verified, active students matching the election scope{e.semesters.length ? " and semesters" : ""}. Students with a non-active registry enrollment are excluded.</p>
          <p className="mt-1 text-xs text-slate-500">List status: {e.eligibility_locked ? "locked" : "unlocked"} · {e.eligible_count} eligible</p>
        </div>
        {draft && (
          <div className="flex shrink-0 gap-2">
            {!e.eligibility_locked && <Button variant="outline" className="bg-transparent" onClick={() => call(`/elections/${e.id}/eligibility/generate`, "Eligibility list generated")} data-testid="elig-generate-btn"><ListChecks className="mr-2 h-4 w-4" /> Generate list</Button>}
            {e.eligibility_locked
              ? <Button variant="outline" className="bg-transparent" onClick={() => call(`/elections/${e.id}/eligibility-lock/unlock`, "Eligibility unlocked")} data-testid="elig-unlock-btn"><Unlock className="mr-2 h-4 w-4" /> Unlock</Button>
              : <Button onClick={() => call(`/elections/${e.id}/eligibility-lock/lock`, "Eligibility locked")} data-testid="elig-lock-btn"><Lock className="mr-2 h-4 w-4" /> Lock list</Button>}
          </div>
        )}
      </div>
      {["draft", "scheduled", "open", "paused"].includes(e.state) && (e.eligibility_locked || !draft) && <ChangeForm e={e} onDone={refresh} />}
      {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={ListChecks} title="No eligibility records yet." testId="eligibility-empty">Generate the list after students are verified.</EmptyState> : (
        <>
          <DataTable head={["Student", "Department", "Sem", "Status", "Basis", "Participated"]} testId="eligibility-table">
            {data.items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><div>{r.student?.full_name}</div><div className="font-mono text-xs text-slate-500">{r.student?.registration_number}</div></td>
                <td className="px-4 py-3">{r.student?.department}</td><td className="px-4 py-3">{r.student?.semester}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.reason}{r.history?.length ? ` · ${r.history.length} change(s)` : ""}</td>
                <td className="px-4 py-3 text-xs">{r.participated ? "Yes" : "No"}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
