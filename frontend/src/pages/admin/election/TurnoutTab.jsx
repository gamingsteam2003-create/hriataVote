import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState, Loading, StatCard } from "@/components/vs/common";
import { chartTooltip } from "@/pages/admin/AdminOverview";

export default function TurnoutTab({ e }) {
  const { data, isLoading } = useQuery({ queryKey: ["turnout", e.id], queryFn: async () => (await api.get(`/analytics/elections/${e.id}/turnout`)).data, refetchInterval: 20000 });
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-6" data-testid="turnout-tab">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Eligible" value={data.eligible} testId="turnout-eligible" />
        <StatCard label="Participated" value={data.participated} testId="turnout-participated" />
        <StatCard label="Turnout" value={`${data.turnout_pct}%`} testId="turnout-pct" />
      </div>
      <p className="text-xs text-slate-500">Turnout counts participation only. Candidate totals are never shown before the election closes.</p>
      {!data.by_department.length ? <EmptyState icon={BarChart3} title="No eligibility data yet." testId="turnout-dept-empty" /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="vs-card p-5"><h4 className="mb-3 text-sm font-medium text-slate-600">Turnout by department</h4>
            <ResponsiveContainer width="100%" height={240}><BarChart data={data.by_department}><CartesianGrid stroke="#E2E8F0" vertical={false} /><XAxis dataKey="department" stroke="#64748B" fontSize={11} /><YAxis stroke="#64748B" fontSize={11} unit="%" domain={[0, 100]} /><Tooltip {...chartTooltip} /><Bar dataKey="turnout_pct" name="Turnout %" fill="#0EA5E9" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <div className="vs-card p-5"><h4 className="mb-3 text-sm font-medium text-slate-600">Ballots accepted per hour (UTC)</h4>
            {!data.by_hour.length ? <p className="text-sm text-slate-500">No ballots accepted yet.</p> : <ResponsiveContainer width="100%" height={240}><LineChart data={data.by_hour}><CartesianGrid stroke="#E2E8F0" vertical={false} /><XAxis dataKey="hour" stroke="#64748B" fontSize={10} /><YAxis stroke="#64748B" fontSize={11} allowDecimals={false} /><Tooltip {...chartTooltip} /><Line dataKey="count" name="Ballots" stroke="#0A1F44" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>}</div>
        </div>
      )}
    </div>
  );
}
