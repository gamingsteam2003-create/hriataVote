import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errMsg, toLocalInput } from "@/lib/api";
import { ErrorNote, Field } from "@/components/vs/common";

const schema = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(120),
  description: z.string().max(2000).optional(),
  election_type: z.enum(["general", "department", "representative", "club", "other"]),
  academic_year: z.string().regex(/^\d{4}-\d{2,4}$/, "Format: 2025-26"),
  scope: z.enum(["college", "department"]),
  departments: z.array(z.string()),
  extra_departments: z.string().optional(),
  semesters: z.array(z.string()),
  opens_at: z.string().min(1, "Required"),
  closes_at: z.string().min(1, "Required"),
  timezone: z.string().min(1),
  positions: z.array(z.object({ id: z.string().optional().nullable(), title: z.string().trim().min(2, "Required").max(80), max_selections: z.coerce.number().int().min(1).max(10), description: z.string().max(300).optional() })).min(1, "Add a position"),
  policy: z.object({ require_two_person: z.boolean(), allow_extension: z.boolean(), allow_abstain: z.boolean(), one_nomination_per_student: z.boolean(), disclosure: z.enum(["public_after_publication", "restricted"]) }),
  nomination_rules: z.string().max(2000).optional(),
}).refine((d) => new Date(d.closes_at) > new Date(d.opens_at), { path: ["closes_at"], message: "Closing must be after opening" })
  .refine((d) => d.scope === "college" || d.departments.length || (d.extra_departments || "").trim(), { path: ["departments"], message: "Select at least one department" });

const toDefaults = (e) => e ? {
  ...e, description: e.description || "", nomination_rules: e.nomination_rules || "", departments: e.departments, extra_departments: "",
  semesters: e.semesters.map(String), opens_at: toLocalInput(e.opens_at), closes_at: toLocalInput(e.closes_at),
} : {
  title: "", description: "", election_type: "general", academic_year: "", scope: "college", departments: [], extra_departments: "", semesters: [],
  opens_at: "", closes_at: "", timezone: "Asia/Kolkata", positions: [{ title: "", max_selections: 1, description: "" }], nomination_rules: "",
  policy: { require_two_person: false, allow_extension: false, allow_abstain: false, one_nomination_per_student: true, disclosure: "public_after_publication" },
};

const POLICY = [["require_two_person", "Require two-person approval to open and finalize"], ["allow_extension", "Allow controlled extension of closing time"], ["allow_abstain", "Allow voters to abstain on a position"], ["one_nomination_per_student", "One nomination per student in this election"]];

