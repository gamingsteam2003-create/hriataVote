import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt } from "@/lib/api";
import { DataTable, EmptyState, ErrorNote, Loading, PageHeader, Pager, StatusBadge } from "@/components/vs/common";

function ImportPanel() {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const upload = async () => {
    setBusy(true); setError(""); setResult(null);
    const fd = new FormData(); fd.append("file", file);
    try { setPreview((await api.post("/admin/registry/preview", fd)).data); setConfirm(false); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/admin/registry/commit", { preview_id: preview.preview_id, confirm: true });
      setResult(data.summary); setPreview(null); setFile(null);
      toast.success("Registry import committed");
      qc.invalidateQueries({ queryKey: ["registry"] }); qc.invalidateQueries({ queryKey: ["imports"] });
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="vs-card p-6" data-testid="registry-import-panel">
      <h2 className="font-display font-semibold">Import authorised registry (CSV)</h2>
      <p className="mt-1 text-sm text-slate-500">Required columns: <code className="text-sky-600">registration_number, full_name, department, semester</code>. Optional: <code className="text-sky-600">enrollment_status, email</code>. UTF-8, max 2 MB. Use only records supplied by an authorised college representative.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }} className="vs-input file:mr-3 file:rounded file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-navy" data-testid="csv-registry-file-input" />
        <Button disabled={!file || busy} onClick={upload} data-testid="registry-preview-btn">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />} Validate &amp; preview</Button>
      </div>
      <div className="mt-4"><ErrorNote testId="registry-error">{error}</ErrorNote></div>
      {result && <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700" data-testid="registry-import-result">Imported: {result.inserted} new, {result.updated} updated, {result.invalid_rows} invalid row(s) skipped. {result.rematched_requests} verification request(s) re-matched.</p>}
      {preview && (
        <div className="mt-6 space-y-4" data-testid="registry-preview">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[["Rows", preview.summary.total_rows], ["Valid", preview.summary.valid_rows], ["Invalid", preview.summary.invalid_rows], ["New", preview.summary.new], ["Updates", preview.summary.update]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{k}</div><div className="font-display text-xl font-semibold" data-testid={`preview-${k.toLowerCase()}`}>{v}</div></div>
            ))}
          </div>
          {preview.errors.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700" data-testid="registry-preview-errors">
              {preview.errors.map((e) => <div key={e.line}>Line {e.line} {e.registration_number && `(${e.registration_number})`}: {e.errors.join("; ")}</div>)}
            </div>
          )}
          {preview.rows.length > 0 && (
            <DataTable head={["Line", "Registration no.", "Name", "Department", "Sem", "Status", "Action"]} testId="registry-preview-table">
              {preview.rows.slice(0, 50).map((r) => (
                <tr key={r.registration_number}><td className="px-4 py-2 text-xs text-slate-500">{r.line}</td><td className="px-4 py-2 font-mono text-xs">{r.registration_number}</td><td className="px-4 py-2">{r.full_name}</td><td className="px-4 py-2">{r.department}</td><td className="px-4 py-2">{r.semester}</td><td className="px-4 py-2">{r.enrollment_status}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.action === "new" ? "approved" : r.action === "update" ? "pending" : "draft"} className="normal-case" /> <span className="text-xs text-slate-500">{r.action}{r.changes?.length ? `: ${r.changes.join(", ")}` : ""}</span>{r.warning && <div className="text-xs text-amber-700">{r.warning}</div>}</td></tr>
              ))}
            </DataTable>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="h-4 w-4 accent-sky-500" data-testid="registry-confirm-checkbox" /> I confirm these records were supplied by an authorised college representative.</label>
          <Button disabled={!confirm || busy || !preview.summary.valid_rows} onClick={commit} data-testid="registry-commit-btn">Commit {preview.summary.new + preview.summary.update} change(s)</Button>
        </div>
      )}
    </section>
  );
}

export default function Registry() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["registry", q, page], queryFn: async () => (await api.get("/admin/registry", { params: { q, page } })).data });
  const imports = useQuery({ queryKey: ["imports"], queryFn: async () => (await api.get("/admin/registry/imports")).data.items });
  const exportCsv = async () => {
    try {
      const res = await api.get("/admin/registry/export", { responseType: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(res.data); a.download = "votesecure_registry.csv"; a.click();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-8">
      <PageHeader title="Student registry" subtitle="The authoritative list used to verify student registrations."
        actions={<Button variant="outline" className="border-slate-300 bg-transparent" onClick={exportCsv} disabled={!data?.total} data-testid="registry-export-btn"><Download className="mr-2 h-4 w-4" /> Export (audited)</Button>} />
      <ImportPanel />
      <section>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-display font-semibold">Registry records {data && <span className="text-sm text-slate-500">({data.total})</span>}</h2>
          <input className="vs-input max-w-xs" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="registry-search-input" /></div>
        {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={Database} title="The student registry is empty." testId="registry-empty">Import a CSV supplied by your college to enable verification.</EmptyState> : (
          <>
            <DataTable head={["Registration no.", "Name", "Department", "Semester", "Enrollment", "Updated"]} testId="registry-table">
              {data.items.map((r) => <tr key={r.id}><td className="px-4 py-3 font-mono text-xs">{r.registration_number}</td><td className="px-4 py-3">{r.full_name}</td><td className="px-4 py-3">{r.department}</td><td className="px-4 py-3">{r.semester}</td><td className="px-4 py-3"><StatusBadge status={r.enrollment_status} /></td><td className="px-4 py-3 text-xs text-slate-500">{fmt(r.updated_at)}</td></tr>)}
            </DataTable>
            <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
      <section>
        <h2 className="mb-3 font-display font-semibold">Import history</h2>
        {!imports.data?.length ? <p className="text-sm text-slate-500">No imports yet.</p> : (
          <ul className="vs-card divide-y divide-slate-200 text-sm" data-testid="import-history">{imports.data.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 p-4"><span>{i.filename}</span><span className="text-xs text-slate-500">{i.summary.inserted} new · {i.summary.updated} updated · {i.summary.invalid_rows} invalid · {fmt(i.created_at)}</span></li>)}</ul>
        )}
      </section>
    </div>
  );
}
