import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { useAuth, ROLE_HOME } from "@/context/AuthContext";
import { ErrorNote, Field } from "@/components/vs/common";
import { Logo } from "@/components/vs/Layout";

export function ChangePasswordForm({ onDone }) {
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (f.new_password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: f.current_password, new_password: f.new_password });
      setF({ current_password: "", new_password: "", confirm: "" });
      toast.success("Password changed. Other sessions were signed out.");
      onDone?.();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="change-password-form">
      <Field label="Current password" htmlFor="cp-cur"><input id="cp-cur" type="password" autoComplete="current-password" className="vs-input" value={f.current_password} onChange={set("current_password")} required data-testid="cp-current-input" /></Field>
      <Field label="New password" htmlFor="cp-new" hint="At least 10 characters with letters and numbers."><input id="cp-new" type="password" autoComplete="new-password" className="vs-input" value={f.new_password} onChange={set("new_password")} required data-testid="cp-new-input" /></Field>
      <Field label="Confirm new password" htmlFor="cp-conf"><input id="cp-conf" type="password" autoComplete="new-password" className="vs-input" value={f.confirm} onChange={set("confirm")} required data-testid="cp-confirm-input" /></Field>
      <ErrorNote testId="cp-error">{error}</ErrorNote>
      <Button type="submit" disabled={busy} data-testid="cp-submit-btn">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Change password</Button>
    </form>
  );
}

export default function ChangePassword() {
  const { refresh, user } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Logo />
      <h1 className="mt-10 font-display text-2xl font-bold text-navy">Change your password</h1>
      <p className="mt-2 text-sm text-slate-500">{user?.must_change_password ? "A password change is required before you can continue." : "Update your password."}</p>
      <div className="mt-8 vs-card p-6">
        <ChangePasswordForm onDone={async () => { const u = await refresh(); navigate(ROLE_HOME[u?.role] || "/login", { replace: true }); }} />
      </div>
    </div>
  );
}
