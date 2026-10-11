import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSearch } from "lucide-react";
import { api, fmt } from "@/lib/api";
import { DataTable, EmptyState, Loading, PageHeader, StatusBadge } from "@/components/vs/common";

export default function AuditorResults() {
  const { data, isLoading } = useQuery({ queryKey: ["all-results"], queryFn: async () => (await api.get("/results")).data.items });
  const cps = useQuery({ queryKey: ["checkpoints"], queryFn: async () => (await api.get("/audit/checkpoints")).data.items });
  return (
    <div className="space-y-10">
      <PageHeader title="Reconciliation & finalization" subtitle="Finalization records and signed audit checkpoints. Open an election to inspect its reconciliation reports." />
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Finalization history</h2>
        {isLoading ? <Loading /> : !data.length ? <EmptyState icon={FileSearch} title="No finalized results are available." testId="finalization-empty" /> : (
          <DataTable head={["Election", "Finalized", "Ballots", "Published", "Integrity hash"]} testId="finalization-table">
            {data.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><Link className="text-sky-700 hover:underline" to={`/app/elections/${r.election_id}`}>{r.title}</Link></td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmt(r.finalized_at)}</td>
                <td className="px-4 py-3 font-mono">{r.ballot_count}</td>
                <td className="px-4 py-3"><StatusBadge status={r.published ? "published" : "finalized"} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500" title={r.integrity_hash}>{r.integrity_hash.slice(0, 20)}…</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Signed audit checkpoints</h2>
        {!cps.data?.length ? <p className="text-sm text-slate-500">No checkpoints written yet.</p> : (
          <DataTable head={["Event #", "Written", "Chain hash", "HMAC signature"]} testId="checkpoints-table">
            {cps.data.map((c) => <tr key={c.id}><td className="px-4 py-3 font-mono">{c.seq}</td><td className="px-4 py-3 text-xs text-slate-500">{fmt(c.at)}</td><td className="px-4 py-3 font-mono text-[11px]">{c.hash.slice(0, 20)}…</td><td className="px-4 py-3 font-mono text-[11px] text-slate-500">{c.signature.slice(0, 20)}…</td></tr>)}
          </DataTable>
        )}
      </section>
    </div>
  );
}
