import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api, errMsg, fmt } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DataTable, EmptyState, ErrorNote, Field, Loading, PageHeader, ReasonDialog, StatusBadge } from "@/components/vs/common";

export function ResetTokenDialog({ target, onClose }) {
  const [token, setToken] = useState(null);
  const [error, setError] = useState("");
  const issue = async () => {
    setError("");
    try { setToken((await api.post(`/admin/users/${target.id}/reset-token`)).data); } catch (e) { setError(errMsg(e)); }
  };
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setToken(null); onClose(); } }}>
      <DialogContent className="border-slate-200 bg-white" data-testid="reset-token-dialog">
        <DialogHeader>
          <DialogTitle>Issue password-reset token</DialogTitle>
          <DialogDescription>{target?.label}. Confirm the person's identity first. The token is single-use, expires in 30 minutes, and invalidates earlier tokens.</DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="space-y-2" data-testid="reset-token-result">
            <p className="text-sm text-slate-600">Give this token to the user privately. It will not be shown again.</p>
            <p className="vs-hash" data-testid="reset-token-value">{token.token}</p>
            <p className="text-xs text-slate-500">Expires {fmt(token.expires_at)}</p>
          </div>
        ) : <Button onClick={issue} data-testid="reset-token-issue-btn"><KeyRound className="mr-2 h-4 w-4" /> Issue token</Button>}
        <ErrorNote>{error}</ErrorNote>
      </DialogContent>
    </Dialog>
  );
}

function CreateStaff({ onDone }) {
  const [f, setF] = useState({ email: "", name: "", role: "auditor", temporary_password: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError("");
    try { await api.post("/admin/users", f); toast.success("Staff account created; password change required at first sign-in"); setF({ email: "", name: "", role: "auditor", temporary_password: "" }); onDone(); }
    catch (err) { setError(errMsg(err)); }
  };
  return (
    <form onSubmit={submit} className="vs-card grid gap-4 p-6 md:grid-cols-5 md:items-end" data-testid="create-staff-form">
      <Field label="Name" htmlFor="st-name"><input id="st-name" className="vs-input" value={f.name} onChange={set("name")} required data-testid="staff-name-input" /></Field>
      <Field label="Email" htmlFor="st-email"><input id="st-email" type="email" className="vs-input" value={f.email} onChange={set("email")} required data-testid="staff-email-input" /></Field>
      <Field label="Role" htmlFor="st-role"><select id="st-role" className="vs-input" value={f.role} onChange={set("role")} data-testid="staff-role-select"><option value="admin">Administrator</option><option value="auditor">Auditor</option><option value="operator">System operator</option></select></Field>
      <Field label="Temporary password" htmlFor="st-pw"><input id="st-pw" type="password" className="vs-input" value={f.temporary_password} onChange={set("temporary_password")} required data-testid="staff-password-input" /></Field>
      <Button type="submit" data-testid="staff-create-btn">Create account</Button>
      <div className="md:col-span-5"><ErrorNote>{error}</ErrorNote></div>
    </form>
  );
}

export default function StaffUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [act, setAct] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["staff"], queryFn: async () => (await api.get("/admin/users")).data.items });
  const setStatus = async (reason) => {
    try { await api.post(`/admin/users/${act.id}/status`, { status: act.status === "active" ? "disabled" : "active", reason }); } catch (e) { throw new Error(errMsg(e)); }
    toast.success("Account status updated"); qc.invalidateQueries({ queryKey: ["staff"] });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Staff accounts" subtitle="Administrators, auditors and system operators. Public registration can never create these roles." />
      <CreateStaff onDone={() => qc.invalidateQueries({ queryKey: ["staff"] })} />
      {isLoading ? <Loading /> : !data.length ? <EmptyState icon={UserCog} title="No staff accounts." /> : (
        <DataTable head={["Account", "Role", "Status", "MFA", "Last sign-in", ""]} testId="staff-table">
          {data.map((u) => (
            <tr key={u.id} data-testid={`staff-row-${u.id}`}>
              <td className="px-4 py-3"><div>{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
              <td className="px-4 py-3 capitalize">{u.role}</td>
              <td className="px-4 py-3"><StatusBadge status={u.status} />{u.must_change_password && <div className="mt-1 text-xs text-amber-700">Password change pending</div>}</td>
              <td className="px-4 py-3 text-xs">{u.mfa_enabled ? "Enabled" : "Off"}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{fmt(u.last_login_at)}</td>
              <td className="px-4 py-3 text-right">{u.id !== user.id && <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setResetFor({ id: u.id, label: u.email })} data-testid={`staff-reset-btn-${u.id}`}>Reset token</Button>
                <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setAct(u)} data-testid={`staff-status-btn-${u.id}`}>{u.status === "active" ? "Disable" : "Enable"}</Button>
              </div>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      {act && <ReasonDialog open onOpenChange={(o) => !o && setAct(null)} danger={act.status === "active"} title={`${act.status === "active" ? "Disable" : "Enable"} ${act.email}`} description="All of this account's sessions will be signed out." onConfirm={setStatus} testId="staff-status-dialog" />}
      <ResetTokenDialog target={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}
