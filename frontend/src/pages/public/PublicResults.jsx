import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { api, fmt } from "@/lib/api";
import { EmptyState, Loading } from "@/components/vs/common";

export function PositionTotals({ position }) {
  const max = Math.max(1, ...position.candidates.map((c) => c.votes));
  return (
    <div className="space-y-3" data-testid={`result-position-${position.position_id}`}>
      <div className="flex items-baseline justify-between">
        <h4 className="font-display font-semibold text-navy">{position.title}</h4>
        <span className="text-xs text-slate-500">{position.abstentions} abstention(s){position.tie ? " · Tie at cut-off" : ""}</span>
      </div>
      {position.candidates.length === 0 && <p className="text-sm text-slate-500">No approved candidates.</p>}
      {position.candidates.map((c) => (
        <div key={c.candidate_id}>
          <div className="flex justify-between text-sm">
            <span className={position.winners.includes(c.candidate_id) ? "font-semibold text-sky-700" : "text-slate-600"}>
              {c.full_name} <span className="text-xs text-slate-500">· {c.department}</span>
              {position.winners.includes(c.candidate_id) && <span className="ml-2 text-xs text-emerald-600">Elected</span>}
            </span>
            <span className="font-mono text-slate-700">{c.votes}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-sky-500/80" style={{ width: `${(c.votes / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function PublicResults({ embedded }) {
  const { data, isLoading } = useQuery({ queryKey: ["public-results"], queryFn: async () => (await api.get("/results/public")).data.items });
  return (
    <div className={embedded ? "" : "mx-auto max-w-4xl px-6 py-16"} data-testid="public-results-page">
      <h1 className="font-display text-3xl font-bold text-navy sm:text-4xl">Published results</h1>
      <p className="mt-2 text-sm text-slate-500">Only results that have passed reconciliation, been finalised and been published are shown.</p>
      <div className="mt-10 space-y-6">
        {isLoading ? <Loading /> : !data?.length ? (
          <EmptyState icon={Trophy} title="No finalized results are available." testId="results-empty" />
        ) : data.map((r) => (
          <article key={r.election_id} className="vs-card space-y-6 p-6" data-testid={`result-${r.election_id}`}>
            <header>
              <h3 className="font-display text-xl font-semibold text-navy">{r.title}</h3>
              <p className="text-xs text-slate-500">{r.academic_year} · {r.ballot_count} ballot(s) · finalised {fmt(r.finalized_at)}</p>
            </header>
            {r.totals.map((p) => <PositionTotals key={p.position_id} position={p} />)}
            <div><p className="mb-1 text-xs text-slate-500">Integrity hash</p><p className="vs-hash">{r.integrity_hash}</p></div>
          </article>
        ))}
      </div>
    </div>
  );
}
