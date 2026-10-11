"""VoteSecure automated API tests. Uses a separate database (votesecure_test) and synthetic data only."""
import io
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

os.environ["DB_NAME"] = "votesecure_test"
os.environ["APP_ENV"] = "test"
os.environ["INITIAL_ADMIN_EMAIL"] = "test-admin@votesecure.test"
os.environ["INITIAL_ADMIN_PASSWORD"] = "InitialTest12345"
os.environ["AUDIT_CHECKPOINT_DIR"] = "/tmp/votesecure_test_checkpoints"
os.environ["REGISTER_RATE_LIMIT"] = "200"

import shutil  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pymongo import MongoClient  # noqa: E402

sync = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ["DB_NAME"]]
sync.client.drop_database(os.environ["DB_NAME"])
shutil.rmtree(os.environ["AUDIT_CHECKPOINT_DIR"], ignore_errors=True)

import server  # noqa: E402
import voting  # noqa: E402

V = "/api/v1"
PW = "StrongPass123"
CTX = {}


class User:
    def __init__(self, c, ident, pw):
        r = c.post(f"{V}/auth/login", json={"identifier": ident, "password": pw})
        assert r.status_code == 200, r.text
        self.c, self.tok, self.csrf, self.data = c, r.cookies["vs_session"], r.cookies["vs_csrf"], r.json()["user"]
        c.cookies.clear()

    def h(self, csrf=True):
        h = {"Cookie": f"vs_session={self.tok}; vs_csrf={self.csrf}"}
        if csrf:
            h["X-CSRF-Token"] = self.csrf
        return h

    def get(self, p, **kw):
        return self.c.get(V + p, headers=self.h(), **kw)

    def post(self, p, json=None, csrf=True, **kw):
        r = self.c.post(V + p, json=json, headers=self.h(csrf), **kw)
        if "vs_session" in r.cookies:
            self.tok, self.csrf = r.cookies["vs_session"], r.cookies["vs_csrf"]
        self.c.cookies.clear()
        return r


@pytest.fixture(scope="module")
def c():
    with TestClient(server.app, base_url="https://testserver") as client:
        yield client


def iso(dt):
    return dt.isoformat()


def register(c, reg, name, dept="BCA", sem=3):
    return c.post(f"{V}/students/register", json={"full_name": name, "registration_number": reg, "department": dept, "semester": sem,
                                                  "email": None, "password": PW, "confirm_password": PW, "accept_rules": True})


# ---------- authentication ----------
def test_initial_admin_requires_password_change(c):
    admin = User(c, "test-admin@votesecure.test", "InitialTest12345")
    assert admin.data["must_change_password"] is True
    assert admin.get("/elections").status_code == 403
    old_tok = admin.tok
    r = admin.post("/auth/change-password", {"current_password": "InitialTest12345", "new_password": "AdminChanged123"})
    assert r.status_code == 200
    assert c.get(f"{V}/auth/me", headers={"Cookie": f"vs_session={old_tok}"}).status_code == 401, "old session must be invalidated"
    assert admin.get("/elections").status_code == 200
    CTX["admin"] = admin


def test_invalid_password_and_unknown_account_are_generic(c):
    a = c.post(f"{V}/auth/login", json={"identifier": "test-admin@votesecure.test", "password": "wrongwrong1"})
    b = c.post(f"{V}/auth/login", json={"identifier": "nobody@votesecure.test", "password": "wrongwrong1"})
    assert a.status_code == b.status_code == 401
    assert a.json()["error"]["message"] == b.json()["error"]["message"] == "Invalid credentials."


def test_login_lockout_after_repeated_failures(c):
    for _ in range(5):
        c.post(f"{V}/auth/login", json={"identifier": "lock@votesecure.test", "password": "badpass1234"})
    r = c.post(f"{V}/auth/login", json={"identifier": "lock@votesecure.test", "password": "badpass1234"})
    assert r.status_code == 429


