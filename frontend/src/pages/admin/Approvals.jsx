import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loading, PageHeader, Pager } from "@/components/vs/common";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ApprovalsList } from "@/pages/admin/election/ControlsTab";

export default function Approvals() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["approvals", status, page], queryFn: async () => (await api.get("/approvals", { params: { status, page } })).data });
  return (
    <div>
      <PageHeader title="Two-person approvals" subtitle="Opening and finalizing elections with this policy need a second, different administrator." />
      <select className="vs-input mb-4 sm:w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="approvals-status-filter">
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="executed">Executed</option><option value="rejected">Rejected</option><option value="">All</option>
      </select>
      {isLoading ? <Loading /> : <>
        <ApprovalsList approvals={data.items} isAdmin={user.role === "admin"} onDone={() => qc.invalidateQueries({ queryKey: ["approvals"] })} />
        <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
      </>}
    </div>
  );
}
