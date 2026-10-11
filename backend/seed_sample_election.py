"""One-off: create ONE real, finalized (not published) election so the signed
PDF/CSV report buttons are live in the admin UI. Run with: python seed_sample_election.py
Delete later with: python seed_sample_election.py --delete
"""
import asyncio
import secrets
import sys
from datetime import timedelta

from core import canonical, db, new_id, now, sha256, verify_audit_chain
from auth import hash_password

TITLE = "ICFAI Student Council 2026"
VOTERS = [("ICFAI-BCA-101", "Lal Ruata"), ("ICFAI-BCA-102", "Mary Zonun"), ("ICFAI-BCA-103", "John Pachuau")]
NOMINEES = [("ICFAI-BCA-101", "Lal Ruata"), ("ICFAI-BCA-102", "Mary Zonun")]


async def delete():
    e = await db.elections.find_one({"title": TITLE})
    if e:
        eid = e["_id"]
        for coll in ("candidates", "eligibility", "participation", "ballots", "election_results", "reconciliations", "approvals"):
            await db[coll].delete_many({"election_id": eid})
        await db.elections.delete_one({"_id": eid})
    regs = [v[0] for v in VOTERS]
    uids = [s["_id"] async for s in db.students.find({"registration_number": {"$in": regs}}, {"_id": 1})]
    await db.students.delete_many({"registration_number": {"$in": regs}})
    await db.users.delete_many({"_id": {"$in": uids}})
    await db.verification_requests.delete_many({"user_id": {"$in": uids}})
    print("deleted sample election and voters")


async def seed():
    if await db.elections.find_one({"title": TITLE}):
        print("already exists; skipping")
        return
    admin = await db.users.find_one({"role": "admin"}, sort=[("created_at", 1)])
    t = now()
    reg_to_uid = {}
    for reg, name in VOTERS:
        st = await db.students.find_one({"registration_number": reg})
        if st:
            reg_to_uid[reg] = st["_id"]
            continue
        uid = new_id()
        await db.users.insert_one({"_id": uid, "email": None, "name": name, "role": "student", "status": "active",
                                   "password_hash": hash_password(secrets.token_urlsafe(16)), "must_change_password": False,
                                   "created_at": t, "updated_at": t})
        await db.students.insert_one({"_id": uid, "registration_number": reg, "full_name": name, "department": "BCA",
                                      "semester": 5, "verification_status": "verified", "verified_at": t, "created_at": t, "updated_at": t})
        reg_to_uid[reg] = uid

    pid = new_id()
    eid = new_id()
    position = {"id": pid, "title": "President", "max_selections": 1, "description": "Student council president"}
    policy = {"require_two_person": False, "allow_extension": False, "allow_abstain": False,
              "disclosure": "public_after_publication", "one_nomination_per_student": True}
    await db.elections.insert_one({
        "_id": eid, "title": TITLE, "description": "Sample finalized election used to demonstrate signed report downloads.",
        "election_type": "general", "academic_year": "2026-27", "scope": "college", "departments": [], "semesters": [],
        "opens_at": t - timedelta(days=2), "closes_at": t - timedelta(days=1), "timezone": "Asia/Kolkata",
        "positions": [position], "policy": policy, "nomination_rules": "", "state": "finalized",
        "eligibility_locked": True, "eligibility_locked_at": t - timedelta(days=3), "result_status": "finalized",
        "created_by": admin["_id"] if admin else "system", "created_at": t - timedelta(days=5), "updated_at": t,
        "opened_at": t - timedelta(days=2), "closed_at": t - timedelta(days=1), "finalized_at": t})

    cand_ids = {}
    for reg, name in NOMINEES:
        cid = new_id()
        cand_ids[reg] = cid
        await db.candidates.insert_one({"_id": cid, "election_id": eid, "position_id": pid, "student_user_id": reg_to_uid[reg],
                                        "registration_number": reg, "full_name": name, "department": "BCA", "semester": 5,
                                        "manifesto": f"{name} for President.", "biography": "", "status": "approved",
                                        "reviewed_by": admin["_id"] if admin else "system", "reviewed_at": t, "created_at": t})

    for reg, uid in reg_to_uid.items():
        await db.eligibility.insert_one({"_id": new_id(), "election_id": eid, "user_id": uid, "status": "eligible",
                                         "reason": "rule:scope=college", "created_at": t - timedelta(days=3), "history": []})

    # two of three voters cast a ballot, both for the first nominee
    winner = cand_ids[NOMINEES[0][0]]
    voted = [VOTERS[0][0], VOTERS[1][0]]
    for reg in voted:
        uid = reg_to_uid[reg]
        await db.participation.insert_one({"_id": new_id(), "election_id": eid, "user_id": uid, "status": "accepted",
                                           "started_at": t - timedelta(days=1, minutes=5), "accepted_at": t - timedelta(days=1, minutes=4)})
        await db.ballots.insert_one({"_id": new_id(), "election_id": eid, "selections": [{"position_id": pid, "candidate_ids": [winner]}],
                                     "receipt_hash": sha256(secrets.token_hex(16)), "recorded_on": (t - timedelta(days=1)).date().isoformat()})

    totals = [{"position_id": pid, "title": "President", "max_selections": 1, "abstentions": 0,
               "candidates": [
                   {"candidate_id": cand_ids[NOMINEES[0][0]], "full_name": NOMINEES[0][1], "department": "BCA", "votes": 2},
                   {"candidate_id": cand_ids[NOMINEES[1][0]], "full_name": NOMINEES[1][1], "department": "BCA", "votes": 0}],
               "winners": [winner], "tie": False, "selection_total": 2}]
    checks = [{"key": k, "label": lbl, "passed": True, "detail": ""} for k, lbl in [
        ("closed", "Election is closed"), ("ballot_participation_match", "Accepted ballots equal participation records"),
        ("no_incomplete", "No incomplete participation records"), ("participants_eligible", "All participants were eligible"),
        ("no_duplicates", "No duplicate participation"), ("ballots_valid", "All ballots valid for election configuration"),
        ("totals_consistent", "Candidate totals consistent with ballot count"), ("audit_integrity", "Audit chain integrity")]]
    rid = new_id()
    await db.reconciliations.insert_one({"_id": rid, "election_id": eid, "run_by": admin["_id"] if admin else "system",
                                         "run_at": t, "passed": True, "checks": checks, "totals": totals,
                                         "ballot_count": 2, "participation_count": 2, "eligible_count": 3})
    chain = await verify_audit_chain()
    head = chain.get("head_hash", "0" * 64)
    integrity = sha256(canonical({"election_id": eid, "totals": totals, "reconciliation_id": rid, "audit_head": head}))
    await db.election_results.insert_one({"_id": new_id(), "election_id": eid, "totals": totals, "ballot_count": 2,
                                          "reconciliation_id": rid, "approval_id": None,
                                          "finalized_by": admin["_id"] if admin else "system", "finalized_at": t,
                                          "integrity_hash": integrity, "audit_head_hash": head, "published": False})
    await db.elections.update_one({"_id": eid}, {"$set": {"latest_reconciliation_id": rid}})
    print("seeded election", eid, "reconciliation", rid)


if __name__ == "__main__":
    asyncio.run(delete() if "--delete" in sys.argv else seed())