def test_nosql_injection_in_login_rejected(c):
    r = c.post(f"{V}/auth/login", json={"identifier": {"$ne": None}, "password": {"$ne": None}})
    assert r.status_code == 422


def test_staff_accounts_and_auditor_operator(c):
    admin = CTX["admin"]
    for email, role in (("admin2@votesecure.test", "admin"), ("auditor@votesecure.test", "auditor"), ("ops@votesecure.test", "operator")):
        assert admin.post("/admin/users", {"email": email, "name": role.title(), "role": role, "temporary_password": "TempPass12345"}).status_code == 201
        u = User(c, email, "TempPass12345")
        assert u.post("/auth/change-password", {"current_password": "TempPass12345", "new_password": PW}).status_code == 200
        CTX[role if role != "admin" else "admin2"] = u


# ---------- registry & verification ----------
def test_registry_import_preview_and_commit(c):
    admin = CTX["admin"]
    csv_text = ("registration_number,full_name,department,semester,enrollment_status\n"
                "T-BCA-001,Asha Test,BCA,3,active\nT-BCA-002,Bina Test,BCA,3,active\nT-BCA-003,Chandra Test,BCA,3,active\n"
                "T-BBA-001,Dev Test,BBA,3,active\nT-BCA-004,Esha Test,BCA,3,active\n"
                "T-BAD-001,=HYPERLINK(\"x\"),BCA,3,active\nT-DUP-001,Dup One,BCA,3,active\nT-DUP-001,Dup Two,BCA,3,active\n")
    r = admin.post("/admin/registry/preview", files={"file": ("reg.csv", io.BytesIO(csv_text.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["summary"]["invalid_rows"] == 3 and p["summary"]["valid_rows"] == 5
    assert any("formula" in e for err in p["errors"] for e in err["errors"])
    assert admin.post("/admin/registry/commit", {"preview_id": p["preview_id"], "confirm": False}).status_code == 422
    r = admin.post("/admin/registry/commit", {"preview_id": p["preview_id"], "confirm": True})
    assert r.status_code == 200 and r.json()["summary"]["inserted"] == 5


def test_unsafe_upload_rejected(c):
    r = CTX["admin"].post("/admin/registry/preview", files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/x-msdownload")})
    assert r.status_code == 415


def test_registration_validation_duplicates_and_mismatch(c):
    for reg, name in (("T-BCA-002", "Bina Test"), ("T-BCA-003", "Chandra Test"), ("T-BBA-001", "Dev Test"), ("T-BCA-004", "Esha Test")):
        assert register(c, reg, name, "BBA" if "BBA" in reg else "BCA").status_code == 201
    assert register(c, "T-BCA-002", "Bina Test").status_code == 409
    assert register(c, "T-BCA-001", "<script>alert(1)</script>").status_code == 422
    r = register(c, "T-BCA-001", "Wrong Name")
    assert r.status_code == 201 and r.json()["verification_status"] == "under_review"
    st = sync.students.find_one({"registration_number": "T-BCA-001"})
    assert st["registry_match"] == "mismatch" and "full_name" in st["mismatch_fields"]


def test_public_registration_cannot_assign_role(c):
    r = c.post(f"{V}/students/register", json={"full_name": "Eve Test", "registration_number": "T-EVE-1", "department": "BCA", "semester": 3,
                                               "password": PW, "confirm_password": PW, "accept_rules": True, "role": "admin"})
    assert r.status_code == 422


def test_student_cannot_self_approve_or_export(c):
    s = User(c, "T-BCA-002", PW)
    req = sync.verification_requests.find_one({"user_id": s.data["id"]})
    assert s.post(f"/verification/requests/{req['_id']}/decision", {"decision": "approve", "reason": ""}).status_code == 403
    assert s.get("/admin/registry/export").status_code == 403
    assert s.get("/admin/students").status_code == 403
    assert c.put(f"{V}/students/me", json={"registration_number": "X"}, headers=s.h()).status_code == 405
    CTX["s_b"] = s


def test_admin_verification_decisions(c):
    admin = CTX["admin"]
    items = admin.get("/verification/requests").json()["items"]
    by_reg = {i["student"]["registration_number"]: i for i in items}
    mism = by_reg["T-BCA-001"]
    assert admin.post(f"/verification/requests/{mism['id']}/decision", {"decision": "approve", "reason": ""}).status_code == 422
    assert admin.post(f"/verification/requests/{mism['id']}/decision", {"decision": "reject", "reason": "Name mismatch"}).status_code == 200
    for reg in ("T-BCA-002", "T-BCA-003", "T-BBA-001"):
        assert admin.post(f"/verification/requests/{by_reg[reg]['id']}/decision", {"decision": "approve", "reason": ""}).status_code == 200
    assert admin.post(f"/verification/requests/{by_reg['T-BCA-002']['id']}/decision", {"decision": "approve", "reason": ""}).status_code == 409


# ---------- authorization ----------
def test_role_boundaries(c):
    s, aud, ops = CTX["s_b"], CTX["auditor"], CTX["operator"]
    assert s.get("/elections").status_code == 403
    assert aud.get("/elections").status_code == 200
    assert aud.post("/elections", {"title": "x"}).status_code in (403, 422)
    assert aud.post("/admin/users", {"email": "a@b.cd", "name": "X", "role": "admin", "temporary_password": PW}).status_code in (403, 422)
    assert ops.get("/elections").status_code == 403
    assert ops.get("/results").status_code == 403
    assert ops.get("/ops/status").status_code == 200
    assert s.get("/ops/status").status_code == 403


def test_csrf_required_for_state_changes(c):
    r = CTX["admin"].post("/verification/rematch", csrf=False)
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"


# ---------- election setup ----------
def _election(admin, opens, closes, **policy):
    body = {"title": f"Test Election {uuid.uuid4().hex[:4]}", "election_type": "department", "academic_year": "2025-26", "scope": "department",
            "departments": ["BCA"], "semesters": [], "opens_at": iso(opens), "closes_at": iso(closes), "timezone": "Asia/Kolkata",
            "positions": [{"title": "President", "max_selections": 1}], "policy": policy}
    r = admin.post("/elections", body)
    assert r.status_code == 201, r.text
    return r.json()


def test_election_validation(c):
    now = datetime.now(timezone.utc)
    r = CTX["admin"].post("/elections", {"title": "Bad", "election_type": "general", "academic_year": "2025-26", "scope": "college",
                                         "opens_at": iso(now + timedelta(hours=2)), "closes_at": iso(now + timedelta(hours=1)),
                                         "positions": [{"title": "P", "max_selections": 1}]})
    assert r.status_code == 422


def test_election_lifecycle_setup(c):
    admin, now = CTX["admin"], datetime.now(timezone.utc)
    e = _election(admin, now - timedelta(minutes=1), now + timedelta(hours=2))
    pos = e["positions"][0]["id"]
    assert admin.post(f"/elections/{e['id']}/actions/schedule", {"reason": "try early"}).status_code == 409
    for reg in ("T-BCA-002", "T-BCA-003"):
        r = admin.post(f"/elections/{e['id']}/candidates", {"registration_number": reg, "position_id": pos, "manifesto": "m"})
        assert r.status_code == 201, r.text
    assert admin.post(f"/elections/{e['id']}/candidates", {"registration_number": "T-BBA-001", "position_id": pos}).status_code == 409
    for cand in admin.get(f"/elections/{e['id']}/candidates").json()["items"]:
        assert admin.post(f"/candidates/{cand['id']}/review", {"decision": "approve", "reason": ""}).status_code == 200
    assert admin.post(f"/elections/{e['id']}/eligibility/generate").json()["eligible"] == 2
    assert admin.post(f"/elections/{e['id']}/eligibility-lock/lock").status_code == 200
    assert admin.post(f"/elections/{e['id']}/actions/open", {"reason": "skip schedule"}).status_code == 409
    assert admin.post(f"/elections/{e['id']}/actions/schedule", {"reason": "ready"}).status_code == 200
    assert admin.post(f"/elections/{e['id']}/actions/open", {"reason": "voting starts"}).status_code == 200
    CTX["e"], CTX["pos"] = e, pos
    CTX["cands"] = [c_["id"] for c_ in admin.get(f"/elections/{e['id']}/candidates").json()["items"]]


def test_candidates_locked_after_open(c):
    r = CTX["admin"].post(f"/candidates/{CTX['cands'][0]}/withdraw", {"reason": "late change"})
    assert r.status_code == 409


# ---------- voting ----------
def ballot(e, pos, cids, **extra):
    return {"election_id": e["id"], "selections": [{"position_id": pos, "candidate_ids": cids}], **extra}


def test_invalid_ballots_rejected(c):
    s = User(c, "T-BCA-003", PW)
    e, pos = CTX["e"], CTX["pos"]
    assert s.post("/ballots", ballot(e, pos, [str(uuid.uuid4())])).status_code == 422
    assert s.post("/ballots", ballot(e, pos, CTX["cands"])).status_code == 422
    assert s.post("/ballots", ballot(e, pos, [CTX["cands"][0]], submitted_at="2000-01-01T00:00:00Z")).status_code == 422
    assert s.post("/ballots", ballot(e, pos, [])).status_code == 422
    CTX["s_c"] = s


def test_candidate_from_other_election_rejected(c):
    admin, now = CTX["admin"], datetime.now(timezone.utc)
    e2 = _election(admin, now + timedelta(days=1), now + timedelta(days=2))
    pos2 = e2["positions"][0]["id"]
    cand = admin.post(f"/elections/{e2['id']}/candidates", {"registration_number": "T-BCA-002", "position_id": pos2}).json()
    assert CTX["s_c"].post("/ballots", ballot(CTX["e"], CTX["pos"], [cand["id"]])).status_code == 422
    assert CTX["s_c"].post("/ballots", ballot(e2, pos2, [cand["id"]])).status_code == 409, "draft/not-open election must reject"


def test_candidate_photo_upload_validation_and_access(c, monkeypatch):
    import storage
    stored = {}
    monkeypatch.setattr(storage, "put_object", lambda path, data, ct: stored.update({path: data}) or {"path": path, "size": len(data)})
    monkeypatch.setattr(storage, "get_object", lambda path: stored[path])
    admin, now = CTX["admin"], datetime.now(timezone.utc)
    e3 = _election(admin, now + timedelta(days=1), now + timedelta(days=2))
    cand = admin.post(f"/elections/{e3['id']}/candidates", {"registration_number": "T-BCA-003", "position_id": e3["positions"][0]["id"]}).json()
    from io import BytesIO as _BytesIO
    from PIL import Image as _PILImage
    _buf = _BytesIO(); _PILImage.new("RGB", (8, 8), (10, 120, 200)).save(_buf, "PNG"); png = _buf.getvalue()
    bogus = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    assert admin.post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", png, "image/jpeg")}).status_code == 415
    assert admin.post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", b"<svg onload=alert(1)>", "image/png")}).status_code == 415
    assert admin.post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", bogus, "image/png")}).status_code == 415, "garbage-after-magic rejected by image decode"
    assert admin.post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024), "image/png")}).status_code == 413
    assert CTX["s_c"].post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", png, "image/png")}).status_code == 403
    assert admin.post(f"/candidates/{cand['id']}/photo", files={"file": ("x.png", png, "image/png")}).status_code == 200
    r = admin.get(f"/candidates/{cand['id']}/photo")
    assert r.status_code == 200 and r.content == png and r.headers["content-type"] == "image/png"
    assert CTX["operator"].get(f"/candidates/{cand['id']}/photo").status_code == 403
    assert CTX["s_c"].get(f"/candidates/{cand['id']}/photo").status_code == 404, "draft-election photos hidden from students"


def test_transaction_failure_rolls_back(c, monkeypatch):
    async def failing(part, ballot_doc, session=None):
        await voting.db.participation.insert_one(part)
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(voting, "_record", failing)
    s = CTX["s_c"]
    r = s.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][0]]))
    assert r.status_code == 500
    assert sync.participation.count_documents({"user_id": s.data["id"]}) == 0


