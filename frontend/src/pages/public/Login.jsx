import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg, setCsrfToken } from "@/lib/api";
import { useAuth, ROLE_HOME } from "@/context/AuthContext";
import { ErrorNote, Field } from "@/components/vs/common";
import { Logo } from "@/components/vs/Layout";

export const AuthCard = ({ title, subtitle, children }) => (
  <div className="mx-auto max-w-md px-4 py-14 vs-rise">
    <div className="vs-card p-6 sm:p-8">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>

      <h1 className="text-center text-2xl font-bold text-navy">
        {title}
      </h1>

      {subtitle && (
        <p className="mt-2 text-center text-sm text-slate-500">
          {subtitle}
        </p>
      )}

      <div className="mt-8">{children}</div>
    </div>
  </div>
);

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    identifier: "",
    password: "",
    code: "",
  });

  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const done = async (user) => {
    try {
      const { data } = await api.get("/auth/csrf");

      if (!data?.csrf_token) {
        throw new Error("The security token was not returned.");
      }

      setCsrfToken(data.csrf_token);
      setUser(user);

      navigate(
        user.must_change_password
          ? "/app/change-password"
          : ROLE_HOME[user.role],
        { replace: true }
      );
    } catch (err) {
      setCsrfToken(null);
      setError(errMsg(err));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (challenge) {
        const { data } = await api.post("/auth/mfa/login", {
          challenge_id: challenge,
          code: form.code,
        });

        await done(data.user);
        return;
      }

      const { data } = await api.post("/auth/login", {
        identifier: form.identifier,
        password: form.password,
      });

      if (data.mfa_required) {
        setChallenge(data.challenge_id);
      } else {
        await done(data.user);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in with your registration number or email. Staff use their email."
    >
      <form
        onSubmit={submit}
        className="space-y-5"
        data-testid="login-form"
      >
        {!challenge ? (
          <>
            <Field
              label="Email or registration number"
              htmlFor="identifier"
            >
              <input
                id="identifier"
                autoComplete="username"
                className="vs-input"
                value={form.identifier}
                onChange={set("identifier")}
                required
                data-testid="login-identifier-input"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="vs-input"
                value={form.password}
                onChange={set("password")}
                required
                data-testid="login-password-input"
              />
            </Field>
          </>
        ) : (
          <Field
            label="Authenticator code"
            htmlFor="code"
            hint="Enter the 6-digit code from your authenticator app."
          >
            <input
              id="code"
              inputMode="numeric"
              maxLength={6}
              className="vs-input font-mono tracking-[0.4em]"
              value={form.code}
              onChange={set("code")}
              required
              data-testid="login-mfa-code-input"
            />
          </Field>
        )}

        <ErrorNote testId="login-error">{error}</ErrorNote>

        <Button
          type="submit"
          className="w-full"
          disabled={busy}
          data-testid="login-submit-btn"
        >
          {busy && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {challenge ? "Verify code" : "Sign in"}
        </Button>

        <div className="flex justify-between text-sm">
          <Link
            to="/forgot-password"
            className="text-slate-500 hover:text-sky-600"
            data-testid="login-forgot-link"
          >
            Forgot password?
          </Link>

          <Link
            to="/register"
            className="text-sky-600 hover:underline"
            data-testid="login-register-link"
          >
            Create student account
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}
