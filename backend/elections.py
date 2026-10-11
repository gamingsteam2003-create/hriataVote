import asyncio
import re
from datetime import datetime
from typing import List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from auth import Strict, require
from core import (ApiError, audit, db, logger, new_id, norm_dept, norm_reg, now, out, paginate, verify_audit_chain)

router = APIRouter(tags=["elections"])
admin_only = require("admin")
reviewers = require("admin", "auditor")
ACTIONS = {
    "schedule": (["draft"], "scheduled"), "unschedule": (["scheduled"], "draft"), "open": (["scheduled"], "open"),
    "pause": (["open"], "paused"), "resume": (["paused"], "open"), "close": (["open", "paused"], "closed"),
    "cancel": (["draft", "scheduled"], "cancelled"),
}


class PositionIn(Strict):
    id: Optional[str] = Field(default=None, max_length=64)
    title: str = Field(min_length=2, max_length=80)
    max_selections: int = Field(ge=1, le=10)
    description: str = Field(default="", max_length=300)


class PolicyIn(Strict):
    require_two_person: bool = False
    allow_extension: bool = False
    allow_abstain: bool = False
    disclosure: Literal["public_after_publication", "restricted"] = "public_after_publication"
    one_nomination_per_student: bool = True


class ElectionIn(Strict):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=2000)
    election_type: Literal["general", "department", "representative", "club", "other"]
    academic_year: str = Field(pattern=r"^\d{4}-\d{2,4}$")
    scope: Literal["college", "department"]
    departments: List[str] = Field(default_factory=list, max_length=50)
    semesters: List[int] = Field(default_factory=list, max_length=12)
    opens_at: datetime
    closes_at: datetime
    timezone: str = Field(default="Asia/Kolkata", max_length=60)
    positions: List[PositionIn] = Field(min_length=1, max_length=20)
    policy: PolicyIn = Field(default_factory=PolicyIn)
    nomination_rules: str = Field(default="", max_length=2000)


class ActionIn(Strict):
    reason: str = Field(min_length=3, max_length=500)
    new_closes_at: Optional[datetime] = None


class CandidateIn(Strict):
    registration_number: str = Field(max_length=30)
    position_id: str = Field(max_length=64)
    manifesto: str = Field(default="", max_length=5000)
    biography: str = Field(default="", max_length=2000)


class CandidateEditIn(Strict):
    manifesto: str = Field(default="", max_length=5000)
    biography: str = Field(default="", max_length=2000)


class ReviewIn(Strict):
    decision: Literal["approve", "reject"]
    reason: str = Field(default="", max_length=500)


class EligChangeIn(Strict):
    registration_number: str = Field(max_length=30)
    action: Literal["add", "revoke"]
    reason: str = Field(min_length=5, max_length=500)


class ApprovalIn(Strict):
    action: Literal["open", "finalize"]
    reason: str = Field(min_length=3, max_length=500)


def validate_election(body: ElectionIn) -> dict:
    errs = []
    if body.opens_at.tzinfo is None or body.closes_at.tzinfo is None:
        errs.append({"field": "opens_at", "msg": "Times must include a timezone offset."})
    elif body.closes_at <= body.opens_at:
        errs.append({"field": "closes_at", "msg": "Closing time must be later than opening time."})
    try:
        ZoneInfo(body.timezone)
    except Exception:
        errs.append({"field": "timezone", "msg": "Unknown timezone."})
    depts = sorted({norm_dept(d) for d in body.departments if d.strip()})
    if body.scope == "department" and not depts:
        errs.append({"field": "departments", "msg": "Department-scoped elections need at least one department."})
    if any(s < 1 or s > 6 for s in body.semesters):
        errs.append({"field": "semesters", "msg": "Semesters must be between 1 and 6."})
    titles = [p.title.casefold() for p in body.positions]
    if len(set(titles)) != len(titles):
        errs.append({"field": "positions", "msg": "Position titles must be unique."})
    if errs:
        raise ApiError(422, "validation_error", "Election configuration is invalid.", errs)
    data = body.model_dump()
    data["departments"] = depts if body.scope == "department" else []
    data["semesters"] = sorted(set(body.semesters))
    data["positions"] = [{**p, "id": p["id"] or new_id()} for p in data["positions"]]
    return data


