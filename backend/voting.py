import secrets
from typing import List

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from pymongo.errors import DuplicateKeyError

from auth import Strict, current_user, require
from core import (ApiError, STATE, audit, canonical, client, create_checkpoint, db, logger, new_id, now, out,
                  rate_limit, security_event, sha256, verify_audit_chain, client_ip)
from elections import ActionIn, get_election, student_fits

router = APIRouter(tags=["voting"])
student_only = require("student")
admin_only = require("admin")
reviewers = require("admin", "auditor")
VISIBLE_STATES = ["scheduled", "open", "paused", "closed", "finalized"]


class SelectionIn(Strict):
    position_id: str = Field(max_length=64)
    candidate_ids: List[str] = Field(default_factory=list, max_length=10)


class BallotIn(Strict):
    election_id: str = Field(max_length=64)
    selections: List[SelectionIn] = Field(max_length=20)


class ReceiptIn(Strict):
    election_id: str = Field(max_length=64)
    receipt: str = Field(min_length=10, max_length=64)


async def availability(e: dict, st: dict) -> dict:
    t = now()
    part = await db.participation.find_one({"election_id": e["_id"], "user_id": st["_id"], "status": "accepted"})
    elig = await db.eligibility.find_one({"election_id": e["_id"], "user_id": st["_id"], "status": "eligible"})
    reason = None
    if st["verification_status"] != "verified":
        reason = "Your student verification is not complete."
    elif not elig:
        fits, why = student_fits(e, st)
        reason = why or "You are not on this election's locked eligibility list."
    in_window = e["state"] == "open" and e["opens_at"] <= t < e["closes_at"]
    return {"eligible": bool(elig) and st["verification_status"] == "verified", "reason": reason, "participated": bool(part),
            "participated_at": out(part)["accepted_at"] if part else None,
            "can_vote": bool(elig) and st["verification_status"] == "verified" and in_window and not part}


def public_election(e: dict) -> dict:
    keys = ("_id", "title", "description", "election_type", "academic_year", "scope", "departments", "semesters", "opens_at",
            "closes_at", "timezone", "positions", "state", "result_status", "nomination_rules")
    res = out({k: e.get(k) for k in keys})
    res["allow_abstain"] = e["policy"]["allow_abstain"]
    return res


@router.get("/public/elections")
async def public_elections():
    items = await db.elections.find({"state": {"$in": VISIBLE_STATES}}).sort("opens_at", -1).to_list(50)
    return {"items": [{k: v for k, v in public_election(e).items() if k in ("id", "title", "election_type", "academic_year", "opens_at", "closes_at", "timezone", "state", "scope", "departments")} for e in items]}


@router.get("/student/elections")
async def student_elections(user=Depends(student_only)):
    st = await db.students.find_one({"_id": user["_id"]})
    res = []
    async for e in db.elections.find({"state": {"$in": VISIBLE_STATES}}).sort("opens_at", -1):
        e = await get_election(e["_id"])
        res.append(public_election(e) | {"availability": await availability(e, st)})
    return {"items": res}


@router.get("/student/elections/{eid}")
async def student_election(eid: str, user=Depends(student_only)):
    e = await get_election(eid)
    if e["state"] not in VISIBLE_STATES:
        raise ApiError(404, "not_found", "Election not found.")
    st = await db.students.find_one({"_id": user["_id"]})
    cands = await db.candidates.find({"election_id": eid, "status": "approved"}).sort("full_name", 1).to_list(500)
    fields = ("_id", "position_id", "full_name", "department", "semester", "manifesto", "biography")
    return public_election(e) | {"availability": await availability(e, st), "server_time": out({"t": now()})["t"],
                                 "candidates": [out({k: c[k] for k in fields}) | {"has_photo": bool(c.get("photo_file_id"))} for c in cands]}


async def validate_selections(e: dict, body: BallotIn) -> list:
    positions = {p["id"]: p for p in e["positions"]}
    cands = {c["_id"]: c for c in await db.candidates.find({"election_id": e["_id"], "status": "approved"}).to_list(1000)}
    seen, clean = set(), []
    for s in body.selections:
        p = positions.get(s.position_id)
        if not p or s.position_id in seen:
            raise ApiError(422, "invalid_ballot", "Ballot references an unknown or repeated position.")
        seen.add(s.position_id)
        ids = s.candidate_ids
        if len(ids) != len(set(ids)) or len(ids) > p["max_selections"]:
            raise ApiError(422, "invalid_ballot", f"'{p['title']}' allows at most {p['max_selections']} distinct selection(s).")
        if any(cands.get(i, {}).get("position_id") != s.position_id for i in ids):
            raise ApiError(422, "invalid_ballot", "Ballot contains a candidate that is not approved for this position.")
        clean.append({"position_id": s.position_id, "candidate_ids": sorted(ids)})
    for pid, p in positions.items():
        if pid not in seen:
            clean.append({"position_id": pid, "candidate_ids": []})
        if not e["policy"]["allow_abstain"] and not next(c for c in clean if c["position_id"] == pid)["candidate_ids"]:
            raise ApiError(422, "invalid_ballot", f"A selection is required for '{p['title']}'.")
    return sorted(clean, key=lambda c: c["position_id"])


