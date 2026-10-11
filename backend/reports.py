import hashlib
import hmac
import io

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from auth import require
from core import AUDIT_CHECKPOINT_KEY, ApiError, audit, canonical, db, iso, now, out, sha256
from elections import get_election

router = APIRouter(tags=["reports"])
reviewers = require("admin", "auditor")

NAVY = colors.HexColor("#0A1F44")
SKY = colors.HexColor("#0EA5E9")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#E11D48")
CREDIT = "Built and developed by Hriata_khuptong"


def sign_document(payload: dict):
    fingerprint = sha256(canonical(payload))
    signature = hmac.new(AUDIT_CHECKPOINT_KEY.encode(), fingerprint.encode(), hashlib.sha256).hexdigest()
    return fingerprint, signature


def _styles():
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=ss["Title"], textColor=NAVY, fontSize=20, spaceAfter=2, alignment=0),
        "kicker": ParagraphStyle("kicker", parent=ss["Normal"], textColor=SKY, fontSize=9, spaceAfter=10, leading=11),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=12, spaceAfter=4),
        "body": ParagraphStyle("body", parent=ss["Normal"], textColor=SLATE, fontSize=9.5, leading=14),
        "small": ParagraphStyle("small", parent=ss["Normal"], textColor=SLATE, fontSize=8, leading=11),
        "hash": ParagraphStyle("hash", parent=ss["Normal"], fontName="Courier", textColor=NAVY, fontSize=7.5, leading=10, wordWrap="CJK"),
        "cell": ParagraphStyle("cell", parent=ss["Normal"], textColor=SLATE, fontSize=9, leading=12),
        "cellh": ParagraphStyle("cellh", parent=ss["Normal"], textColor=colors.white, fontSize=9, leading=12),
    }


async def _actor_label(uid):
    if not uid:
        return "—"
    u = await db.users.find_one({"_id": uid}, {"email": 1})
    return u["email"] if u and u.get("email") else str(uid)


def _header(flow, st, kicker, title, e):
    flow.append(Paragraph("VoteSecure", st["kicker"]))
    flow.append(Paragraph(title, st["h1"]))
    flow.append(Paragraph(kicker, st["kicker"]))
    scope = "College-wide" if e.get("scope") == "college" else ", ".join(e.get("departments") or [])
    flow.append(Paragraph(f"<b>{e['title']}</b> &nbsp;·&nbsp; {e.get('academic_year', '')} &nbsp;·&nbsp; {scope}", st["body"]))
    flow.append(Spacer(1, 4))
    flow.append(HRFlowable(width="100%", thickness=1, color=LIGHT))


def _totals_flow(flow, st, totals):
    for p in totals:
        winners = set(p.get("winners") or [])
        flow.append(Paragraph(f"{p['title']} &nbsp;<font size=8 color='#94A3B8'>· up to {p['max_selections']} · {p.get('abstentions', 0)} abstention(s){' · tie at cut-off' if p.get('tie') else ''}</font>", st["h2"]))
        rows = [[Paragraph("Candidate", st["cellh"]), Paragraph("Department", st["cellh"]), Paragraph("Votes", st["cellh"]), Paragraph("Outcome", st["cellh"])]]
        if not p["candidates"]:
            rows.append([Paragraph("No approved candidates.", st["cell"]), "", "", ""])
        for c in p["candidates"]:
            elected = c["candidate_id"] in winners
            rows.append([
                Paragraph(c["full_name"], st["cell"]),
                Paragraph(c.get("department", ""), st["cell"]),
                Paragraph(str(c["votes"]), st["cell"]),
                Paragraph("<font color='#059669'><b>Elected</b></font>" if elected else "", st["cell"]),
            ])
        t = Table(rows, colWidths=[70 * mm, 55 * mm, 20 * mm, 25 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ]))
        flow.append(t)
        flow.append(Spacer(1, 6))