def test_eligible_vote_then_duplicate_and_retry(c):
    s = CTX["s_c"]
    r = s.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][0]]))
    assert r.status_code == 201 and r.json()["status"] == "accepted"
    CTX["receipt"] = r.json()["receipt"]
    assert s.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][1]])).status_code == 409
    b = sync.ballots.find_one({"election_id": CTX["e"]["id"]})
    assert "user_id" not in b and "student" not in str(b)
    assert s.post("/ballots/verify-receipt", {"election_id": CTX["e"]["id"], "receipt": CTX["receipt"]}).json()["included"] is True


def test_concurrent_submissions_accept_exactly_one(c):
    s = CTX["s_b"]
    with ThreadPoolExecutor(max_workers=6) as ex:
        codes = list(ex.map(lambda _: c.post(f"{V}/ballots", json=ballot(CTX["e"], CTX["pos"], [CTX["cands"][1]]), headers=s.h()).status_code, range(6)))
    assert codes.count(201) == 1 and all(x in (201, 409, 429) for x in codes), codes
    assert sync.participation.count_documents({"user_id": s.data["id"], "election_id": CTX["e"]["id"]}) == 1


def test_ineligible_and_unverified_rejected(c):
    d = User(c, "T-BBA-001", PW)
    assert d.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][0]])).status_code == 403
    u = User(c, "T-BCA-004", PW)
    assert u.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][0]])).status_code == 403