async def get_election(eid: str) -> dict:
    e = await db.elections.find_one({"_id": eid})
    if not e:
        raise ApiError(404, "not_found", "Election not found.")
    return await refresh_state(e)


async def refresh_state(e: dict) -> dict:
    if e["state"] in ("open", "paused") and e["closes_at"] <= now():
        upd = await db.elections.find_one_and_update(
            {"_id": e["_id"], "state": {"$in": ["open", "paused"]}},
            {"$set": {"state": "closed", "result_status": "reconciliation_pending", "closed_at": now(), "updated_at": now()}},
            return_document=ReturnDocument.AFTER)
        if upd:
            await audit("election.auto_closed", "system", "election", e["_id"], {"from": e["state"], "reason": "closing time reached"})
            return upd
        return await db.elections.find_one({"_id": e["_id"]})
    return e


def student_fits(e: dict, st: dict):
    if e["scope"] == "department" and st["department"] not in e["departments"]:
        return False, "Your department is not within this election's scope."
    if e["semesters"] and st["semester"] not in e["semesters"]:
        return False, "Your semester is not within this election's scope."
    return True, None


async def readiness(e: dict, action: str = "open") -> list:
    eid = e["_id"]
    cands = await db.candidates.find({"election_id": eid, "status": {"$in": ["nominated", "approved"]}}).to_list(1000)
    approved_pos = {c["position_id"] for c in cands if c["status"] == "approved"}
    pending = [c for c in cands if c["status"] == "nominated"]
    missing = [p["title"] for p in e["positions"] if p["id"] not in approved_pos]
    elig = await db.eligibility.count_documents({"election_id": eid, "status": "eligible"})
    t = now()
    chain = await verify_audit_chain()
    checks = [
        ("config", "Configuration complete", bool(e["title"] and e["positions"]), "Title and at least one position are required."),
        ("schedule", "Schedule valid", e["closes_at"] > e["opens_at"] and e["closes_at"] > t, "Closing time must be in the future and after opening time."),
        ("candidates", "Candidate approval complete", not missing and not pending,
         ("Positions without approved candidates: " + ", ".join(missing) if missing else "") + (f" {len(pending)} nomination(s) awaiting review." if pending else "")),
        ("eligibility_rules", "Eligibility rules configured", e["scope"] == "college" or bool(e["departments"]), "Select departments for a department-scoped election."),
        ("eligibility_list", "Eligibility list generated and locked", elig > 0 and e.get("eligibility_locked", False),
         f"{elig} eligible student(s); list {'locked' if e.get('eligibility_locked') else 'not locked'}."),
        ("audit_integrity", "Audit-chain integrity verified", chain["ok"], "Audit chain inconsistency detected." if not chain["ok"] else f"{chain['checked']} events verified."),
    ]
    if action == "open":
        if e["policy"]["require_two_person"]:
            ok = await db.approvals.find_one({"election_id": eid, "action": "open", "status": "approved"})
            checks.append(("approval", "Second-administrator approval", bool(ok), "Two-person approval policy requires an approved 'open' request."))
        checks.append(("window", "Within voting window", e["opens_at"] <= t < e["closes_at"], "Current server time is outside the configured voting window."))
    return [{"key": k, "label": lbl, "passed": bool(p), "detail": d if not p else (d if k in ("eligibility_list", "audit_integrity") else "")} for k, lbl, p, d in checks]


def election_out(e: dict) -> dict:
    return out(e)


@router.get("/elections")
async def list_elections(state: str = "", page: int = 1, size: int = 20, user=Depends(reviewers)):
    res = await paginate(db.elections, {"state": state} if state else {}, [("created_at", -1)], page, size)
    for item in res["items"]:
        item["eligible_count"] = await db.eligibility.count_documents({"election_id": item["id"], "status": "eligible"})
        item["participation_count"] = await db.participation.count_documents({"election_id": item["id"], "status": "accepted"})
        item["candidate_count"] = await db.candidates.count_documents({"election_id": item["id"], "status": "approved"})
    return res


