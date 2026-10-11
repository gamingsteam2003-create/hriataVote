import { useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ErrorNote, Field, PageHeader } from "@/components/vs/common";
import { ChangePasswordForm } from "@/pages/account/ChangePassword";

function MfaPanel() {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const run = async (fn) => { setError(""); try { await fn(); } catch (e) { setError(errMsg(e)); } };

  if (user.mfa_enabled) return (
    <div className="space-y-4" data-testid="mfa-enabled-panel">
      <p className="flex items-center gap-2 text-sm text-emerald-600"><ShieldCheck className="h-4 w-4" /> Two-factor authentication is enabled.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Password" htmlFor="mfa-pw"><input id="mfa-pw" type="password" className="vs-input" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="mfa-disable-password-input" /></Field>
        <Field label="Current code" htmlFor="mfa-dc"><input id="mfa-dc" className="vs-input font-mono" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} data-testid="mfa-disable-code-input" /></Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button variant="destructive" onClick={() => run(async () => { await api.post("/auth/mfa/disable", { password: pw, code }); toast.success("MFA disabled"); refresh(); })} data-testid="mfa-disable-btn">Disable MFA</Button>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="mfa-setup-panel">
      <p className="flex items-center gap-2 text-sm text-amber-700"><ShieldAlert className="h-4 w-4" /> Two-factor authentication is not enabled. It is strongly recommended for staff accounts.</p>
      {!setup ? (
        <Button onClick={() => run(async () => setSetup((await api.post("/auth/mfa/setup")).data))} data-testid="mfa-start-btn">Set up authenticator app</Button>
      ) : (
        <div className="space-y-4">
          <img src={`data:image/png;base64,${setup.qr_png_base64}`} alt="Scan this QR code with your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" data-testid="mfa-qr" />
          <p className="text-xs text-slate-500">Or enter this key manually:</p>
          <p className="vs-hash" data-testid="mfa-secret">{setup.secret}</p>
          <Field label="6-digit code" htmlFor="mfa-code"><input id="mfa-code" className="vs-input max-w-[200px] font-mono tracking-[0.3em]" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} data-testid="mfa-code-input" /></Field>
          <Button onClick={() => run(async () => { await api.post("/auth/mfa/enable", { code }); toast.success("MFA enabled"); setSetup(null); setCode(""); refresh(); })} data-testid="mfa-enable-btn">Enable MFA</Button>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  return (
    <div>
      <PageHeader title="Account settings" subtitle="Manage your password and sign-in security." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="vs-card p-6">
          <h2 className="mb-1 font-display text-lg font-semibold">Account</h2>
          <dl className="mb-6 space-y-1 text-sm text-slate-500" data-testid="settings-account-info">
            <div>Email: <span className="text-slate-700">{user.email || "—"}</span></div>
            {user.student && <div>Registration number: <span className="font-mono text-slate-700">{user.student.registration_number}</span> <span className="text-xs">(cannot be changed)</span></div>}
          </dl>
          <h3 className="mb-4 font-display font-semibold">Change password</h3>
          <ChangePasswordForm />
        </section>
        {user.role !== "student" && (
          <section className="vs-card p-6"><h2 className="mb-4 font-display text-lg font-semibold">Two-factor authentication</h2><MfaPanel /></section>
        )}
      </div>
    </div>
  );
}