def test_no_totals_during_voting_and_turnout(c):
    admin = CTX["admin"]
    assert admin.post(f"/elections/{CTX['e']['id']}/reconcile").status_code == 409
    t = admin.get(f"/analytics/elections/{CTX['e']['id']}/turnout").json()
    assert t["eligible"] == 2 and t["participated"] == 2 and t["turnout_pct"] == 100.0
    for ev in sync.audit_events.find():
        assert "candidate_ids" not in str(ev["meta"]) and "selections" not in str(ev["meta"])


def test_vote_after_close_rejected(c):
    admin = CTX["admin"]
    assert admin.post(f"/elections/{CTX['e']['id']}/actions/close", {"reason": "voting ended"}).status_code == 200
    late = User(c, "T-BCA-003", PW)
    assert late.post("/ballots", ballot(CTX["e"], CTX["pos"], [CTX["cands"][0]])).status_code == 409


# ---------- integrity ----------
def test_audit_chain_detects_modification(c):
    aud = CTX["auditor"]
    assert aud.post("/audit/verify").json()["ok"] is True
    ev = sync.audit_events.find_one({"seq": 3})
    sync.audit_events.update_one({"_id": ev["_id"]}, {"$set": {"meta.tampered": True}})
    res = aud.post("/audit/verify").json()
    assert res["ok"] is False and res["first_inconsistency"]["seq"] == 3
    CTX["tampered"] = ev