def _signature_block(flow, st, fingerprint, signature, issued_by, extra=None):
    flow.append(Spacer(1, 10))
    flow.append(HRFlowable(width="100%", thickness=1, color=LIGHT))
    flow.append(Paragraph("Document signature", st["h2"]))
    for label, value in (extra or []):
        flow.append(Paragraph(label, st["small"]))
        flow.append(Paragraph(value, st["hash"]))
        flow.append(Spacer(1, 2))
    flow.append(Paragraph("SHA-256 document fingerprint", st["small"]))
    flow.append(Paragraph(fingerprint, st["hash"]))
    flow.append(Spacer(1, 2))
    flow.append(Paragraph("HMAC-SHA256 signature (server checkpoint key)", st["small"]))
    flow.append(Paragraph(signature, st["hash"]))
    flow.append(Spacer(1, 6))
    flow.append(Paragraph(
        f"Issued {iso(now())} by {issued_by}. This signature is produced with the VoteSecure server's HMAC checkpoint key "
        "and proves the document was issued by this server and has not been altered. It is not an independent or third-party "
        "certification of the election.", st["small"]))
    flow.append(Spacer(1, 4))
    flow.append(Paragraph(CREDIT, st["small"]))


def _render(flow):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=16 * mm, leftMargin=18 * mm, rightMargin=18 * mm,
                            title="VoteSecure report", author=CREDIT)
    doc.build(flow)
    return buf.getvalue()


def _pdf_response(data: bytes, filename: str):
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _csv_cell(v) -> str:
    s = "" if v is None else str(v)
    if s and s[0] in "=+-@":
        s = "'" + s
    if any(ch in s for ch in [",", '"', "\n"]):
        s = '"' + s.replace('"', '""') + '"'
    return s


@router.get("/elections/{eid}/reconciliations/{rid}/report.pdf")
async def reconciliation_report_pdf(eid: str, rid: str, user=Depends(reviewers)):
    rec = await db.reconciliations.find_one({"_id": rid, "election_id": eid})
    if not rec:
        raise ApiError(404, "not_found", "Reconciliation report not found.")
    e = await get_election(eid)
    r = out(rec)
    payload = {"type": "reconciliation", "election_id": eid, "reconciliation_id": rid, "run_at": r["run_at"],
               "passed": r["passed"], "ballot_count": r["ballot_count"], "participation_count": r["participation_count"],
               "eligible_count": r["eligible_count"], "checks": r["checks"], "totals": r["totals"]}
    fingerprint, signature = sign_document(payload)
    st = _styles()
    flow = []
    status = "PASSED" if r["passed"] else "FAILED"
    _header(flow, st, f"Reconciliation report · {status}", "Reconciliation Report", e)
    flow.append(Spacer(1, 6))
    meta = Table([[Paragraph("<b>Run at</b>", st["cell"]), Paragraph(r["run_at"], st["cell"]),
                   Paragraph("<b>Run by</b>", st["cell"]), Paragraph(await _actor_label(rec.get("run_by")), st["cell"])],
                  [Paragraph("<b>Accepted ballots</b>", st["cell"]), Paragraph(str(r["ballot_count"]), st["cell"]),
                   Paragraph("<b>Participation</b>", st["cell"]), Paragraph(str(r["participation_count"]), st["cell"])],
                  [Paragraph("<b>Eligible voters</b>", st["cell"]), Paragraph(str(r["eligible_count"]), st["cell"]),
                   Paragraph("<b>Outcome</b>", st["cell"]),
                   Paragraph(f"<font color='{'#059669' if r['passed'] else '#E11D48'}'><b>{status}</b></font>", st["cell"])]],
                 colWidths=[33 * mm, 42 * mm, 33 * mm, 42 * mm])
    meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    flow.append(meta)
    flow.append(Paragraph("Integrity checks", st["h2"]))
    rows = [[Paragraph("Check", st["cellh"]), Paragraph("Result", st["cellh"]), Paragraph("Detail", st["cellh"])]]
    for c in r["checks"]:
        res = "<font color='#059669'><b>PASS</b></font>" if c["passed"] else "<font color='#E11D48'><b>FAIL</b></font>"
        rows.append([Paragraph(c["label"], st["cell"]), Paragraph(res, st["cell"]), Paragraph(c.get("detail") or "—", st["cell"])])
    ct = Table(rows, colWidths=[78 * mm, 20 * mm, 72 * mm])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ]))
    flow.append(ct)
    flow.append(Paragraph("Candidate totals", st["h2"]))
    _totals_flow(flow, st, r["totals"])
    _signature_block(flow, st, fingerprint, signature, await _actor_label(user["_id"]))
    await audit("report.downloaded", user["_id"], "election", eid, {"report": "reconciliation", "reconciliation_id": rid, "fingerprint": fingerprint})
    return _pdf_response(_render(flow), f"reconciliation-{eid}.pdf")


