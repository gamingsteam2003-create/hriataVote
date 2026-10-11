import { useState } from "react";
import { Loader2, Inbox, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  blue: "bg-sky-50 text-sky-700 border-sky-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
};
const STATUS_TONE = {
  verified: "green", approved: "green", open: "green", accepted: "green", published: "cyan", finalized: "cyan", executed: "cyan",
  eligible: "green", active: "green", matched: "green", passed: "green",
  pending: "amber", under_review: "amber", nominated: "amber", scheduled: "blue", paused: "amber", awaiting_approval: "blue",
  reconciliation_pending: "amber", mismatch: "amber", not_found: "gray", draft: "gray", closed: "blue",
  rejected: "red", suspended: "red", cancelled: "red", disabled: "red", revoked: "red", reconciliation_failed: "red", withdrawn: "gray", failed: "red",
  high: "red", medium: "amber", low: "gray", info: "blue",
};

export function StatusBadge({ status, testId, className }) {
  if (!status) return null;
  const tone = TONES[STATUS_TONE[status] || "gray"];
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", tone, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {String(status).replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action, testId }) {
  return (
    <div data-testid={testId || "empty-state"} className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sky-50"><Icon className="h-6 w-6 text-sky-500" aria-hidden /></span>
      <p className="text-base font-semibold text-navy">{title}</p>
      {children && <p className="mx-auto max-w-md text-sm">{children}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy sm:text-3xl" data-testid="page-title">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const VALUE_TONE = { default: "text-navy", blue: "text-sky-600", green: "text-emerald-600", amber: "text-amber-600", red: "text-red-600" };

export function StatCard({ label, value, hint, testId, icon: Icon, tone = "default" }) {
  return (
    <div className="vs-card p-5 transition-shadow hover:shadow-md" data-testid={testId}>
      <div className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {Icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50"><Icon className="h-4 w-4 text-sky-600" aria-hidden /></span>}
      </div>
      <div className={cn("mt-2 text-3xl font-bold", VALUE_TONE[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export const Loading = ({ label = "Loading…" }) => (
  <div className="flex items-center gap-2 p-8 text-sm text-slate-500" data-testid="loading-indicator">
    <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> {label}
  </div>
);

export const ErrorNote = ({ children, testId = "error-note" }) =>
  children ? (
    <div role="alert" data-testid={testId} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{children}</span>
    </div>
  ) : null;

export function Pager({ page, size, total, onPage, testId = "pager" }) {
  const pages = Math.max(1, Math.ceil((total || 0) / size));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-slate-500" data-testid={testId}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</Button>
    </div>
  );
}

export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", minLength = 3, onConfirm, danger, children, testId = "reason-dialog" }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); setReason(""); onOpenChange(false); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white" data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="text-navy">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <div>
          <label className="vs-label" htmlFor="reason-input">Reason (recorded in the audit log)</label>
          <textarea id="reason-input" rows={3} className="vs-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-reason`} />
          {minLength > 0 && <p className="mt-1 text-xs text-slate-500">Minimum {minLength} characters.</p>}
        </div>
        <ErrorNote testId={`${testId}-error`}>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid={`${testId}-cancel`}>Cancel</Button>
          <Button variant={danger ? "destructive" : "default"} disabled={busy || reason.trim().length < minLength} onClick={submit} data-testid={`${testId}-confirm`}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, error, children, htmlFor, hint }) {
  return (
    <div>
      <label className="vs-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export const DataTable = ({ head, children, testId }) => (
  <div className="vs-card overflow-x-auto" data-testid={testId}>
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
        <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100 text-slate-700">{children}</tbody>
    </table>
  </div>
);