async def _record(part, ballot, session=None):
    await db.participation.insert_one(part, session=session)
    await db.ballots.insert_one(ballot, session=session)
    await db.participation.update_one({"_id": part["_id"]}, {"$set": {"status": "accepted", "accepted_at": now()}}, session=session)


@router.post("/ballots", status_code=201)
async def submit_ballot(body: BallotIn, request: Request, user=Depends(student_only)):
    await rate_limit(f"ballot:{user['_id']}", 10, 60)
    ip = client_ip(request)

    async def reject(code, status, msg, kind="rejected_ballot"):
        await security_event(kind, "medium", ip, user["_id"], code)
        raise ApiError(status, code, msg)

    st = await db.students.find_one({"_id": user["_id"]})
    if not st or st["verification_status"] != "verified":
        await reject("not_verified", 403, "Only verified students can vote.")
    e = await db.elections.find_one({"_id": body.election_id})
    if not e:
        await reject("not_found", 404, "Election not found.")
    e = await get_election(e["_id"])
    t = now()
    if e["state"] != "open" or not (e["opens_at"] <= t < e["closes_at"]):
        await reject("election_not_open", 409, "This election is not currently open for voting.")
    if not await db.eligibility.find_one({"election_id": e["_id"], "user_id": user["_id"], "status": "eligible"}):
        await reject("not_eligible", 403, "You are not eligible to vote in this election.")
    if await db.participation.find_one({"election_id": e["_id"], "user_id": user["_id"]}):
        await reject("already_voted", 409, "Your ballot for this election has already been recorded.", "duplicate_vote_conflict")
    try:
        selections = await validate_selections(e, body)
    except ApiError as ex:
        await security_event("rejected_ballot", "medium", ip, user["_id"], ex.code)
        raise
    receipt = secrets.token_hex(16)
    part = {"_id": new_id(), "election_id": e["_id"], "user_id": user["_id"], "status": "pending", "started_at": t}
    ballot = {"_id": new_id(), "election_id": e["_id"], "selections": selections, "receipt_hash": sha256(receipt),
              "recorded_on": t.date().isoformat()}
    try:
        if STATE["transactions"]:
            async with await client.start_session() as s:
                async with s.start_transaction():
                    await _record(part, ballot, s)
        else:
            try:
                await _record(part, ballot)
            except DuplicateKeyError:
                raise
            except Exception:
                await db.ballots.delete_one({"_id": ballot["_id"]})
                await db.participation.delete_one({"_id": part["_id"], "status": "pending"})
                raise
    except DuplicateKeyError:
        await reject("already_voted", 409, "Your ballot for this election has already been recorded.", "duplicate_vote_conflict")
    except Exception as ex:
        logger.error(f"ballot transaction rolled back: {type(ex).__name__}")
        raise ApiError(500, "ballot_not_recorded", "Your ballot was NOT recorded due to a server error. Please try again.")
    return {"status": "accepted", "election_id": e["_id"], "receipt": receipt, "accepted_at": out({"t": now()})["t"]}


@router.get("/participation/me")
async def my_participation(user=Depends(student_only)):
    items = []
    async for p in db.participation.find({"user_id": user["_id"], "status": "accepted"}).sort("accepted_at", -1):
        e = await db.elections.find_one({"_id": p["election_id"]}, {"title": 1, "state": 1})
        items.append({"election_id": p["election_id"], "election_title": e["title"] if e else None, "accepted_at": out(p)["accepted_at"]})
    return {"items": items}


@router.post("/ballots/verify-receipt")
async def verify_receipt(body: ReceiptIn, user=Depends(current_user)):
    await rate_limit(f"receipt:{user['_id']}", 20, 300)
    found = await db.ballots.find_one({"election_id": body.election_id, "receipt_hash": sha256(body.receipt.strip().lower())}, {"_id": 1})
    return {"included": bool(found)}


