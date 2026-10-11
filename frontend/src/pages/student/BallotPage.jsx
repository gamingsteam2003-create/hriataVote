import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, errMsg, fmt } from "@/lib/api";
import { ErrorNote, Loading, StatusBadge } from "@/components/vs/common";
import { CandidatePhoto } from "@/components/vs/CandidatePhoto";

function CandidateOption({ c, selected, onToggle, multi, disabled }) {
  return (
    <label className={`flex cursor-pointer gap-4 rounded-lg border p-4 transition-colors ${selected ? "border-sky-500/70 bg-sky-500/5" : "border-slate-200 hover:border-sky-300 hover:shadow-sm"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`} data-testid={`candidate-card-${c.id}`}>
      <input type={multi ? "checkbox" : "radio"} name={c.position_id} checked={selected} disabled={disabled} onChange={onToggle} className="mt-1 h-4 w-4 accent-sky-500" aria-label={`Select ${c.full_name}`} data-testid={`candidate-select-${c.id}`} />
      <CandidatePhoto id={c.id} hasPhoto={c.has_photo} name={c.full_name} />
      <span className="min-w-0">
        <span className="block font-medium text-navy">{c.full_name}</span>
        <span className="block text-xs text-slate-500">{c.department} · Semester {c.semester}</span>
        {c.manifesto && <span className="mt-2 block whitespace-pre-line text-sm text-slate-600">{c.manifesto}</span>}
        {c.biography && <span className="mt-1 block text-xs text-slate-500">{c.biography}</span>}
      </span>
    </label>
  );
}

function ReceiptCheck({ electionId }) {
  const [receipt, setReceipt] = useState("");
  const [res, setRes] = useState(null);
  const check = async () => {
    try { setRes((await api.post("/ballots/verify-receipt", { election_id: electionId, receipt })).data.included ? "A ballot with this receipt is recorded." : "No ballot with this receipt was found."); }
    catch (e) { setRes(errMsg(e)); }
  };
  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <p className="text-sm font-medium text-slate-600">Check a receipt</p>
      <div className="mt-2 flex gap-2"><input className="vs-input font-mono" value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="32-character receipt" data-testid="receipt-input" /><Button variant="outline" onClick={check} data-testid="receipt-check-btn">Check</Button></div>
      {res && <p className="mt-2 text-xs text-slate-500" data-testid="receipt-check-result">{res}</p>}
    </div>
  );
}