def test_finalization_blocked_while_integrity_fails(c):
    admin = CTX["admin"]
    r = admin.post(f"/elections/{CTX['e']['id']}/reconcile").json()
    assert r["passed"] is False and any(ch["key"] == "audit_integrity" and not ch["passed"] for ch in r["checks"])
    assert admin.post(f"/elections/{CTX['e']['id']}/finalize", {"reason": "try"}).status_code == 409
    sync.audit_events.replace_one({"_id": CTX["tampered"]["_id"]}, CTX["tampered"])


def test_reconciliation_detects_inconsistent_totals(c):
    admin, eid = CTX["admin"], CTX["e"]["id"]
    fake = {"_id": str(uuid.uuid4()), "election_id": eid, "selections": [{"position_id": CTX["pos"], "candidate_ids": [CTX["cands"][0]]}],
            "receipt_hash": uuid.uuid4().hex, "recorded_on": "2025-01-01"}
    sync.ballots.insert_one(fake)
    r = admin.post(f"/elections/{eid}/reconcile").json()
    assert r["passed"] is False and any(ch["key"] == "ballot_participation_match" and not ch["passed"] for ch in r["checks"])
    sync.ballots.delete_one({"_id": fake["_id"]})


def test_reconcile_finalize_publish_and_immutability(c):
    admin, eid = CTX["admin"], CTX["e"]["id"]
    r = admin.post(f"/elections/{eid}/reconcile").json()
    assert r["passed"] is True, r["checks"]
    totals = {x["candidate_id"]: x["votes"] for x in r["totals"][0]["candidates"]}
    assert sum(totals.values()) == 2
    assert admin.post(f"/elections/{eid}/finalize", {"reason": "verified"}).status_code == 200
    assert admin.post(f"/elections/{eid}/finalize", {"reason": "again"}).status_code == 409
    assert c.put(f"{V}/results/{eid}", json={"totals": []}, headers=admin.h()).status_code == 405
    assert admin.post(f"/elections/{eid}/actions/open", {"reason": "reopen"}).status_code == 409
    assert admin.post(f"/elections/{eid}/publish", {"reason": "publish"}).status_code == 200
    pub = c.get(f"{V}/results/public").json()["items"]
    assert pub and pub[0]["election_id"] == eid


