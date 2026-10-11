import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, fmt } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DataTable, EmptyState, Loading, PageHeader, Pager, StatusBadge } from "@/components/vs/common";
import ElectionForm from "@/pages/admin/ElectionForm";

export function ElectionsTable({ basePath = "/app/elections" }) {
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["elections", state, page], queryFn: async () => (await api.get("/elections", { params: { state, page } })).data });
  return (
    <>
      <select className="vs-input mb-4 sm:w-56" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} data-testid="elections-state-filter">
        <option value="">All states</option>{["draft", "scheduled", "open", "paused", "closed", "finalized", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={Vote} title="No elections have been created." testId="elections-empty" /> : (
        <>
          <DataTable head={["Election", "Window", "State", "Results", "Eligible", "Voted"]} testId="elections-table">
            {data.items.map((e) => (
              <tr key={e.id} className="hover:bg-sky-50/60" data-testid={`election-row-${e.id}`}>
                <td className="px-4 py-3"><Link to={`${basePath}/${e.id}`} className="font-medium text-sky-700 hover:underline" data-testid={`election-link-${e.id}`}>{e.title}</Link><div className="text-xs text-slate-500">{e.academic_year} · {e.scope === "college" ? "College-wide" : e.departments.join(", ")}</div></td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmt(e.opens_at)}<br />{fmt(e.closes_at)}</td>
                <td className="px-4 py-3"><StatusBadge status={e.state} /></td>
                <td className="px-4 py-3"><StatusBadge status={e.result_status} /></td>
                <td className="px-4 py-3 font-mono">{e.eligible_count}</td>
                <td className="px-4 py-3 font-mono">{e.participation_count}</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

export default function Elections() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Elections" subtitle="Draft → Scheduled → Open → Closed → Finalized. Every transition is enforced by the server."
        actions={user.role === "admin" && <Button onClick={() => setOpen(true)} data-testid="create-election-btn"><Plus className="mr-2 h-4 w-4" /> New election</Button>} />
      <ElectionsTable />
      {open && <ElectionForm open={open} onOpenChange={setOpen} onSaved={(e) => navigate(`/app/elections/${e.id}`)} />}
    </div>
  );
}
