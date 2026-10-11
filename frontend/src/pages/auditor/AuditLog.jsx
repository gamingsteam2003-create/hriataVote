import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText, ShieldCheck, ShieldX, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmt } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, Pager } from "@/components/vs/common";

function VerifyPanel() {
  const qc = useQueryClient();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => { setBusy(true); try { setRes((await api.post("/audit/verify")).data); qc.invalidateQueries({ queryKey: ["audit"] }); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const checkpoint = async () => { try { await api.post("/audit/checkpoints"); toast.success("Signed checkpoint written"); qc.invalidateQueries({ queryKey: ["checkpoints"] }); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <section className="vs-card space-y-4 p-6" data-testid="integrity-panel">
      <div className="flex flex-wrap gap-2">
        <Button onClick={verify} disabled={busy} data-testid="hash-integrity-verify-btn">Verify audit-chain integrity</Button>
        <Button variant="outline" className="bg-transparent" onClick={checkpoint} data-testid="create-checkpoint-btn"><Stamp className="mr-2 h-4 w-4" /> Write signed checkpoint</Button>
      </div>
      {res && (res.ok ? (
        <p className="flex items-center gap-2 text-sm text-emerald-600" data-testid="integrity-result-ok"><ShieldCheck className="h-5 w-5" /> {res.checked} events verified. Chain and external checkpoints are consistent.</p>
      ) : (
        <div className="text-sm text-rose-600" data-testid="integrity-result-fail"><p className="flex items-center gap-2"><ShieldX className="h-5 w-5" /> Inconsistency detected at event #{res.first_inconsistency.seq}</p><p className="mt-1 text-xs">{res.first_inconsistency.problem}</p></div>
      ))}
      <p className="text-xs text-slate-500">The chain is tamper-evident, not tamper-proof: someone with full database and signing-key access could rebuild it. Compare checkpoints stored outside the database to detect such rewrites.</p>
    </section>
  );
}

export default function AuditLog() {
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["audit", type, page], queryFn: async () => (await api.get("/audit/events", { params: { event_type: type, page } })).data });
  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" subtitle="Append-only, SHA-256 hash-linked record of administrative actions. Ballot choices, passwords and tokens are never recorded." />
      <VerifyPanel />
      <input className="vs-input sm:w-72" placeholder="Filter by event type prefix, e.g. election." value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} data-testid="audit-type-filter" />
      {isLoading ? <Loading /> : !data.items.length ? <EmptyState icon={ScrollText} title="No audit events have been recorded." testId="audit-empty" /> : (
        <>
          <DataTable head={["#", "Time", "Event", "Actor", "Target", "Metadata", "Hash"]} testId="audit-table">
            {data.items.map((ev) => (
              <tr key={ev.id} className="align-top" data-testid={`audit-row-${ev.seq}`}>
                <td className="px-4 py-3 font-mono text-xs">{ev.seq}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmt(ev.ts)}</td>
                <td className="px-4 py-3 font-mono text-xs text-sky-700">{ev.event_type}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{String(ev.actor_id).slice(0, 8)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{ev.target_type}{ev.target_id ? ` ${String(ev.target_id).slice(0, 8)}` : ""}</td>
                <td className="max-w-[260px] px-4 py-3 font-mono text-[11px] text-slate-500"><span className="line-clamp-3 break-all">{JSON.stringify(ev.meta)}</span></td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500" title={ev.hash}>{ev.hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </DataTable>
          <Pager page={page} size={data.size} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