export default function BallotPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { data: e, isLoading, refetch } = useQuery({ queryKey: ["ballot", id], queryFn: async () => (await api.get(`/student/elections/${id}`)).data });
  const [sel, setSel] = useState({});
  const [step, setStep] = useState("select");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  if (isLoading) return <Loading />;
  const a = e.availability;
  const byPos = (pid) => e.candidates.filter((c) => c.position_id === pid);
  const toggle = (p, cid) => setSel((s) => {
    const cur = s[p.id] || [];
    if (p.max_selections === 1) return { ...s, [p.id]: [cid] };
    return { ...s, [p.id]: cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid] };
  });
  const problems = e.positions.filter((p) => !e.allow_abstain && !(sel[p.id] || []).length).map((p) => `Select a candidate for ${p.title}.`);

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/ballots", { election_id: id, selections: e.positions.map((p) => ({ position_id: p.id, candidate_ids: sel[p.id] || [] })) });
      setReceipt(data); setStep("done");
      qc.invalidateQueries({ queryKey: ["student-elections"] }); qc.invalidateQueries({ queryKey: ["participation"] });
    } catch (err) {
      setError(err.response ? errMsg(err) : "We could not confirm whether your ballot was recorded. Checking your participation status…");
      await refetch();
    } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <div className="max-w-3xl">
      <Link to="/app/student" className="mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-sky-600" data-testid="ballot-back-link"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-2xl font-bold text-navy sm:text-3xl" data-testid="ballot-title">{e.title}</h1><StatusBadge status={e.state} /></div>
      <p className="mt-2 text-sm text-slate-500">{fmt(e.opens_at)} – {fmt(e.closes_at)} ({e.timezone})</p>
      {e.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{e.description}</p>}
      <div className="mt-4 vs-card p-4 text-xs text-slate-500" data-testid="ballot-rules">
        <p className="font-medium text-slate-600">Rules</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {e.positions.map((p) => <li key={p.id}>{p.title}: choose up to {p.max_selections}{e.allow_abstain ? " (abstaining allowed)" : " (at least one required)"}</li>)}
          <li>One ballot per student. Accepted ballots cannot be changed.</li>
        </ul>
      </div>

      {step === "done" && receipt ? (
        <section className="mt-8 vs-card border-emerald-500/40 p-6" data-testid="ballot-accepted">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <h2 className="mt-3 font-display text-xl font-semibold">Ballot accepted</h2>
          <p className="mt-1 text-sm text-slate-600">The server confirmed your ballot was recorded at {fmt(receipt.accepted_at)}.</p>
          <p className="mt-4 text-xs text-slate-500">Your receipt code (shown only once — save it to check inclusion later; it does not reveal your choices):</p>
          <p className="vs-hash mt-1" data-testid="ballot-receipt">{receipt.receipt}</p>
          <ReceiptCheck electionId={id} />
        </section>
      ) : a.participated ? (
        <section className="mt-8 vs-card p-6" data-testid="ballot-already-recorded">
          <Lock className="h-6 w-6 text-sky-600" />
          <p className="mt-3 text-sm text-slate-700">Your ballot for this election was recorded on {fmt(a.participated_at)}.</p>
          <ErrorNote>{error}</ErrorNote>
          <ReceiptCheck electionId={id} />
        </section>
      ) : !a.can_vote ? (
        <section className="mt-8 vs-card p-6" data-testid="ballot-unavailable">
          <p className="text-sm text-amber-800">{a.reason || (e.state === "open" ? "Voting is not available right now." : `Voting is not available: this election is ${e.state}.`)}</p>
          <ErrorNote>{error}</ErrorNote>
          <h2 className="mt-6 font-display font-semibold">Candidates</h2>
          {e.positions.map((p) => <div key={p.id} className="mt-4 space-y-2"><p className="text-sm text-slate-500">{p.title}</p>{byPos(p.id).map((c) => <CandidateOption key={c.id} c={c} disabled selected={false} />)}{!byPos(p.id).length && <p className="text-xs text-slate-500">No approved candidates.</p>}</div>)}
        </section>
      ) : step === "select" ? (
        <section className="mt-8 space-y-8" data-testid="ballot-select-step">
          {e.positions.map((p) => {
            const cur = sel[p.id] || [];
            return (
              <fieldset key={p.id} className="space-y-3" data-testid={`ballot-position-${p.id}`}>
                <legend className="font-display text-lg font-semibold text-navy">{p.title} <span className="text-xs font-normal text-slate-500">· {cur.length}/{p.max_selections} selected</span></legend>
                {p.description && <p className="text-sm text-slate-500">{p.description}</p>}
                <div className="grid gap-3 sm:grid-cols-2">{byPos(p.id).map((c) => <CandidateOption key={c.id} c={c} multi={p.max_selections > 1} selected={cur.includes(c.id)} disabled={p.max_selections > 1 && !cur.includes(c.id) && cur.length >= p.max_selections} onToggle={() => toggle(p, c.id)} />)}</div>
                {e.allow_abstain && cur.length > 0 && <Button variant="ghost" size="sm" onClick={() => setSel({ ...sel, [p.id]: [] })} data-testid={`clear-position-${p.id}`}>Clear selection (abstain)</Button>}
              </fieldset>
            );
          })}
          {problems.length > 0 && <p className="text-sm text-amber-700" data-testid="ballot-validation">{problems[0]}</p>}
          <Button size="lg" disabled={problems.length > 0} onClick={() => setStep("review")} data-testid="ballot-review-btn">Review ballot</Button>
        </section>
      ) : (
        <section className="mt-8 vs-card p-6" data-testid="ballot-review-step">
          <h2 className="font-display text-lg font-semibold">Review your selections</h2>
          <dl className="mt-4 space-y-3">
            {e.positions.map((p) => (
              <div key={p.id} className="flex justify-between gap-4 border-b border-slate-200 pb-3 text-sm">
                <dt className="text-slate-500">{p.title}</dt>
                <dd className="text-right text-navy" data-testid={`review-${p.id}`}>{(sel[p.id] || []).map((cid) => e.candidates.find((c) => c.id === cid)?.full_name).join(", ") || "Abstain"}</dd>
              </div>
            ))}
          </dl>
          <ErrorNote testId="ballot-error">{error}</ErrorNote>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" className="border-slate-300 bg-transparent" onClick={() => setStep("select")} data-testid="ballot-edit-btn">Change selections</Button>
            <Button onClick={() => setConfirm(true)} disabled={busy} data-testid="ballot-submit-btn">Submit ballot</Button>
          </div>
        </section>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="border-slate-200 bg-white" data-testid="ballot-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your ballot?</AlertDialogTitle>
            <AlertDialogDescription>Once accepted, your ballot cannot be changed or withdrawn.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ballot-confirm-cancel">Go back</AlertDialogCancel>
            <AlertDialogAction onClick={(ev) => { ev.preventDefault(); submit(); }} disabled={busy} data-testid="ballot-confirm-submit">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm and submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