@router.post("/elections", status_code=201)
async def create_election(body: ElectionIn, user=Depends(admin_only)):
    data, t = validate_election(body), now()
    e = {"_id": new_id(), **data, "state": "draft", "eligibility_locked": False, "result_status": None,
         "created_by": user["_id"], "created_at": t, "updated_at": t}
    await db.elections.insert_one(e)
    await audit("election.created", user["_id"], "election", e["_id"], {"title": e["title"], "scope": e["scope"]})
    return election_out(e)


@router.get("/elections/{eid}")
async def election_detail(eid: str, user=Depends(reviewers)):
    e = await get_election(eid)
    res = election_out(e)
    res["readiness"] = await readiness(e, "open" if e["state"] == "scheduled" else "schedule")
    res["eligible_count"] = await db.eligibility.count_documents({"election_id": eid, "status": "eligible"})
    res["participation_count"] = await db.participation.count_documents({"election_id": eid, "status": "accepted"})
    res["approvals"] = [out(a) for a in await db.approvals.find({"election_id": eid}).sort("created_at", -1).to_list(50)]
    return res


@router.put("/elections/{eid}")
async def update_election(eid: str, body: ElectionIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "draft" or e.get("eligibility_locked"):
        raise ApiError(409, "not_editable", "Only draft elections with an unlocked eligibility list can be edited.")
    data = validate_election(body)
    keep = {p["id"] for p in data["positions"]}
    used = await db.candidates.distinct("position_id", {"election_id": eid})
    if set(used) - keep:
        raise ApiError(409, "position_in_use", "Remove candidates before deleting their position.")
    changed = [k for k, v in data.items() if e.get(k) != v]
    res = await db.elections.update_one({"_id": eid, "state": "draft", "eligibility_locked": False}, {"$set": {**data, "updated_at": now()}})
    if res.modified_count != 1 and changed:
        raise ApiError(409, "not_editable", "Election changed state; reload and try again.")
    await audit("election.updated", user["_id"], "election", eid, {"changed_fields": changed})
    return election_out(await db.elections.find_one({"_id": eid}))


@router.get("/elections/{eid}/readiness")
async def get_readiness(eid: str, action: Literal["schedule", "open"] = "open", user=Depends(reviewers)):
    return {"checks": await readiness(await get_election(eid), action)}


@router.post("/elections/{eid}/actions/{action}")
async def election_action(eid: str, action: Literal["schedule", "unschedule", "open", "pause", "resume", "close", "cancel", "extend"],
                          body: ActionIn, user=Depends(admin_only)):
    e, t = await get_election(eid), now()
    if action == "extend":
        if not e["policy"]["allow_extension"]:
            raise ApiError(409, "not_permitted", "This election's rules do not permit extensions.")
        nc = body.new_closes_at
        if e["state"] not in ("open", "paused") or not nc or nc.tzinfo is None or nc <= e["closes_at"] or nc <= t:
            raise ApiError(409, "invalid_extension", "Extension requires an open or paused election and a later closing time.")
        await db.elections.update_one({"_id": eid, "state": {"$in": ["open", "paused"]}}, {"$set": {"closes_at": nc, "updated_at": t}})
        await audit("election.extended", user["_id"], "election", eid, {"old_closes_at": e["closes_at"], "new_closes_at": nc, "reason": body.reason})
        return election_out(await db.elections.find_one({"_id": eid}))
    allowed, target = ACTIONS[action]
    if e["state"] not in allowed:
        raise ApiError(409, "invalid_transition", f"Cannot {action} an election in state '{e['state']}'.")
    if action in ("schedule", "open"):
        failed = [c["label"] for c in await readiness(e, action) if not c["passed"]]
        if failed:
            raise ApiError(409, "not_ready", "Readiness checks failed: " + "; ".join(failed))
    if action == "resume" and e["closes_at"] <= t:
        raise ApiError(409, "window_passed", "Closing time has passed; the election cannot resume.")
    if action == "cancel" and await db.participation.count_documents({"election_id": eid}):
        raise ApiError(409, "has_ballots", "Elections with recorded participation cannot be cancelled.")
    approval = None
    if action == "open" and e["policy"]["require_two_person"]:
        approval = await db.approvals.find_one_and_update({"election_id": eid, "action": "open", "status": "approved"},
                                                          {"$set": {"status": "executed", "executed_at": t, "executed_by": user["_id"]}})
        if not approval:
            raise ApiError(409, "approval_required", "A second administrator must approve opening this election.")
    upd = {"state": target, "updated_at": t}
    if action == "close":
        upd.update({"result_status": "reconciliation_pending", "closed_at": t})
    if action == "open":
        upd["opened_at"] = t
    res = await db.elections.update_one({"_id": eid, "state": e["state"]}, {"$set": upd})
    if res.modified_count != 1:
        raise ApiError(409, "conflict", "Election state changed concurrently; reload and try again.")
    await audit(f"election.{action}", user["_id"], "election", eid, {"from": e["state"], "to": target, "reason": body.reason,
                                                                   "approval_id": approval["_id"] if approval else None})
    return election_out(await db.elections.find_one({"_id": eid}))


@router.post("/elections/{eid}/eligibility/generate")
async def generate_eligibility(eid: str, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "draft" or e.get("eligibility_locked"):
        raise ApiError(409, "locked", "Eligibility can only be generated for a draft election with an unlocked list.")
    await db.eligibility.delete_many({"election_id": eid})
    docs, t = [], now()
    async for st in db.students.find({"verification_status": "verified"}):
        u = await db.users.find_one({"_id": st["_id"], "status": "active"})
        reg = await db.registry.find_one({"registration_number": st["registration_number"]})
        fits, _ = student_fits(e, st)
        if u and fits and (not reg or reg.get("enrollment_status", "active") == "active"):
            docs.append({"_id": new_id(), "election_id": eid, "user_id": st["_id"], "status": "eligible",
                         "reason": f"rule:scope={e['scope']}", "created_at": t, "history": []})
    if docs:
        await db.eligibility.insert_many(docs)
    await audit("eligibility.generated", user["_id"], "election", eid, {"eligible": len(docs)})
    return {"eligible": len(docs)}


@router.post("/elections/{eid}/eligibility-lock/{op}")
async def lock_eligibility(eid: str, op: Literal["lock", "unlock"], user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "draft":
        raise ApiError(409, "invalid_state", "Eligibility can only be locked or unlocked while the election is a draft.")
    if op == "lock" and not await db.eligibility.count_documents({"election_id": eid, "status": "eligible"}):
        raise ApiError(409, "empty_list", "Generate a non-empty eligibility list before locking.")
    await db.elections.update_one({"_id": eid}, {"$set": {"eligibility_locked": op == "lock", "eligibility_locked_at": now() if op == "lock" else None}})
    await audit(f"eligibility.{op}ed", user["_id"], "election", eid, {})
    return {"eligibility_locked": op == "lock"}


@router.get("/elections/{eid}/eligibility")
async def list_eligibility(eid: str, page: int = 1, size: int = 20, user=Depends(admin_only)):
    await get_election(eid)
    res = await paginate(db.eligibility, {"election_id": eid}, [("created_at", 1)], page, size)
    for item in res["items"]:
        st = await db.students.find_one({"_id": item["user_id"]}, {"registration_number": 1, "full_name": 1, "department": 1, "semester": 1})
        item["student"] = out(st)
        item["participated"] = bool(await db.participation.find_one({"election_id": eid, "user_id": item["user_id"], "status": "accepted"}))
    return res


@router.post("/elections/{eid}/eligibility/change")
async def change_eligibility(eid: str, body: EligChangeIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] not in ("draft", "scheduled", "open", "paused"):
        raise ApiError(409, "invalid_state", "Eligibility cannot change after voting has closed.")
    st = await db.students.find_one({"registration_number": norm_reg(body.registration_number)})
    if not st:
        raise ApiError(404, "not_found", "No registered student with that registration number.")
    entry = {"at": now(), "by": user["_id"], "change": body.action, "reason": body.reason}
    if body.action == "add":
        if st["verification_status"] != "verified":
            raise ApiError(409, "not_verified", "Only verified students can be made eligible.")
        try:
            await db.eligibility.insert_one({"_id": new_id(), "election_id": eid, "user_id": st["_id"], "status": "eligible",
                                             "reason": "manual", "created_at": now(), "history": [entry]})
        except DuplicateKeyError:
            res = await db.eligibility.update_one({"election_id": eid, "user_id": st["_id"], "status": "revoked"},
                                                  {"$set": {"status": "eligible"}, "$push": {"history": entry}})
            if res.modified_count != 1:
                raise ApiError(409, "already_eligible", "Student is already eligible.")
    else:
        if await db.participation.find_one({"election_id": eid, "user_id": st["_id"]}):
            raise ApiError(409, "participated", "Eligibility cannot be revoked after participation.")
        res = await db.eligibility.update_one({"election_id": eid, "user_id": st["_id"], "status": "eligible"},
                                              {"$set": {"status": "revoked"}, "$push": {"history": entry}})
        if res.modified_count != 1:
            raise ApiError(409, "not_eligible", "Student is not currently eligible.")
    await audit("eligibility.changed", user["_id"], "election", eid, {"student_id": st["_id"], "change": body.action,
                                                                    "reason": body.reason, "after_lock": e.get("eligibility_locked", False)})
    return {"ok": True}


@router.get("/elections/{eid}/candidates")
async def list_candidates(eid: str, user=Depends(reviewers)):
    await get_election(eid)
    return {"items": [out(c) for c in await db.candidates.find({"election_id": eid}).sort("created_at", 1).to_list(500)]}


async def _draft_candidate(cid: str):
    c = await db.candidates.find_one({"_id": cid})
    if not c:
        raise ApiError(404, "not_found", "Candidate not found.")
    e = await get_election(c["election_id"])
    if e["state"] != "draft":
        raise ApiError(409, "ballot_locked", "Candidates cannot be changed after the election leaves draft.")
    return c, e


@router.post("/elections/{eid}/candidates", status_code=201)
async def nominate(eid: str, body: CandidateIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "draft":
        raise ApiError(409, "ballot_locked", "Nominations are only accepted while the election is a draft.")
    if body.position_id not in {p["id"] for p in e["positions"]}:
        raise ApiError(422, "invalid_position", "Position does not belong to this election.")
    st = await db.students.find_one({"registration_number": norm_reg(body.registration_number)})
    if not st or st["verification_status"] != "verified":
        raise ApiError(409, "not_verified", "Candidates must be verified students.")
    fits, why = student_fits(e, st)
    if not fits:
        raise ApiError(409, "ineligible_candidate", why.replace("Your", "Candidate's"))
    if e["policy"]["one_nomination_per_student"] and await db.candidates.find_one({"election_id": eid, "student_user_id": st["_id"], "status": {"$ne": "withdrawn"}}):
        raise ApiError(409, "duplicate_nomination", "This student is already nominated in this election.")
    c = {"_id": new_id(), "election_id": eid, "position_id": body.position_id, "student_user_id": st["_id"],
         "registration_number": st["registration_number"], "full_name": st["full_name"], "department": st["department"],
         "semester": st["semester"], "manifesto": body.manifesto, "biography": body.biography, "status": "nominated", "created_at": now()}
    try:
        await db.candidates.insert_one(c)
    except DuplicateKeyError:
        raise ApiError(409, "duplicate_nomination", "This student is already nominated for this position.")
    await audit("candidate.nominated", user["_id"], "candidate", c["_id"], {"election_id": eid, "position_id": body.position_id})
    return out(c)


@router.put("/candidates/{cid}")
async def edit_candidate(cid: str, body: CandidateEditIn, user=Depends(admin_only)):
    c, _ = await _draft_candidate(cid)
    await db.candidates.update_one({"_id": cid}, {"$set": {"manifesto": body.manifesto, "biography": body.biography, "updated_at": now()}})
    await audit("candidate.edited", user["_id"], "candidate", cid, {"election_id": c["election_id"]})
    return out(await db.candidates.find_one({"_id": cid}))


@router.post("/candidates/{cid}/review")
async def review_candidate(cid: str, body: ReviewIn, user=Depends(admin_only)):
    c, e = await _draft_candidate(cid)
    if c["status"] != "nominated":
        raise ApiError(409, "already_reviewed", "Candidate has already been reviewed.")
    if body.decision == "reject" and len(body.reason.strip()) < 5:
        raise ApiError(422, "reason_required", "A rejection reason of at least 5 characters is required.")
    if body.decision == "approve":
        st = await db.students.find_one({"_id": c["student_user_id"]})
        fits, why = student_fits(e, st)
        if st["verification_status"] != "verified" or not fits:
            raise ApiError(409, "ineligible_candidate", "Candidate no longer satisfies eligibility rules.")
    status = "approved" if body.decision == "approve" else "rejected"
    await db.candidates.update_one({"_id": cid, "status": "nominated"}, {"$set": {"status": status, "reviewed_by": user["_id"], "review_reason": body.reason, "reviewed_at": now()}})
    await audit(f"candidate.{status}", user["_id"], "candidate", cid, {"election_id": c["election_id"], "reason": body.reason})
    return {"ok": True, "status": status}


@router.post("/candidates/{cid}/withdraw")
async def withdraw_candidate(cid: str, body: ActionIn, user=Depends(admin_only)):
    c, _ = await _draft_candidate(cid)
    await db.candidates.update_one({"_id": cid}, {"$set": {"status": "withdrawn", "review_reason": body.reason}})
    await audit("candidate.withdrawn", user["_id"], "candidate", cid, {"election_id": c["election_id"], "reason": body.reason})
    return {"ok": True}


@router.post("/elections/{eid}/approvals", status_code=201)
async def request_approval(eid: str, body: ApprovalIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if not e["policy"]["require_two_person"]:
        raise ApiError(409, "not_required", "This election does not use two-person approval.")
    needed = {"open": "scheduled", "finalize": "closed"}[body.action]
    if e["state"] != needed:
        raise ApiError(409, "invalid_state", f"'{body.action}' approval can only be requested when the election is {needed}.")
    if await db.approvals.find_one({"election_id": eid, "action": body.action, "status": {"$in": ["pending", "approved"]}}):
        raise ApiError(409, "exists", "An approval request for this action is already pending or approved.")
    a = {"_id": new_id(), "election_id": eid, "action": body.action, "status": "pending", "requested_by": user["_id"],
         "request_reason": body.reason, "created_at": now()}
    await db.approvals.insert_one(a)
    await audit("approval.requested", user["_id"], "approval", a["_id"], {"election_id": eid, "action": body.action, "reason": body.reason})
    return out(a)


@router.post("/approvals/{aid}/decision")
async def decide_approval(aid: str, body: ReviewIn, user=Depends(admin_only)):
    a = await db.approvals.find_one({"_id": aid})
    if not a or a["status"] != "pending":
        raise ApiError(409, "not_pending", "Approval request is not pending.")
    if a["requested_by"] == user["_id"]:
        raise ApiError(403, "same_admin", "A different administrator must decide this request.")
    status = "approved" if body.decision == "approve" else "rejected"
    res = await db.approvals.update_one({"_id": aid, "status": "pending"}, {"$set": {"status": status, "decided_by": user["_id"], "decision_reason": body.reason, "decided_at": now()}})
    if res.modified_count != 1:
        raise ApiError(409, "not_pending", "Approval request is not pending.")
    await audit(f"approval.{status}", user["_id"], "approval", aid, {"election_id": a["election_id"], "action": a["action"], "reason": body.reason})
    return {"ok": True, "status": status}


@router.get("/approvals")
async def list_approvals(status: str = "", page: int = 1, size: int = 20, user=Depends(reviewers)):
    res = await paginate(db.approvals, {"status": status} if status else {}, [("created_at", -1)], page, size)
    for item in res["items"]:
        e = await db.elections.find_one({"_id": item["election_id"]}, {"title": 1})
        item["election_title"] = e["title"] if e else None
        for k in ("requested_by", "decided_by"):
            u = await db.users.find_one({"_id": item.get(k)}, {"email": 1}) if item.get(k) else None
            item[f"{k}_email"] = u["email"] if u else None
    return res


async def auto_close_job():
    while True:
        try:
            n = 0
            async for e in db.elections.find({"state": {"$in": ["open", "paused"]}, "closes_at": {"$lte": now()}}):
                await refresh_state(e)
                n += 1
            await db.job_status.update_one({"_id": "auto_close"}, {"$set": {"last_run": now(), "ok": True, "closed": n}}, upsert=True)
        except Exception as ex:
            logger.error(f"auto_close_job failed: {type(ex).__name__}")
            await db.job_status.update_one({"_id": "auto_close"}, {"$set": {"last_run": now(), "ok": False, "error": type(ex).__name__}}, upsert=True)
        await asyncio.sleep(30)