async def tally(e: dict) -> dict:
    eid, allow_abstain = e["_id"], e["policy"]["allow_abstain"]
    cands = {c["_id"]: c for c in await db.candidates.find({"election_id": eid, "status": "approved"}).to_list(1000)}
    positions = {p["id"]: p for p in e["positions"]}
    votes = {cid: 0 for cid in cands}
    abst = {pid: 0 for pid in positions}
    count = invalid = 0
    async for b in db.ballots.find({"election_id": eid}):
        count += 1
        sel = {s["position_id"]: s["candidate_ids"] for s in b.get("selections", [])}
        ok = set(sel) == set(positions) and len(sel) == len(b.get("selections", []))
        for pid, ids in sel.items() if ok else []:
            p = positions[pid]
            if len(ids) != len(set(ids)) or len(ids) > p["max_selections"] or (not ids and not allow_abstain) \
                    or any(cands.get(i, {}).get("position_id") != pid for i in ids):
                ok = False
                break
        if not ok:
            invalid += 1
            continue
        for pid, ids in sel.items():
            abst[pid] += 0 if ids else 1
            for i in ids:
                votes[i] += 1
    result = []
    for pid, p in positions.items():
        cs = sorted([{"candidate_id": cid, "full_name": c["full_name"], "department": c["department"], "votes": votes[cid]}
                     for cid, c in cands.items() if c["position_id"] == pid], key=lambda x: -x["votes"])
        n = p["max_selections"]
        cutoff = cs[n - 1]["votes"] if len(cs) >= n else 0
        tie = len(cs) > n and cs[n]["votes"] == cutoff and cutoff > 0
        result.append({"position_id": pid, "title": p["title"], "max_selections": n, "abstentions": abst[pid], "candidates": cs,
                       "winners": [c["candidate_id"] for c in cs[:n] if c["votes"] > 0 and not (tie and c["votes"] == cutoff)], "tie": tie,
                       "selection_total": sum(c["votes"] for c in cs)})
    return {"positions": result, "ballot_count": count, "invalid_ballots": invalid}