@router.get("/results/{eid}/report.pdf")
async def results_report_pdf(eid: str, user=Depends(reviewers)):
    res = await db.election_results.find_one({"election_id": eid})
    if not res:
        raise ApiError(404, "not_found", "No finalized results are available for this election.")
    e = await get_election(eid)
    r = out(res)
    payload = {"type": "results", "election_id": eid, "result_id": r["id"], "finalized_at": r["finalized_at"],
               "ballot_count": r["ballot_count"], "totals": r["totals"], "integrity_hash": r["integrity_hash"],
               "audit_head_hash": r["audit_head_hash"]}
    fingerprint, signature = sign_document(payload)
    st = _styles()
    flow = []
    _header(flow, st, "Official Election Results", "Finalized and signed results", e)
    flow.append(Spacer(1, 6))
    pub = f"Published {r['published_at']}" if r.get("published") else "Not published"
    meta = Table([[Paragraph("<b>Finalized at</b>", st["cell"]), Paragraph(r["finalized_at"], st["cell"]),
                   Paragraph("<b>Finalized by</b>", st["cell"]), Paragraph(await _actor_label(res.get("finalized_by")), st["cell"])],
                  [Paragraph("<b>Accepted ballots</b>", st["cell"]), Paragraph(str(r["ballot_count"]), st["cell"]),
                   Paragraph("<b>Publication</b>", st["cell"]), Paragraph(pub, st["cell"])]],
                 colWidths=[33 * mm, 42 * mm, 33 * mm, 42 * mm])
    meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    flow.append(meta)
    flow.append(Paragraph("Final candidate totals", st["h2"]))
    _totals_flow(flow, st, r["totals"])
    extra = [("Result integrity hash (recorded at finalization)", r["integrity_hash"]),
             ("Audit chain head at finalization", r["audit_head_hash"])]
    _signature_block(flow, st, fingerprint, signature, await _actor_label(user["_id"]), extra)
    await audit("report.downloaded", user["_id"], "election", eid, {"report": "results", "result_id": r["id"], "fingerprint": fingerprint})
    return _pdf_response(_render(flow), f"results-{eid}.pdf")


@router.get("/results/{eid}/report.csv")
async def results_report_csv(eid: str, user=Depends(reviewers)):
    res = await db.election_results.find_one({"election_id": eid})
    if not res:
        raise ApiError(404, "not_found", "No finalized results are available for this election.")
    e = await get_election(eid)
    r = out(res)
    lines = ["Position,Candidate,Department,Votes,Elected"]
    for p in r["totals"]:
        winners = set(p.get("winners") or [])
        for c in p["candidates"]:
            lines.append(",".join(_csv_cell(x) for x in [p["title"], c["full_name"], c.get("department", ""), c["votes"], "yes" if c["candidate_id"] in winners else "no"]))
        lines.append(",".join(_csv_cell(x) for x in [p["title"], "(abstentions)", "", p.get("abstentions", 0), ""]))
    fingerprint, signature = sign_document({"type": "results", "election_id": eid, "result_id": r["id"], "totals": r["totals"]})
    lines.append("")
    lines.append(_csv_cell(f"Election: {e['title']} ({e.get('academic_year', '')})"))
    lines.append(_csv_cell(f"Accepted ballots: {r['ballot_count']}  Finalized: {r['finalized_at']}"))
    lines.append(_csv_cell(f"SHA-256 fingerprint: {fingerprint}"))
    lines.append(_csv_cell(f"HMAC-SHA256 signature: {signature}"))
    lines.append(_csv_cell(CREDIT))
    await audit("report.downloaded", user["_id"], "election", eid, {"report": "results_csv", "result_id": r["id"], "fingerprint": fingerprint})
    return Response(content=("\r\n".join(lines)).encode(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="results-{eid}.csv"'})


class VerifyIn(BaseModel):
    fingerprint: str = Field(min_length=64, max_length=64)
    signature: str = Field(min_length=64, max_length=64)


@router.post("/reports/verify")
async def verify_signature(body: VerifyIn, user=Depends(reviewers)):
    expected = hmac.new(AUDIT_CHECKPOINT_KEY.encode(), body.fingerprint.encode(), hashlib.sha256).hexdigest()
    return {"valid": hmac.compare_digest(expected, body.signature.lower())}
