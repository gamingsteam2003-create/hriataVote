import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";
import { ErrorNote, Field, StatusBadge } from "@/components/vs/common";
import { AuthCard } from "@/pages/public/Login";

const schema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(100).regex(/^\p{L}[\p{L} .'’\u2018-]*$/u, "Letters, spaces, apostrophes or hyphens only"),
  registration_number: z.string().trim().min(3, "Required").max(30).regex(/^[A-Za-z0-9/\- ]+$/, "Letters, digits, / or - only"),
  department: z.string().trim().min(2, "Select your department").max(60),
  semester: z.coerce.number().int().min(1, "1–6").max(6, "1–6"),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  password: z.string().min(10, "At least 10 characters").max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number"),
  confirm_password: z.string(),
  accept_rules: z.literal(true, { errorMap: () => ({ message: "You must accept the rules" }) }),
}).refine((d) => d.password === d.confirm_password, { path: ["confirm_password"], message: "Passwords do not match" });

export default function Register() {
  const { data: depts = [] } = useQuery({ queryKey: ["departments"], queryFn: async () => (await api.get("/public/departments")).data.items });
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { accept_rules: false } });
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(null);

  const onSubmit = async (v) => {
    setServerError("");
    try {
      const { data } = await api.post("/students/register", { ...v, email: v.email || null });
      setDone(data);
    } catch (e) {
      (e?.response?.data?.error?.details || []).forEach((d) => d.field && setError(d.field, { message: d.msg }));
      setServerError(errMsg(e));
    }
  };

  if (done) return (
    <AuthCard title="Registration submitted">
      <div className="space-y-4 text-sm text-slate-600" data-testid="register-success">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        <p>{done.message}</p>
        <p className="flex items-center gap-2">Current status: <StatusBadge status={done.verification_status} testId="register-status-badge" /></p>
        <p className="text-slate-500">You can sign in now to follow your verification status. You can vote only after you are verified and included in an election's eligibility list.</p>
        <Button asChild className="w-full" data-testid="register-go-login-btn"><Link to="/login">Go to sign in</Link></Button>
      </div>
    </AuthCard>
  );

  const input = (name, props = {}) => <input id={name} className="vs-input" {...register(name)} data-testid={`register-${name.replace(/_/g, "-")}-input`} {...props} />;
  return (
    <AuthCard title="Create your account" subtitle="Use the details exactly as recorded by your college. Your account will be verified against the official student registry.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate data-testid="register-form">
        <Field label="Full name" htmlFor="full_name" error={errors.full_name?.message}>{input("full_name", { autoComplete: "name" })}</Field>
        <Field label="College registration / enrollment number" htmlFor="registration_number" error={errors.registration_number?.message}>{input("registration_number", { className: "vs-input font-mono uppercase" })}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department" htmlFor="department" error={errors.department?.message}>
            {depts.length ? (
              <select id="department" className="vs-input" {...register("department")} data-testid="register-department-select">
                <option value="">Select…</option>
                {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            ) : input("department", { placeholder: "e.g. BCA" })}
          </Field>
          <Field label="Semester" htmlFor="semester" error={errors.semester?.message}>
            <select id="semester" className="vs-input" {...register("semester")} data-testid="register-semester-select">
              <option value="">Select…</option>
              {Array.from({ length: 6 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Institutional email (optional)" htmlFor="email" error={errors.email?.message}>{input("email", { type: "email", autoComplete: "email" })}</Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters with letters and numbers.">{input("password", { type: "password", autoComplete: "new-password" })}</Field>
        <Field label="Confirm password" htmlFor="confirm_password" error={errors.confirm_password?.message}>{input("confirm_password", { type: "password", autoComplete: "new-password" })}</Field>
        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-sky-500" {...register("accept_rules")} data-testid="register-accept-rules-checkbox" />
          <span>I have read and accept the <Link to="/privacy" target="_blank" className="text-sky-600 underline">election and privacy rules</Link>.</span>
        </label>
        {errors.accept_rules && <p className="text-xs text-rose-600">{errors.accept_rules.message}</p>}
        <ErrorNote testId="register-error">{serverError}</ErrorNote>
        <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="register-submit-btn">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit registration
        </Button>
        <p className="text-center text-sm text-slate-500">Already registered? <Link to="/login" className="text-sky-600 hover:underline">Sign in</Link></p>
      </form>
    </AuthCard>
  );
}