@router.post("/elections/{eid}/reconcile")
async def reconcile(eid: str, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "closed":
        raise ApiError(409, "invalid_state", "Reconciliation requires a closed election.")
    t = await tally(e)
    accepted = await db.participation.count_documents({"election_id": eid, "status": "accepted"})
    pending = await db.participation.count_documents({"election_id": eid, "status": {"$ne": "accepted"}})
    eligible_ids = set(await db.eligibility.distinct("user_id", {"election_id": eid, "status": "eligible"}))
    voters = await db.participation.distinct("user_id", {"election_id": eid})
    outside = len([v for v in voters if v not in eligible_ids])
    dups = await db.participation.aggregate([{"$match": {"election_id": eid}}, {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
                                             {"$match": {"n": {"$gt": 1}}}]).to_list(10)
    valid = t["ballot_count"] - t["invalid_ballots"]
    sums_ok = all(p["abstentions"] + (1 if p["max_selections"] == 1 else 0) * p["selection_total"] == valid
                  for p in t["positions"] if p["max_selections"] == 1) and all(p["selection_total"] <= valid * p["max_selections"] for p in t["positions"])
    chain = await verify_audit_chain()
    checks = [
        ("closed", "Election is closed", True, ""),
        ("ballot_participation_match", "Accepted ballots equal participation records", t["ballot_count"] == accepted,
         f"{t['ballot_count']} ballot(s) vs {accepted} accepted participation record(s)"),
        ("no_incomplete", "No incomplete participation records", pending == 0, f"{pending} incomplete record(s)"),
        ("participants_eligible", "All participants were eligible", outside == 0, f"{outside} participant(s) not on eligibility list"),
        ("no_duplicates", "No duplicate participation", not dups, f"{len(dups)} duplicate participant(s)"),
        ("ballots_valid", "All ballots valid for election configuration", t["invalid_ballots"] == 0, f"{t['invalid_ballots']} invalid ballot(s)"),
        ("totals_consistent", "Candidate totals consistent with ballot count", sums_ok, "Per-position totals do not add up"),
        ("audit_integrity", "Audit chain integrity", chain["ok"], (chain["first_inconsistency"] or {}).get("problem", "")),
    ]
    checks = [{"key": k, "label": lbl, "passed": bool(p), "detail": d} for k, lbl, p, d in checks]
    passed = all(c["passed"] for c in checks)
    rec = {"_id": new_id(), "election_id": eid, "run_by": user["_id"], "run_at": now(), "passed": passed, "checks": checks,
           "totals": t["positions"], "ballot_count": t["ballot_count"], "participation_count": accepted, "eligible_count": len(eligible_ids)}
    await db.reconciliations.insert_one(rec)
    await db.elections.update_one({"_id": eid, "state": "closed"}, {"$set": {"result_status": "awaiting_approval" if passed else "reconciliation_failed",
                                                                         "latest_reconciliation_id": rec["_id"]}})
    if not passed:
        await security_event("reconciliation_mismatch", "high", None, user["_id"], ",".join(c["key"] for c in checks if not c["passed"]))
    await audit("reconciliation.passed" if passed else "reconciliation.failed", user["_id"], "election", eid,
                {"reconciliation_id": rec["_id"], "failed_checks": [c["key"] for c in checks if not c["passed"]]})
    await create_checkpoint(user["_id"])
    return out(rec)


@router.get("/elections/{eid}/reconciliations")
async def list_reconciliations(eid: str, user=Depends(reviewers)):
    return {"items": [out(r) for r in await db.reconciliations.find({"election_id": eid}).sort("run_at", -1).to_list(50)]}


@router.post("/elections/{eid}/finalize")
async def finalize(eid: str, body: ActionIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "closed" or e.get("result_status") != "awaiting_approval":
        raise ApiError(409, "not_ready", "Finalization requires a closed election with a passed reconciliation.")
    rec = await db.reconciliations.find_one({"_id": e.get("latest_reconciliation_id")})
    chain = await verify_audit_chain()
    if not rec or not rec["passed"] or not chain["ok"]:
        raise ApiError(409, "integrity_failed", "Finalization blocked: reconciliation or audit-integrity checks have not passed.")
    if await db.ballots.count_documents({"election_id": eid}) != rec["ballot_count"]:
        raise ApiError(409, "integrity_failed", "Finalization blocked: ballot count changed since reconciliation. Re-run reconciliation.")
    approval = None
    if e["policy"]["require_two_person"]:
        approval = await db.approvals.find_one_and_update({"election_id": eid, "action": "finalize", "status": "approved"},
                                                          {"$set": {"status": "executed", "executed_at": now(), "executed_by": user["_id"]}})
        if not approval:
            raise ApiError(409, "approval_required", "A second administrator must approve finalization.")
    t = now()
    integrity = sha256(canonical({"election_id": eid, "totals": rec["totals"], "reconciliation_id": rec["_id"], "audit_head": chain["head_hash"]}))
    result = {"_id": new_id(), "election_id": eid, "totals": rec["totals"], "ballot_count": rec["ballot_count"], "reconciliation_id": rec["_id"],
              "approval_id": approval["_id"] if approval else None, "finalized_by": user["_id"], "finalized_at": t,
              "integrity_hash": integrity, "audit_head_hash": chain["head_hash"], "published": False}
    try:
        await db.election_results.insert_one(result)
    except DuplicateKeyError:
        raise ApiError(409, "already_finalized", "Results for this election are already finalized and cannot be overwritten.")
    await db.elections.update_one({"_id": eid, "state": "closed"}, {"$set": {"state": "finalized", "result_status": "finalized", "finalized_at": t}})
    await audit("election.finalized", user["_id"], "election", eid, {"result_id": result["_id"], "integrity_hash": integrity, "reason": body.reason})
    await create_checkpoint(user["_id"])
    return out(result)


@router.post("/elections/{eid}/publish")
async def publish(eid: str, body: ActionIn, user=Depends(admin_only)):
    e = await get_election(eid)
    if e["state"] != "finalized":
        raise ApiError(409, "not_finalized", "Only finalized results can be published.")
    if e["policy"]["disclosure"] != "public_after_publication":
        raise ApiError(409, "restricted", "This election's disclosure policy does not permit public results.")
    res = await db.election_results.update_one({"election_id": eid, "published": False}, {"$set": {"published": True, "published_at": now(), "published_by": user["_id"]}})
    if res.modified_count != 1:
        raise ApiError(409, "already_published", "Results are already published.")
    await db.elections.update_one({"_id": eid}, {"$set": {"result_status": "published"}})
    await audit("results.published", user["_id"], "election", eid, {"reason": body.reason})
    return {"ok": True}


@router.get("/results/public")
async def public_results():
    items = []
    async for r in db.election_results.find({"published": True}).sort("published_at", -1):
        e = await db.elections.find_one({"_id": r["election_id"]})
        items.append(out({k: r[k] for k in ("election_id", "totals", "ballot_count", "finalized_at", "published_at", "integrity_hash")})
                     | {"title": e["title"], "academic_year": e["academic_year"]})
    return {"items": items}


@router.get("/results/{eid}")
async def get_result(eid: str, user=Depends(reviewers)):
    r = await db.election_results.find_one({"election_id": eid})
    if not r:
        raise ApiError(404, "not_found", "No finalized results are available for this election.")
    return out(r)


@router.get("/results")
async def list_results(user=Depends(reviewers)):
    items = []
    async for r in db.election_results.find().sort("finalized_at", -1):
        e = await db.elections.find_one({"_id": r["election_id"]}, {"title": 1})
        items.append(out(r) | {"title": e["title"] if e else None})
    return {"items": items}