def test_two_person_approval_requires_different_admin(c):
    admin, admin2, now = CTX["admin"], CTX["admin2"], datetime.now(timezone.utc)
    e = _election(admin, now - timedelta(minutes=1), now + timedelta(hours=1), require_two_person=True)
    pos = e["positions"][0]["id"]
    cand = admin.post(f"/elections/{e['id']}/candidates", {"registration_number": "T-BCA-003", "position_id": pos}).json()
    admin.post(f"/candidates/{cand['id']}/review", {"decision": "approve", "reason": ""})
    admin.post(f"/elections/{e['id']}/eligibility/generate")
    admin.post(f"/elections/{e['id']}/eligibility-lock/lock")
    assert admin.post(f"/elections/{e['id']}/actions/schedule", {"reason": "ready"}).status_code == 200
    assert admin.post(f"/elections/{e['id']}/actions/open", {"reason": "open"}).status_code == 409
    ap = admin.post(f"/elections/{e['id']}/approvals", {"action": "open", "reason": "please approve"}).json()
    assert admin.post(f"/approvals/{ap['id']}/decision", {"decision": "approve", "reason": "self"}).status_code == 403
    assert admin2.post(f"/approvals/{ap['id']}/decision", {"decision": "approve", "reason": "ok"}).status_code == 200
    assert admin.post(f"/elections/{e['id']}/actions/open", {"reason": "open"}).status_code == 200


# ---------- password reset ----------
def test_reset_token_single_use_and_expiry(c):
    admin, s = CTX["admin"], CTX["s_b"]
    tok = admin.post(f"/admin/users/{s.data['id']}/reset-token").json()["token"]
    assert c.post(f"{V}/auth/reset-password", json={"identifier": "T-BCA-002", "token": tok, "new_password": "ResetPass12345"}).status_code == 200
    assert c.get(f"{V}/auth/me", headers=s.h()).status_code == 401, "sessions revoked after reset"
    assert c.post(f"{V}/auth/reset-password", json={"identifier": "T-BCA-002", "token": tok, "new_password": "ResetPass67890"}).status_code == 400
    tok2 = admin.post(f"/admin/users/{s.data['id']}/reset-token").json()["token"]
    sync.reset_tokens.update_many({"user_id": s.data["id"], "used_at": None}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}})
    assert c.post(f"{V}/auth/reset-password", json={"identifier": "T-BCA-002", "token": tok2, "new_password": "ResetPass67890"}).status_code == 400


