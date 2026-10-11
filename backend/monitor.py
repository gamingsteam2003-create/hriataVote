import json
import os
import secrets
import time
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field
from pymongo.errors import DuplicateKeyError

from auth import Strict, check_strength, hash_password, require, revoke_sessions
from core import (ApiError, APP_ENV, STATE, audit, create_checkpoint, db, new_id, now, out, paginate, security_event,
                  sha256, verify_audit_chain)
from elections import get_election

router = APIRouter(tags=["monitoring"])
admin_only = require("admin")
auditor_only = require("auditor")
reviewers = require("admin", "auditor")
operator_only = require("operator")


class StaffIn(Strict):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$", max_length=120)
    name: str = Field(min_length=2, max_length=100)
    role: Literal["admin", "auditor", "operator"]
    temporary_password: str = Field(max_length=128)


class StatusIn(Strict):
    status: Literal["active", "disabled"]
    reason: str = Field(min_length=3, max_length=300)


class FindingIn(Strict):
    election_id: str = Field(default="", max_length=64)
    severity: Literal["info", "low", "medium", "high"]
    title: str = Field(min_length=3, max_length=150)
    detail: str = Field(min_length=3, max_length=3000)


@router.get("/health")
async def health():
    await db.command("ping")
    return {"status": "ok"}


@router.get("/analytics/overview")
async def overview(user=Depends(reviewers)):
    by_status = {d["_id"]: d["n"] async for d in db.students.aggregate([{"$group": {"_id": "$verification_status", "n": {"$sum": 1}}}])}
    by_state = {d["_id"]: d["n"] async for d in db.elections.aggregate([{"$group": {"_id": "$state", "n": {"$sum": 1}}}])}
    since = now() - timedelta(hours=24)
    alerts = await db.security_events.count_documents({"at": {"$gte": since}, "severity": {"$in": ["medium", "high"]}})
    elections = []
    async for e in db.elections.find({"state": {"$in": ["open", "paused", "closed", "finalized"]}}).sort("opens_at", -1).limit(8):
        el = await db.eligibility.count_documents({"election_id": e["_id"], "status": "eligible"})
        pa = await db.participation.count_documents({"election_id": e["_id"], "status": "accepted"})
        elections.append({"id": e["_id"], "title": e["title"], "state": e["state"], "result_status": e.get("result_status"),
                          "eligible": el, "participated": pa, "turnout_pct": round(pa * 100 / el, 1) if el else 0})
    return {"students": {"total": sum(by_status.values()), **by_status}, "registry_count": await db.registry.count_documents({}),
            "pending_verification": by_status.get("pending", 0) + by_status.get("under_review", 0),
            "elections": by_state, "security_alerts_24h": alerts, "turnout": elections}


