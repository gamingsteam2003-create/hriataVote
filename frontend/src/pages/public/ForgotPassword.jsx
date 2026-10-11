import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/pages/public/Login";

export default function ForgotPassword() {
  return (
    <AuthCard title="Password recovery" subtitle="Email delivery is not enabled for this deployment.">
      <div className="space-y-4 text-sm text-slate-600" data-testid="forgot-password-info">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Contact your college election administrator in person or through an official channel.</li>
          <li>After confirming your identity, the administrator issues a single-use reset token that expires in 30 minutes.</li>
          <li>Enter the token with your email or registration number on the reset page to choose a new password.</li>
        </ol>
        <p className="text-slate-500">Resetting your password signs you out of every device.</p>
        <Button asChild className="w-full" data-testid="forgot-go-reset-btn"><Link to="/reset-password">I have a reset token</Link></Button>
      </div>
    </AuthCard>
  );
}
