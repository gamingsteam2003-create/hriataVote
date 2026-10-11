import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt, toLocalInput } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Field, ReasonDialog, StatusBadge } from "@/components/vs/common";

const BUTTONS = {
  draft: [["schedule", "Schedule"], ["cancel", "Cancel election"]],
  scheduled: [["open", "Open voting"], ["unschedule", "Return to draft"], ["cancel", "Cancel election"]],
  open: [["pause", "Emergency pause"], ["close", "Close voting"], ["extend", "Extend"]],
  paused: [["resume", "Resume"], ["close", "Close voting"], ["extend", "Extend"]],
};
const DANGER = new Set(["cancel", "pause", "close"]);

export function Readiness({ checks }) {
  return (
    <ul className="vs-card divide-y divide-slate-200" data-testid="readiness-checklist">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-3 p-4" data-testid={`readiness-${c.key}`}>
          {c.passed ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />}
          <div><p className="text-sm font-medium text-slate-700">{c.label}</p>{c.detail && <p className="text-xs text-slate-500">{c.detail}</p>}</div>
        </li>
      ))}
    </ul>
  );
}

export function ApprovalsList({ approvals, isAdmin, onDone }) {
  const { user } = useAuth();
  const [act, setAct] = useState(null);
  if (!approvals.length) return <p className="text-sm text-slate-500">No approval requests.</p>;
  return (
    <>
      <ul className="vs-card divide-y divide-slate-200" data-testid="approvals-list">
        {approvals.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`approval-${a.id}`}>
            <div className="text-sm"><span className="font-medium capitalize">{a.action}</span> <StatusBadge status={a.status} />{a.election_title && <span className="ml-2 text-slate-500">{a.election_title}</span>}
              <p className="text-xs text-slate-500">Requested {fmt(a.created_at)}{a.requested_by_email ? ` by ${a.requested_by_email}` : ""}: {a.request_reason}{a.decision_reason ? ` · Decision: ${a.decision_reason}` : ""}</p></div>
            {isAdmin && a.status === "pending" && a.requested_by !== user.id && (
              <div className="flex gap-2"><Button size="sm" onClick={() => setAct({ a, decision: "approve" })} data-testid={`approval-approve-${a.id}`}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setAct({ a, decision: "reject" })} data-testid={`approval-reject-${a.id}`}>Reject</Button></div>
            )}
            {a.status === "pending" && a.requested_by === user.id && <span className="text-xs text-amber-700">Awaiting a different administrator</span>}
          </li>
        ))}
      </ul>
      {act && <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} danger={act.decision === "reject"} title={`${act.decision === "approve" ? "Approve" : "Reject"} '${act.a.action}' request`}
        onConfirm={async (reason) => { try { await api.post(`/approvals/${act.a.id}/decision`, { decision: act.decision, reason }); } catch (e) { throw new Error(errMsg(e)); } toast.success("Decision recorded"); onDone(); }} testId="approval-dialog" />}
    </>
  );
}

export default function ControlsTab({ e, isAdmin, reload }) {
  const [act, setAct] = useState(null);
  const [newClose, setNewClose] = useState(toLocalInput(e.closes_at));
  const run = async (reason) => {
    try {
      if (act === "request_open") await api.post(`/elections/${e.id}/approvals`, { action: "open", reason });
      else await api.post(`/elections/${e.id}/actions/${act}`, { reason, ...(act === "extend" ? { new_closes_at: new Date(newClose).toISOString() } : {}) });
    } catch (err) { throw new Error(errMsg(err)); }
    toast.success("Action recorded"); reload();
  };
  const buttons = (BUTTONS[e.state] || []).filter(([k]) => k !== "extend" || e.policy.allow_extension);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section>
        <h3 className="mb-3 font-display font-semibold">Readiness checklist <span className="text-xs font-normal text-slate-500">({e.state === "scheduled" ? "for opening" : "for scheduling"})</span></h3>
        <Readiness checks={e.readiness} />
      </section>
      <section className="space-y-6">
        {isAdmin && (
          <div className="vs-card space-y-3 p-5" data-testid="lifecycle-controls">
            <h3 className="font-display font-semibold">Lifecycle controls</h3>
            {!buttons.length && <p className="text-sm text-slate-500">No lifecycle actions are available in state “{e.state}”.</p>}
            {buttons.map(([k, l]) => <Button key={k} className="w-full" variant={DANGER.has(k) ? "destructive" : "default"} onClick={() => setAct(k)} data-testid={`action-${k}-btn`}>{l}</Button>)}
            {e.state === "scheduled" && e.policy.require_two_person && <Button className="w-full" variant="outline" onClick={() => setAct("request_open")} data-testid="request-open-approval-btn">Request opening approval</Button>}
          </div>
        )}
        <div>
          <h3 className="mb-3 font-display font-semibold">Two-person approvals</h3>
          {e.policy.require_two_person ? <ApprovalsList approvals={e.approvals} isAdmin={isAdmin} onDone={reload} /> : <p className="text-sm text-slate-500">Not required by this election's policy.</p>}
        </div>
      </section>
      {act && (
        <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} danger={DANGER.has(act)} title={act === "request_open" ? "Request approval to open" : `Confirm: ${act}`}
          description="The server re-validates this action and records it in the audit log." onConfirm={run} testId="action-dialog">
          {act === "extend" && <Field label="New closing time" htmlFor="ext-close"><input id="ext-close" type="datetime-local" className="vs-input" value={newClose} onChange={(ev) => setNewClose(ev.target.value)} data-testid="extend-closes-input" /></Field>}
        </ReasonDialog>
      )}
    </div>
  );
}
