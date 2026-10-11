import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { EmptyState, ErrorNote, Field, Loading, ReasonDialog, StatusBadge } from "@/components/vs/common";
import { CandidatePhoto } from "@/components/vs/CandidatePhoto";
import { PhotoCropDialog } from "@/components/vs/PhotoCropDialog";

function NominateForm({ e, onDone }) {
  const [f, setF] = useState({ registration_number: "", position_id: e.positions[0]?.id, manifesto: "", biography: "" });
  const [error, setError] = useState("");
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const submit = async (ev) => {
    ev.preventDefault(); setError("");
    try { await api.post(`/elections/${e.id}/candidates`, f); toast.success("Nomination recorded"); setF({ ...f, registration_number: "", manifesto: "", biography: "" }); onDone(); }
    catch (err) { setError(errMsg(err)); }
  };
  return (
    <form onSubmit={submit} className="vs-card grid gap-4 p-6 md:grid-cols-2" data-testid="nominate-form">
      <h3 className="font-display font-semibold md:col-span-2">Nominate a verified student</h3>
      <Field label="Student registration number" htmlFor="nm-reg"><input id="nm-reg" className="vs-input font-mono uppercase" value={f.registration_number} onChange={set("registration_number")} required data-testid="nominate-reg-input" /></Field>
      <Field label="Position" htmlFor="nm-pos"><select id="nm-pos" className="vs-input" value={f.position_id} onChange={set("position_id")} data-testid="nominate-position-select">{e.positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
      <Field label="Manifesto" htmlFor="nm-man"><textarea id="nm-man" rows={3} className="vs-input" value={f.manifesto} onChange={set("manifesto")} data-testid="nominate-manifesto-input" /></Field>
      <Field label="Biography" htmlFor="nm-bio"><textarea id="nm-bio" rows={3} className="vs-input" value={f.biography} onChange={set("biography")} data-testid="nominate-bio-input" /></Field>
      <div className="md:col-span-2"><ErrorNote testId="nominate-error">{error}</ErrorNote></div>
      <Button type="submit" className="w-fit" data-testid="nominate-submit-btn"><UserPlus className="mr-2 h-4 w-4" /> Add nomination</Button>
    </form>
  );
}

function PhotoControls({ c, onDone }) {
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const pick = (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Upload a JPEG, PNG or WebP image.");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be 8 MB or smaller.");
    setCropFile(file);
  };
  const uploadBlob = async (blob) => {
    setBusy(true);
    const fd = new FormData(); fd.append("file", blob, "photo.jpg");
    try { await api.post(`/candidates/${c.id}/photo`, fd); toast.success("Photo uploaded"); onDone(); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await api.post(`/candidates/${c.id}/photo/remove`, { reason: "Photo removed by administrator" }); toast.success("Photo removed"); onDone(); }
    catch (err) { toast.error(errMsg(err)); }
  };
  return (
    <div className="flex flex-col items-center gap-1 text-xs">
      <label className={`cursor-pointer font-medium text-sky-600 hover:underline ${busy ? "opacity-50" : ""}`}>
        {busy ? "Uploading…" : c.photo_file_id ? "Replace photo" : "Upload photo"}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={pick} data-testid={`candidate-photo-input-${c.id}`} />
      </label>
      {c.photo_file_id && <button type="button" className="text-slate-500 hover:text-red-600" onClick={remove} data-testid={`candidate-photo-remove-${c.id}`}>Remove</button>}
      <PhotoCropDialog file={cropFile} open={!!cropFile} onOpenChange={(o) => !o && setCropFile(null)} onCropped={uploadBlob} />
    </div>
  );
}

export default function CandidatesTab({ e, isAdmin, reload }) {
  const qc = useQueryClient();
  const [act, setAct] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["candidates", e.id], queryFn: async () => (await api.get(`/elections/${e.id}/candidates`)).data.items });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["candidates", e.id] }); reload(); };
  const editable = isAdmin && e.state === "draft";
  const run = async (reason) => {
    try {
      if (act.op === "withdraw") await api.post(`/candidates/${act.c.id}/withdraw`, { reason });
      else await api.post(`/candidates/${act.c.id}/review`, { decision: act.op, reason });
    } catch (err) { throw new Error(errMsg(err)); }
    toast.success("Candidate updated"); refresh();
  };
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-6">
      {!editable && <p className="text-sm text-slate-500">Candidate records are locked once the election leaves draft.</p>}
      {editable && <NominateForm e={e} onDone={refresh} />}
      {e.positions.map((p) => {
        const list = data.filter((c) => c.position_id === p.id);
        return (
          <section key={p.id} data-testid={`candidates-position-${p.id}`}>
            <h3 className="mb-3 font-display font-semibold">{p.title}</h3>
            {!list.length ? <EmptyState title="No candidates for this position." testId={`candidates-empty-${p.id}`} /> : (
              <ul className="vs-card divide-y divide-slate-200">
                {list.map((c) => (
                  <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid={`candidate-row-${c.id}`}>
                    <div className="flex min-w-0 gap-4">
                    <div className="flex shrink-0 flex-col items-center gap-2">
                      <CandidatePhoto id={c.id} hasPhoto={!!c.photo_file_id} version={c.photo_file_id} name={c.full_name} />
                      {editable && c.status !== "withdrawn" && <PhotoControls c={c} onDone={refresh} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="font-medium">{c.full_name}</span><StatusBadge status={c.status} /></div>
                      <p className="font-mono text-xs text-slate-500">{c.registration_number} · {c.department} · Sem {c.semester}</p>
                      {c.manifesto && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{c.manifesto}</p>}
                      {c.review_reason && <p className="mt-1 text-xs text-slate-500">Note: {c.review_reason}</p>}
                    </div>
                    </div>
                    {editable && (
                      <div className="flex shrink-0 gap-2">
                        {c.status === "nominated" && <><Button size="sm" onClick={() => setAct({ c, op: "approve" })} data-testid={`candidate-approve-${c.id}`}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setAct({ c, op: "reject" })} data-testid={`candidate-reject-${c.id}`}>Reject</Button></>}
                        {c.status !== "withdrawn" && <Button size="sm" variant="ghost" onClick={() => setAct({ c, op: "withdraw" })} data-testid={`candidate-withdraw-${c.id}`}>Withdraw</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {act && <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} danger={act.op !== "approve"} minLength={act.op === "approve" ? 0 : act.op === "reject" ? 5 : 3}
        title={`${act.op[0].toUpperCase() + act.op.slice(1)} candidate`} description={`${act.c.full_name} — eligibility is re-checked by the server.`} onConfirm={run} testId="candidate-dialog" />}
    </div>
  );
}
