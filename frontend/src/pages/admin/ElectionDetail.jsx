import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fmt } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Loading, StatusBadge } from "@/components/vs/common";
import ElectionForm from "@/pages/admin/ElectionForm";
import CandidatesTab from "@/pages/admin/election/CandidatesTab";
import EligibilityTab from "@/pages/admin/election/EligibilityTab";
import ControlsTab from "@/pages/admin/election/ControlsTab";
import TurnoutTab from "@/pages/admin/election/TurnoutTab";
import ResultsTab from "@/pages/admin/election/ResultsTab";

function Overview({ e }) {
  const rows = [["Type", e.election_type], ["Academic year", e.academic_year], ["Scope", e.scope === "college" ? "College-wide" : e.departments.join(", ")],
    ["Semesters", e.semesters.length ? e.semesters.join(", ") : "All"], ["Opens", fmt(e.opens_at)], ["Closes", fmt(e.closes_at)], ["Timezone", e.timezone],
    ["Two-person approval", e.policy.require_two_person ? "Required" : "Not required"], ["Extensions", e.policy.allow_extension ? "Allowed" : "Not allowed"],
    ["Abstention", e.policy.allow_abstain ? "Allowed" : "Not allowed"], ["Disclosure", e.policy.disclosure.replace(/_/g, " ")], ["Eligibility list", e.eligibility_locked ? `Locked ${fmt(e.eligibility_locked_at)}` : "Unlocked"]];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <dl className="vs-card grid grid-cols-2 gap-4 p-6 text-sm" data-testid="election-config">
        {rows.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="capitalize text-slate-700">{v}</dd></div>)}
      </dl>
      <div className="vs-card space-y-4 p-6">
        <h3 className="font-display font-semibold">Positions</h3>
        <ul className="space-y-2 text-sm">{e.positions.map((p) => <li key={p.id} className="flex justify-between"><span>{p.title}</span><span className="text-xs text-slate-500">up to {p.max_selections}</span></li>)}</ul>
        {e.description && <><h3 className="font-display font-semibold">Description</h3><p className="whitespace-pre-line text-sm text-slate-600">{e.description}</p></>}
        {e.nomination_rules && <><h3 className="font-display font-semibold">Nomination rules</h3><p className="whitespace-pre-line text-sm text-slate-600">{e.nomination_rules}</p></>}
      </div>
    </div>
  );
}

export default function ElectionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const { data: e, isLoading } = useQuery({ queryKey: ["election", id], queryFn: async () => (await api.get(`/elections/${id}`)).data, refetchInterval: 30000 });
  if (isLoading) return <Loading />;
  const isAdmin = user.role === "admin";
  const reload = () => { qc.invalidateQueries({ queryKey: ["election", id] }); qc.invalidateQueries({ queryKey: ["elections"] }); };
  const props = { e, isAdmin, reload };
  return (
    <div>
      <Link to={isAdmin ? "/app/admin/elections" : "/app/auditor"} className="mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-sky-600" data-testid="election-back-link"><ArrowLeft className="h-4 w-4" /> Elections</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-2xl font-bold text-navy sm:text-3xl" data-testid="election-title">{e.title}</h1><StatusBadge status={e.state} testId="election-state-badge" />{e.result_status && <StatusBadge status={e.result_status} testId="election-result-status" />}</div>
          <p className="mt-1 text-sm text-slate-500">{e.eligible_count} eligible · {e.participation_count} participated{!isAdmin && " · read-only view"}</p>
        </div>
        {isAdmin && e.state === "draft" && !e.eligibility_locked && <Button variant="outline" className="border-slate-300 bg-transparent" onClick={() => setEdit(true)} data-testid="edit-election-btn"><Pencil className="mr-2 h-4 w-4" /> Edit</Button>}
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="mb-6 flex h-auto flex-wrap justify-start bg-white border border-slate-200">
          {["overview", "candidates", ...(isAdmin ? ["eligibility"] : []), "controls", "turnout", "results"].map((t) => <TabsTrigger key={t} value={t} className="capitalize" data-testid={`tab-${t}`}>{t === "controls" ? "Readiness & controls" : t}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview"><Overview e={e} /></TabsContent>
        <TabsContent value="candidates"><CandidatesTab {...props} /></TabsContent>
        {isAdmin && <TabsContent value="eligibility"><EligibilityTab {...props} /></TabsContent>}
        <TabsContent value="controls"><ControlsTab {...props} /></TabsContent>
        <TabsContent value="turnout"><TurnoutTab {...props} /></TabsContent>
        <TabsContent value="results"><ResultsTab {...props} /></TabsContent>
      </Tabs>
      {edit && <ElectionForm open={edit} onOpenChange={setEdit} election={e} onSaved={reload} />}
    </div>
  );
}