def test_misc_security(c):
    assert c.post(f"{V}/students/register", content=b"x" * (4 * 1024 * 1024), headers={"Content-Type": "application/json"}).status_code == 413
    r = CTX["admin"].get("/admin/students", params={"q": "(.*"})
    assert r.status_code == 200
    h = c.get(f"{V}/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"


def test_name_validation_unicode_and_rejects(c):
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "Hriata Khuptong").status_code == 201
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "Hriata-Khuptong").status_code == 201
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "O'Connor").status_code == 201
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "José Ángel").status_code == 201
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "Hriata123").status_code == 422
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "Hriata@").status_code == 422
    assert register(c, f"NM-{uuid.uuid4().hex[:6]}", "A").status_code == 422


def test_semester_restricted_to_1_to_6(c):
    assert register(c, f"SEM-{uuid.uuid4().hex[:6]}", "Valid Sixth", sem=6).status_code == 201
    assert register(c, f"SEM-{uuid.uuid4().hex[:6]}", "Too High", sem=7).status_code == 422
    assert register(c, f"SEM-{uuid.uuid4().hex[:6]}", "Too High", sem=12).status_code == 422
    admin = CTX["admin"]
    csv_text = ("registration_number,full_name,department,semester,enrollment_status\n"
                "T-SEM-9,Hi There,BCA,7,active\nT-SEM-6,Ok Person,BCA,6,active\n")
    p = admin.post("/admin/registry/preview", files={"file": ("s.csv", io.BytesIO(csv_text.encode()), "text/csv")}).json()
    assert p["summary"]["valid_rows"] == 1 and p["summary"]["invalid_rows"] == 1
    assert any("semester" in e for err in p["errors"] for e in err["errors"])


def test_security_center_rbac_and_shape(c):
    admin = CTX["admin"]
    r = admin.get("/admin/security")
    assert r.status_code == 200, r.text
    d = r.json()
    assert {"categories", "audit", "health", "events", "reconciliation_failures"} <= set(d)
    assert len(d["categories"]) == 4 and d["audit"]["ok"] in (True, False)
    assert CTX["operator"].get("/admin/security").status_code == 403
    assert CTX["auditor"].get("/admin/security").status_code == 403


def test_signed_reports_download_and_verify(c):
    import reports
    admin = CTX["admin"]
    fp, sig = reports.sign_document({"demo": 1})
    assert admin.post("/reports/verify", {"fingerprint": fp, "signature": sig}).json()["valid"] is True
    bad = sig[:-1] + ("0" if sig[-1] != "0" else "1")
    assert admin.post("/reports/verify", {"fingerprint": fp, "signature": bad}).json()["valid"] is False
    assert CTX["operator"].get("/results/missing/report.pdf").status_code == 403
    assert admin.get("/results/does-not-exist/report.pdf").status_code == 404
    res = sync.election_results.find_one()
    assert res, "a finalized election is expected from earlier tests"
    eid = res["election_id"]
    r = admin.get(f"/results/{eid}/report.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF"
    rc = admin.get(f"/results/{eid}/report.csv")
    assert rc.status_code == 200 and "Position,Candidate" in rc.text
    rec = sync.reconciliations.find_one({"election_id": eid})
    if rec:
        rp = admin.get(f"/elections/{eid}/reconciliations/{rec['_id']}/report.pdf")
        assert rp.status_code == 200 and rp.content[:4] == b"%PDF"


def teardown_module(module):
    sync.client.drop_database(os.environ["DB_NAME"])
    shutil.rmtree(os.environ["AUDIT_CHECKPOINT_DIR"], ignore_errors=True)
