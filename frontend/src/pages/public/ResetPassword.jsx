import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { ErrorNote, Field } from "@/components/vs/common";
import { AuthCard } from "@/pages/public/Login";

export default function ResetPassword() {
  const [f, setF] = useState({ identifier: "", token: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (f.new_password !== f.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try { await api.post("/auth/reset-password", { identifier: f.identifier, token: f.token.trim(), new_password: f.new_password }); setOk(true); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  if (ok) return (
    <AuthCard title="Password updated">
      <p className="text-sm text-slate-600" data-testid="reset-success">Your password has been reset and all previous sessions were signed out.</p>
      <Button asChild className="mt-6 w-full"><Link to="/login" data-testid="reset-go-login-btn">Sign in</Link></Button>
    </AuthCard>
  );
  return (
    <AuthCard title="Reset password" subtitle="Use the single-use token issued by your administrator.">
      <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
        <Field label="Email or registration number" htmlFor="rp-id"><input id="rp-id" className="vs-input" value={f.identifier} onChange={set("identifier")} required data-testid="reset-identifier-input" /></Field>
        <Field label="Reset token" htmlFor="rp-token"><input id="rp-token" className="vs-input font-mono" value={f.token} onChange={set("token")} required data-testid="reset-token-input" /></Field>
        <Field label="New password" htmlFor="rp-pw" hint="At least 10 characters with letters and numbers."><input id="rp-pw" type="password" className="vs-input" value={f.new_password} onChange={set("new_password")} required data-testid="reset-new-password-input" /></Field>
        <Field label="Confirm new password" htmlFor="rp-pw2"><input id="rp-pw2" type="password" className="vs-input" value={f.confirm} onChange={set("confirm")} required data-testid="reset-confirm-password-input" /></Field>
        <ErrorNote testId="reset-error">{error}</ErrorNote>
        <Button type="submit" className="w-full" disabled={busy} data-testid="reset-submit-btn">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Reset password</Button>
      </form>
    </AuthCard>
  );
}
