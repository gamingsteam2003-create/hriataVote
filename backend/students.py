import csv
import io
import os
import re
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import Field
from pymongo import UpdateOne
from pymongo.errors import DuplicateKeyError

from auth import Strict, check_strength, hash_password, require
from core import (ApiError, DEPT_RE, REG_RE, audit, client_ip, db, new_id, norm_dept, norm_name, norm_reg, now, out,
                  paginate, rate_limit, valid_name)

router = APIRouter(tags=["students"])
admin_only = require("admin")
REQUIRED_COLS = {"registration_number", "full_name", "department", "semester"}
ENROLLMENT = {"active", "inactive", "graduated", "withdrawn"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")
REGISTER_LIMIT = int(os.environ.get("REGISTER_RATE_LIMIT", "10"))


class RegisterIn(Strict):
    full_name: str = Field(max_length=100)
    registration_number: str = Field(max_length=30)
    department: str = Field(max_length=60)
    semester: int = Field(ge=1, le=6)
    email: Optional[str] = Field(default=None, max_length=120)
    password: str = Field(max_length=128)
    confirm_password: str = Field(max_length=128)
    accept_rules: bool


class DecisionIn(Strict):
    decision: Literal["approve", "reject"]
    reason: str = Field(default="", max_length=500)


class ReasonIn(Strict):
    reason: str = Field(min_length=3, max_length=500)


class CommitIn(Strict):
    preview_id: str = Field(max_length=64)
    confirm: bool


async def match_registry(st: dict):
    reg = await db.registry.find_one({"registration_number": st["registration_number"]})
    if not reg:
        return "not_found", []
    mism = []
    if norm_name(reg["full_name"]) != norm_name(st["full_name"]):
        mism.append("full_name")
    if reg["department"] != st["department"]:
        mism.append("department")
    if reg["semester"] != st["semester"]:
        mism.append("semester")
    if reg.get("enrollment_status", "active") != "active":
        mism.append("enrollment_status")
    return ("matched" if not mism else "mismatch"), mism


async def apply_match(st: dict):
    result, fields = await match_registry(st)
    status = "pending" if result == "not_found" else "under_review"
    upd = {"verification_status": status, "registry_match": result, "mismatch_fields": fields, "updated_at": now()}
    await db.students.update_one({"_id": st["_id"]}, {"$set": upd})
    await db.verification_requests.update_one({"user_id": st["_id"], "status": {"$in": ["pending", "under_review"]}},
                                              {"$set": {"status": status, "match_result": result, "mismatch_fields": fields}})
    return status


async def rematch_open_requests():
    n = 0
    async for st in db.students.find({"verification_status": {"$in": ["pending", "under_review"]}}):
        await apply_match(st)
        n += 1
    return n


@router.get("/public/departments")
async def departments():
    return {"items": sorted(await db.registry.distinct("department"))}


@router.post("/students/register", status_code=201)
async def register(body: RegisterIn, request: Request):
    await rate_limit(f"register_ip:{client_ip(request)}", REGISTER_LIMIT, 3600)
    reg, dept, name = norm_reg(body.registration_number), norm_dept(body.department), " ".join(body.full_name.split())
    email = body.email.strip().lower() if body.email else None
    errors = []
    if not valid_name(name):
        errors.append({"field": "full_name", "msg": "Use letters, spaces, apostrophes or hyphens only (no digits or symbols)."})
    if not REG_RE.match(reg):
        errors.append({"field": "registration_number", "msg": "Registration number must be 3-30 letters, digits, '/' or '-'."})
    if not DEPT_RE.match(dept):
        errors.append({"field": "department", "msg": "Enter a valid department."})
    if email and not EMAIL_RE.match(email):
        errors.append({"field": "email", "msg": "Enter a valid email address."})
    if body.password != body.confirm_password:
        errors.append({"field": "confirm_password", "msg": "Passwords do not match."})
    if not body.accept_rules:
        errors.append({"field": "accept_rules", "msg": "You must accept the election and privacy rules."})
    if errors:
        raise ApiError(422, "validation_error", "Please correct the highlighted fields.", errors)
    check_strength(body.password)
    if await db.students.find_one({"registration_number": reg}):
        raise ApiError(409, "duplicate_registration", "An account with this registration number already exists.")
    if email and await db.users.find_one({"email": email}):
        raise ApiError(409, "duplicate_account", "An account with these details already exists.")
    uid, t = new_id(), now()
    try:
        await db.users.insert_one({"_id": uid, "email": email, "name": name, "role": "student", "status": "active",
                                   "password_hash": hash_password(body.password), "must_change_password": False,
                                   "created_at": t, "updated_at": t})
        st = {"_id": uid, "registration_number": reg, "full_name": name, "department": dept, "semester": body.semester,
              "verification_status": "pending", "created_at": t, "updated_at": t}
        await db.students.insert_one(st)
    except DuplicateKeyError:
        await db.users.delete_one({"_id": uid})
        raise ApiError(409, "duplicate_account", "An account with these details already exists.")
    await db.verification_requests.insert_one({"_id": new_id(), "user_id": uid, "status": "pending", "created_at": t})
    status = await apply_match(st)
    await audit("student.registered", uid, "student", uid, {"verification_status": status})
    return {"message": "Registration submitted. An administrator will review your verification.", "verification_status": status}


@router.get("/students/me")
async def my_profile(user=Depends(require("student"))):
    st = await db.students.find_one({"_id": user["_id"]}, {"mismatch_fields": 0, "registry_match": 0})
    req = await db.verification_requests.find_one({"user_id": user["_id"]}, sort=[("created_at", -1)])
    decision = None
    if req and req["status"] in ("verified", "rejected"):
        decision = {"status": req["status"], "reason": req.get("public_reason"), "decided_at": out(req).get("decided_at")}
    return {"profile": out(st, ("verified_by",)), "email": user.get("email"), "decision": decision}


@router.get("/verification/requests")
async def list_requests(status: str = "open", q: str = "", page: int = 1, size: int = 20, user=Depends(admin_only)):
    flt = {"status": {"$in": ["pending", "under_review"]}} if status == "open" else ({"status": status} if status != "all" else {})
    if q:
        ids = await db.students.distinct("_id", {"$or": [{"registration_number": {"$regex": re.escape(norm_reg(q))}},
                                                          {"full_name": {"$regex": re.escape(q), "$options": "i"}}]})
        flt["user_id"] = {"$in": ids}
    res = await paginate(db.verification_requests, flt, [("created_at", -1)], page, size)
    for item in res["items"]:
        st = await db.students.find_one({"_id": item["user_id"]})
        reg = await db.registry.find_one({"registration_number": st["registration_number"]}) if st else None
        item["student"] = out(st)
        item["registry_record"] = out(reg, ("import_id",)) if reg else None
    return res


@router.post("/verification/requests/{rid}/decision")
async def decide(rid: str, body: DecisionIn, user=Depends(admin_only)):
    req = await db.verification_requests.find_one({"_id": rid})
    if not req:
        raise ApiError(404, "not_found", "Verification request not found.")
    if req["status"] not in ("pending", "under_review"):
        raise ApiError(409, "already_decided", "This request has already been decided.")
    st = await db.students.find_one({"_id": req["user_id"]})
    match, _ = await match_registry(st)
    reason = body.reason.strip()
    if body.decision == "approve" and match != "matched" and len(reason) < 10:
        raise ApiError(422, "reason_required", "Registry does not match. Approval requires a justification of at least 10 characters.")
    if body.decision == "reject" and len(reason) < 5:
        raise ApiError(422, "reason_required", "A rejection reason of at least 5 characters is required.")
    status, t = ("verified" if body.decision == "approve" else "rejected"), now()
    res = await db.verification_requests.update_one(
        {"_id": rid, "status": {"$in": ["pending", "under_review"]}},
        {"$set": {"status": status, "reviewer_id": user["_id"], "review_notes": reason, "decided_at": t, "match_at_decision": match,
                  "public_reason": reason if status == "rejected" else None}})
    if res.modified_count != 1:
        raise ApiError(409, "already_decided", "This request has already been decided.")
    upd = {"verification_status": status, "updated_at": t}
    if status == "verified":
        upd.update({"verified_at": t, "verified_by": user["_id"]})
    else:
        upd["rejected_at"] = t
    await db.students.update_one({"_id": st["_id"]}, {"$set": upd})
    await audit(f"verification.{status}", user["_id"], "student", st["_id"], {"registry_match": match, "reason": reason})
    return {"ok": True, "status": status}


async def _set_student_status(uid: str, frm: str, to: str, reason: str, actor: dict, event: str):
    res = await db.students.update_one({"_id": uid, "verification_status": frm}, {"$set": {"verification_status": to, "updated_at": now()}})
    if res.modified_count != 1:
        raise ApiError(409, "invalid_state", f"Student must be {frm} for this action.")
    await audit(event, actor["_id"], "student", uid, {"reason": reason})
    return {"ok": True, "status": to}


@router.post("/admin/students/{uid}/suspend")
async def suspend(uid: str, body: ReasonIn, user=Depends(admin_only)):
    return await _set_student_status(uid, "verified", "suspended", body.reason, user, "student.suspended")


@router.post("/admin/students/{uid}/reactivate")
async def reactivate(uid: str, body: ReasonIn, user=Depends(admin_only)):
    return await _set_student_status(uid, "suspended", "verified", body.reason, user, "student.reactivated")


@router.post("/verification/rematch")
async def rematch(user=Depends(admin_only)):
    n = await rematch_open_requests()
    await audit("verification.rematched", user["_id"], "registry", None, {"requests": n})
    return {"rematched": n}


@router.get("/admin/students")
async def list_students(status: str = "", q: str = "", department: str = "", page: int = 1, size: int = 20, user=Depends(admin_only)):
    flt = {}
    if status:
        flt["verification_status"] = status
    if department:
        flt["department"] = norm_dept(department)
    if q:
        flt["$or"] = [{"registration_number": {"$regex": re.escape(norm_reg(q))}}, {"full_name": {"$regex": re.escape(q), "$options": "i"}}]
    res = await paginate(db.students, flt, [("created_at", -1)], page, size, ("mismatch_fields",))
    for item in res["items"]:
        u = await db.users.find_one({"_id": item["id"]}, {"email": 1, "status": 1})
        item["email"], item["account_status"] = (u or {}).get("email"), (u or {}).get("status")
    return res


def _validate_row(raw: dict, line: int):
    errs = []
    for k, v in raw.items():
        if isinstance(v, str) and v.strip().startswith(FORMULA_PREFIX) and not (k == "semester" and v.strip().lstrip("-").isdigit()):
            errs.append(f"{k}: value starts with a formula character")
    reg, name, dept = norm_reg(raw.get("registration_number")), " ".join((raw.get("full_name") or "").split()), norm_dept(raw.get("department"))
    if not REG_RE.match(reg):
        errs.append("registration_number: invalid format")
    if not valid_name(name):
        errs.append("full_name: invalid or missing (letters, spaces, apostrophes or hyphens only)")
    if not DEPT_RE.match(dept):
        errs.append("department: invalid or missing")
    sem = (raw.get("semester") or "").strip()
    if not sem.isdigit() or not 1 <= int(sem) <= 6:
        errs.append("semester: must be an integer 1-6")
    enr = (raw.get("enrollment_status") or "active").strip().lower()
    if enr not in ENROLLMENT:
        errs.append("enrollment_status: must be one of " + ", ".join(sorted(ENROLLMENT)))
    email = (raw.get("email") or "").strip().lower() or None
    if email and not EMAIL_RE.match(email):
        errs.append("email: invalid format")
    row = {"registration_number": reg, "full_name": name, "department": dept, "semester": int(sem) if sem.isdigit() else None,
           "enrollment_status": enr, "email": email, "line": line}
    return row, errs


@router.post("/admin/registry/preview")
async def registry_preview(file: UploadFile = File(...), user=Depends(admin_only)):
    if not (file.filename or "").lower().endswith(".csv") or file.content_type not in ("text/csv", "application/vnd.ms-excel", "application/octet-stream", "text/plain"):
        raise ApiError(415, "invalid_file", "Upload a .csv file.")
    data = await file.read(2 * 1024 * 1024 + 1)
    await file.close()
    if len(data) > 2 * 1024 * 1024:
        raise ApiError(413, "file_too_large", "CSV must be 2 MB or smaller.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ApiError(422, "invalid_encoding", "CSV must be UTF-8 encoded.")
    reader = csv.DictReader(io.StringIO(text))
    cols = {c.strip().lower() for c in (reader.fieldnames or []) if c}
    missing = REQUIRED_COLS - cols
    if missing:
        raise ApiError(422, "missing_columns", "Missing required columns: " + ", ".join(sorted(missing)))
    rows, errors, seen = [], [], {}
    for i, raw in enumerate(reader, start=2):
        if i > 20001:
            raise ApiError(422, "too_many_rows", "CSV may contain at most 20,000 rows.")
        raw = {(k or "").strip().lower(): (v or "") for k, v in raw.items() if k}
        row, errs = _validate_row(raw, i)
        if errs:
            errors.append({"line": i, "registration_number": row["registration_number"], "errors": errs})
            continue
        if row["registration_number"] in seen:
            errors.append({"line": i, "registration_number": row["registration_number"], "errors": [f"duplicate of line {seen[row['registration_number']]}"]})
            continue
        seen[row["registration_number"]] = i
        rows.append(row)
    dup_regs = {e["registration_number"] for e in errors if e["errors"][0].startswith("duplicate")}
    for r in rows:
        if r["registration_number"] in dup_regs:
            errors.append({"line": r["line"], "registration_number": r["registration_number"],
                           "errors": ["conflicting duplicate registration number in file; all occurrences rejected"]})
    rows = [r for r in rows if r["registration_number"] not in dup_regs]
    errors.sort(key=lambda e: e["line"])
    counts = {"new": 0, "update": 0, "unchanged": 0}
    for r in rows:
        ex = await db.registry.find_one({"registration_number": r["registration_number"]})
        if not ex:
            r["action"] = "new"
        else:
            changes = [k for k in ("full_name", "department", "semester", "enrollment_status", "email") if ex.get(k) != r[k]]
            r["action"], r["changes"] = ("update", changes) if changes else ("unchanged", [])
            if changes and await db.students.find_one({"registration_number": r["registration_number"], "verification_status": "verified"}):
                r["warning"] = "Conflicts with a verified student's registry record"
        counts[r["action"]] += 1
    pid = new_id()
    summary = {"total_rows": len(rows) + len(errors), "valid_rows": len(rows), "invalid_rows": len(errors), **counts}
    await db.registry_previews.insert_one({"_id": pid, "rows": rows, "errors": errors, "summary": summary, "filename": file.filename[:120],
                                           "uploaded_by": user["_id"], "expires_at": now() + timedelta(minutes=30)})
    return {"preview_id": pid, "summary": summary, "rows": rows[:200], "errors": errors[:500]}


@router.post("/admin/registry/commit")
async def registry_commit(body: CommitIn, user=Depends(admin_only)):
    if not body.confirm:
        raise ApiError(422, "confirmation_required", "Explicit confirmation is required.")
    pv = await db.registry_previews.find_one_and_delete({"_id": body.preview_id})
    if not pv or pv["expires_at"] < now():
        raise ApiError(404, "preview_expired", "Preview not found or expired. Upload the file again.")
    import_id, t = new_id(), now()
    ops = [UpdateOne({"registration_number": r["registration_number"]},
                     {"$set": {k: r[k] for k in ("full_name", "department", "semester", "enrollment_status", "email")} | {"import_id": import_id, "updated_at": t},
                      "$setOnInsert": {"_id": new_id(), "created_at": t}}, upsert=True)
           for r in pv["rows"] if r["action"] != "unchanged"]
    result = await db.registry.bulk_write(ops, ordered=True) if ops else None
    summary = pv["summary"] | {"inserted": result.upserted_count if result else 0, "updated": result.modified_count if result else 0}
    await db.registry_imports.insert_one({"_id": import_id, "filename": pv["filename"], "imported_by": user["_id"], "summary": summary, "created_at": t})
    await audit("registry.imported", user["_id"], "registry_import", import_id, summary)
    summary["rematched_requests"] = await rematch_open_requests()
    return {"import_id": import_id, "summary": summary}


@router.get("/admin/registry")
async def list_registry(q: str = "", page: int = 1, size: int = 20, user=Depends(admin_only)):
    flt = {"$or": [{"registration_number": {"$regex": re.escape(norm_reg(q))}}, {"full_name": {"$regex": re.escape(q), "$options": "i"}}]} if q else {}
    return await paginate(db.registry, flt, [("registration_number", 1)], page, size)


@router.get("/admin/registry/imports")
async def list_imports(page: int = 1, size: int = 20, user=Depends(admin_only)):
    return await paginate(db.registry_imports, {}, [("created_at", -1)], page, size)


def _safe_cell(v):
    s = "" if v is None else str(v)
    return "'" + s if s.startswith(FORMULA_PREFIX) else s


@router.get("/admin/registry/export")
async def export_registry(user=Depends(admin_only)):
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["registration_number", "full_name", "department", "semester", "enrollment_status", "email"]
    w.writerow(cols)
    async for r in db.registry.find().sort("registration_number", 1):
        w.writerow([_safe_cell(r.get(c)) for c in cols])
    await audit("registry.exported", user["_id"], "registry", None, {})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=votesecure_registry.csv"})