export default function ElectionForm({ open, onOpenChange, election, onSaved }) {
  const { data: depts = [] } = useQuery({ queryKey: ["departments"], queryFn: async () => (await api.get("/public/departments")).data.items });
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(election) });
  const { fields, append, remove } = useFieldArray({ control, name: "positions" });
  const [error, setError] = useState("");
  const scope = watch("scope");

  const onSubmit = async (v) => {
    setError("");
    const extra = (v.extra_departments || "").split(",").map((s) => s.trim()).filter(Boolean);
    const { extra_departments, ...rest } = v;
    const body = {
      ...rest, departments: v.scope === "department" ? [...v.departments, ...extra] : [], semesters: v.semesters.map(Number),
      opens_at: new Date(v.opens_at).toISOString(), closes_at: new Date(v.closes_at).toISOString(),
      positions: v.positions.map((p) => ({ ...(p.id ? { id: p.id } : {}), title: p.title, max_selections: p.max_selections, description: p.description || "" })),
    };
    try {
      const { data } = election ? await api.put(`/elections/${election.id}`, body) : await api.post("/elections", body);
      onSaved(data); onOpenChange(false);
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-slate-200 bg-white" data-testid="election-form-dialog">
        <DialogHeader><DialogTitle className="font-display">{election ? "Edit draft election" : "Create election"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate data-testid="election-form">
          <Field label="Title" htmlFor="el-title" error={errors.title?.message}><input id="el-title" className="vs-input" {...register("title")} data-testid="election-title-input" /></Field>
          <Field label="Description" htmlFor="el-desc"><textarea id="el-desc" rows={3} className="vs-input" {...register("description")} data-testid="election-description-input" /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" htmlFor="el-type"><select id="el-type" className="vs-input" {...register("election_type")} data-testid="election-type-select">{["general", "department", "representative", "club", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Academic year" htmlFor="el-year" error={errors.academic_year?.message}><input id="el-year" placeholder="2025-26" className="vs-input" {...register("academic_year")} data-testid="election-year-input" /></Field>
            <Field label="Scope" htmlFor="el-scope"><select id="el-scope" className="vs-input" {...register("scope")} data-testid="election-scope-select"><option value="college">College-wide</option><option value="department">Specific departments</option></select></Field>
          </div>
          {scope === "department" && (
            <Field label="Eligible departments" error={errors.departments?.message}>
              <div className="flex flex-wrap gap-3">{depts.map((d) => <label key={d} className="flex items-center gap-2 text-sm"><input type="checkbox" value={d} {...register("departments")} className="accent-sky-500" data-testid={`election-dept-${d}`} />{d}</label>)}</div>
              <input className="vs-input mt-2" placeholder="Other departments (comma-separated)" {...register("extra_departments")} data-testid="election-extra-depts-input" />
            </Field>
          )}
          <Field label="Eligible semesters (none selected = all)">
            <div className="flex flex-wrap gap-3">{Array.from({ length: 12 }, (_, i) => String(i + 1)).map((s) => <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" value={s} {...register("semesters")} className="accent-sky-500" data-testid={`election-sem-${s}`} />{s}</label>)}</div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Opens (your local time)" htmlFor="el-open" error={errors.opens_at?.message}><input id="el-open" type="datetime-local" className="vs-input" {...register("opens_at")} data-testid="election-opens-input" /></Field>
            <Field label="Closes (your local time)" htmlFor="el-close" error={errors.closes_at?.message}><input id="el-close" type="datetime-local" className="vs-input" {...register("closes_at")} data-testid="election-closes-input" /></Field>
            <Field label="Election timezone" htmlFor="el-tz"><input id="el-tz" className="vs-input" {...register("timezone")} data-testid="election-timezone-input" /></Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="vs-label mb-0">Positions</span><Button type="button" size="sm" variant="outline" className="bg-transparent" onClick={() => append({ title: "", max_selections: 1, description: "" })} data-testid="add-position-btn"><Plus className="mr-1 h-4 w-4" /> Add</Button></div>
            <div className="space-y-3">{fields.map((f, i) => (
              <div key={f.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_120px_1fr_auto]" data-testid={`position-row-${i}`}>
                <input className="vs-input" placeholder="Title (e.g. President)" {...register(`positions.${i}.title`)} data-testid={`position-title-${i}`} />
                <input type="number" min={1} max={10} className="vs-input" aria-label="Maximum selections" {...register(`positions.${i}.max_selections`)} data-testid={`position-max-${i}`} />
                <input className="vs-input" placeholder="Description (optional)" {...register(`positions.${i}.description`)} />
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} disabled={fields.length === 1} aria-label="Remove position"><Trash2 className="h-4 w-4" /></Button>
                {errors.positions?.[i]?.title && <p className="text-xs text-rose-600 sm:col-span-4">{errors.positions[i].title.message}</p>}
              </div>
            ))}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">{POLICY.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" {...register(`policy.${k}`)} className="h-4 w-4 accent-sky-500" data-testid={`policy-${k}`} />{l}</label>)}</div>
          <Field label="Result disclosure policy" htmlFor="el-disc"><select id="el-disc" className="vs-input" {...register("policy.disclosure")} data-testid="policy-disclosure-select"><option value="public_after_publication">Public after finalization and publication</option><option value="restricted">Restricted to administrators and auditors</option></select></Field>
          <Field label="Nomination rules" htmlFor="el-nom"><textarea id="el-nom" rows={2} className="vs-input" {...register("nomination_rules")} /></Field>
          <ErrorNote testId="election-form-error">{error}</ErrorNote>
          <Button type="submit" disabled={isSubmitting} data-testid="election-save-btn">{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {election ? "Save changes" : "Create draft"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