@router.get("/analytics/elections/{eid}/turnout")
async def turnout(eid: str, user=Depends(reviewers)):
    e = await get_election(eid)
    pipeline = [{"$match": {"election_id": eid, "status": "eligible"}},
                {"$lookup": {"from": "students", "localField": "user_id", "foreignField": "_id", "as": "s"}}, {"$unwind": "$s"},
                {"$lookup": {"from": "participation", "let": {"u": "$user_id"}, "as": "p", "pipeline": [
                    {"$match": {"$expr": {"$and": [{"$eq": ["$user_id", "$$u"]}, {"$eq": ["$election_id", eid]}, {"$eq": ["$status", "accepted"]}]}}}]}},
                {"$group": {"_id": "$s.department", "eligible": {"$sum": 1}, "participated": {"$sum": {"$size": "$p"}}}}, {"$sort": {"_id": 1}}]
    depts = [{"department": d["_id"], "eligible": d["eligible"], "participated": d["participated"],
              "turnout_pct": round(d["participated"] * 100 / d["eligible"], 1) if d["eligible"] else 0} async for d in db.eligibility.aggregate(pipeline)]
    hours = [{"hour": d["_id"], "count": d["n"]} async for d in db.participation.aggregate([
        {"$match": {"election_id": eid, "status": "accepted"}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d %H:00", "date": "$accepted_at"}}, "n": {"$sum": 1}}}, {"$sort": {"_id": 1}}])]
    el, pa = sum(d["eligible"] for d in depts), sum(d["participated"] for d in depts)
    return {"election_id": eid, "state": e["state"], "eligible": el, "participated": pa,
            "turnout_pct": round(pa * 100 / el, 1) if el else 0, "by_department": depts, "by_hour": hours}


@router.get("/audit/events")
async def audit_events(event_type: str = "", target_id: str = "", page: int = 1, size: int = 25, user=Depends(reviewers)):
    flt = {}
    if event_type:
        flt["event_type"] = {"$regex": "^" + "".join(c for c in event_type if c.isalnum() or c in "._")}
    if target_id:
        flt["target_id"] = target_id
    return await paginate(db.audit_events, flt, [("seq", -1)], page, size)


@router.post("/audit/verify")
async def audit_verify(user=Depends(reviewers)):
    res = await verify_audit_chain()
    if not res["ok"]:
        await security_event("audit_integrity_failure", "high", None, user["_id"], res["first_inconsistency"]["problem"])
    await audit("audit.integrity_verified", user["_id"], "audit", None, {"ok": res["ok"], "checked": res["checked"]})
    return res


@router.post("/audit/checkpoints", status_code=201)
async def checkpoint(user=Depends(reviewers)):
    cp = await create_checkpoint(user["_id"])
    if not cp:
        raise ApiError(409, "empty", "No audit events have been recorded.")
    return cp


@router.get("/audit/checkpoints")
async def checkpoints(user=Depends(reviewers)):
    return {"items": [out(c) for c in await db.audit_checkpoints.find().sort("seq", -1).to_list(50)]}


@router.get("/audit/findings")
async def findings(user=Depends(reviewers)):
    return {"items": [out(f) for f in await db.audit_findings.find().sort("created_at", -1).to_list(200)]}


@router.post("/audit/findings", status_code=201)
async def add_finding(body: FindingIn, user=Depends(auditor_only)):
    f = {"_id": new_id(), **body.model_dump(), "recorded_by": user["_id"], "recorded_by_email": user["email"], "created_at": now()}
    await db.audit_findings.insert_one(f)
    await audit("audit.finding_recorded", user["_id"], "finding", f["_id"], {"severity": body.severity, "election_id": body.election_id})
    return out(f)


@router.get("/admin/users")
async def list_staff(page: int = 1, size: int = 50, user=Depends(admin_only)):
    return await paginate(db.users, {"role": {"$ne": "student"}}, [("created_at", 1)], page, size,
                          ("password_hash", "mfa_secret", "mfa_pending_secret", "mfa_last_step"))


@router.post("/admin/users", status_code=201)
async def create_staff(body: StaffIn, user=Depends(admin_only)):
    check_strength(body.temporary_password)
    t = now()
    u = {"_id": new_id(), "email": body.email.lower(), "name": body.name, "role": body.role, "status": "active",
         "password_hash": hash_password(body.temporary_password), "must_change_password": True, "mfa_enabled": False,
         "created_at": t, "updated_at": t, "created_by": user["_id"]}
    try:
        await db.users.insert_one(u)
    except DuplicateKeyError:
        raise ApiError(409, "duplicate_account", "An account with this email already exists.")
    await audit("account.staff_created", user["_id"], "user", u["_id"], {"role": body.role})
    return {"id": u["_id"], "email": u["email"], "role": u["role"]}


@router.post("/admin/users/{uid}/status")
async def set_status(uid: str, body: StatusIn, user=Depends(admin_only)):
    if uid == user["_id"]:
        raise ApiError(409, "self_change", "You cannot change your own account status.")
    target = await db.users.find_one({"_id": uid})
    if not target:
        raise ApiError(404, "not_found", "Account not found.")
    if body.status == "disabled" and target["role"] == "admin" and await db.users.count_documents({"role": "admin", "status": "active"}) <= 1:
        raise ApiError(409, "last_admin", "The last active administrator cannot be disabled.")
    await db.users.update_one({"_id": uid}, {"$set": {"status": body.status, "updated_at": now()}})
    await revoke_sessions(uid)
    await audit("account.status_changed", user["_id"], "user", uid, {"status": body.status, "role": target["role"], "reason": body.reason})
    return {"ok": True}


@router.post("/admin/users/{uid}/reset-token")
async def issue_reset_token(uid: str, user=Depends(admin_only)):
    if uid == user["_id"]:
        raise ApiError(409, "self_reset", "Use change-password for your own account.")
    target = await db.users.find_one({"_id": uid})
    if not target:
        raise ApiError(404, "not_found", "Account not found.")
    await db.reset_tokens.update_many({"user_id": uid, "used_at": None}, {"$set": {"used_at": now(), "superseded": True}})
    token, expires = secrets.token_urlsafe(24), now() + timedelta(minutes=30)
    await db.reset_tokens.insert_one({"_id": new_id(), "user_id": uid, "token_hash": sha256(token), "used_at": None,
                                      "expires_at": expires, "issued_by": user["_id"], "created_at": now()})
    await audit("account.reset_token_issued", user["_id"], "user", uid, {"role": target["role"]})
    return {"token": token, "expires_at": out({"t": expires})["t"], "identifier_hint": "Use the account email or registration number."}


@router.get("/ops/status")
async def ops_status(user=Depends(operator_only)):
    t0 = time.perf_counter()
    await db.command("ping")
    ping_ms = round((time.perf_counter() - t0) * 1000, 2)
    since = now() - timedelta(hours=24)
    metrics = [{"hour": d["_id"]["hour"], "class": d["_id"]["cls"], "count": d["n"]} async for d in db.request_metrics.aggregate([
        {"$match": {"hour": {"$gte": since.strftime("%Y-%m-%d %H:00")}}},
        {"$group": {"_id": {"hour": "$hour", "cls": "$cls"}, "n": {"$sum": "$count"}}}, {"$sort": {"_id.hour": 1}}])]
    errors = [{"route": d["_id"], "count": d["n"]} async for d in db.request_metrics.aggregate([
        {"$match": {"hour": {"$gte": since.strftime("%Y-%m-%d %H:00")}, "cls": "5xx"}},
        {"$group": {"_id": "$route", "n": {"$sum": "$count"}}}, {"$sort": {"n": -1}}, {"$limit": 10}])]
    alerts = [out(a, ("user_id",)) for a in await db.security_events.find({"at": {"$gte": since}}).sort("at", -1).limit(30).to_list(30)]
    by_kind = {d["_id"]: d["n"] async for d in db.security_events.aggregate([{"$match": {"at": {"$gte": since}}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}])}
    jobs = [out(j) for j in await db.job_status.find().to_list(20)]
    backup = None
    bf = os.environ.get("BACKUP_STATUS_FILE")
    if bf and Path(bf).exists():
        try:
            backup = json.loads(Path(bf).read_text())
        except ValueError:
            backup = {"error": "Backup status file unreadable"}
    return {"service": {"status": "ok", "env": APP_ENV, "started_at": out({"t": STATE["started_at"]})["t"]},
            "database": {"connected": True, "ping_ms": ping_ms, "transactions_supported": STATE["transactions"]},
            "active_sessions": await db.sessions.count_documents({"expires_at": {"$gt": now()}}),
            "request_metrics": metrics, "error_routes": errors, "security_events": alerts, "security_by_kind": by_kind,
            "jobs": jobs, "backup": backup}


CATEGORY_KINDS = {
    "failed_logins": ["failed_login", "login_locked"],
    "rate_limits": ["rate_limited"],
    "unauthorized": ["unauthorized_access", "csrf_rejected"],
    "suspicious": ["rejected_ballot", "duplicate_vote_conflict", "failed_mfa", "invalid_reset_token"],
}
CATEGORY_META = {
    "failed_logins": ("Failed login attempts", "medium"),
    "rate_limits": ("Rate-limit triggers", "low"),
    "unauthorized": ("Unauthorized access attempts", "high"),
    "suspicious": ("Suspicious request patterns", "medium"),
}
RECOMMENDED = {
    "failed_login": "Review the targeted account and source. Repeated failures may indicate credential stuffing; confirm the owner and consider issuing a reset token.",
    "login_locked": "An account hit the failed-attempt lockout. Confirm whether the legitimate owner was responsible before it clears automatically.",
    "rate_limited": "A client exceeded a request limit. Check the route and source pattern for scripted abuse; limits reset automatically.",
    "unauthorized_access": "An authenticated user attempted an action outside their role. Confirm the account's role assignment is still correct.",
    "csrf_rejected": "A state-changing request lacked a valid CSRF token. Usually a stale tab; investigate if persistent from one source.",
    "rejected_ballot": "A ballot was rejected by server validation. Confirm the election configuration and that the voter is eligible.",
    "duplicate_vote_conflict": "A second ballot was blocked by the uniqueness constraint. Expected behaviour; investigate only if frequent from one voter.",
    "failed_mfa": "An MFA code failed. Confirm the staff member's authenticator clock is in sync.",
    "invalid_reset_token": "A reset-token attempt was rejected. Investigate if repeated from one source.",
    "reconciliation_mismatch": "Reconciliation found a discrepancy. Do not finalize until the failed checks are resolved.",
    "audit_integrity_failure": "The audit chain failed verification. Treat as critical and compare against external checkpoints immediately.",
}


@router.get("/admin/security")
async def security_center(user=Depends(admin_only)):
    t0 = time.perf_counter()
    await db.command("ping")
    ping_ms = round((time.perf_counter() - t0) * 1000, 2)
    d1, d7 = now() - timedelta(hours=24), now() - timedelta(days=7)

    async def by_kind(since):
        return {d["_id"]: d["n"] async for d in db.security_events.aggregate(
            [{"$match": {"at": {"$gte": since}}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}])}

    k24, k7 = await by_kind(d1), await by_kind(d7)
    categories = []
    for key, kinds in CATEGORY_KINDS.items():
        label, sev = CATEGORY_META[key]
        categories.append({"key": key, "label": label, "severity": sev, "kinds": kinds,
                           "count_24h": sum(k24.get(x, 0) for x in kinds), "count_7d": sum(k7.get(x, 0) for x in kinds)})
    events = []
    for a in await db.security_events.find({"at": {"$gte": d7}}).sort("at", -1).limit(100).to_list(100):
        ev = out(a, ("user_id",))
        ev["recommended"] = RECOMMENDED.get(a["kind"], "Review the event source and affected resource; correlate with the audit log.")
        events.append(ev)
    chain = await verify_audit_chain()
    recon = []
    async for r in db.reconciliations.find({"passed": False}).sort("run_at", -1).limit(20):
        el = await db.elections.find_one({"_id": r["election_id"]}, {"title": 1})
        recon.append({"election_id": r["election_id"], "title": el["title"] if el else None, "run_at": out(r)["run_at"],
                      "failed_checks": [c["label"] for c in r["checks"] if not c["passed"]]})
    return {
        "generated_at": out({"t": now()})["t"],
        "health": {"service": "ok", "env": APP_ENV, "ping_ms": ping_ms, "started_at": out({"t": STATE["started_at"]})["t"],
                   "active_sessions": await db.sessions.count_documents({"expires_at": {"$gt": now()}}),
                   "transactions_supported": STATE["transactions"]},
        "audit": {"ok": chain["ok"], "checked": chain["checked"], "problem": (chain.get("first_inconsistency") or {}).get("problem")},
        "locked_accounts": await db.login_failures.count_documents({"count": {"$gte": 5}}),
        "categories": categories, "reconciliation_failures": recon, "events": events,
    }
