"""Live E2E test against preview URL — verifies candidate photo flow uses real object storage.
This complements test_votesecure.py (which mocks storage).
"""
import io
import os
import uuid
import datetime as dt
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://votesecure-7.preview.emergentagent.com").rstrip("/") + "/api/v1"
ADMIN_EMAIL = "hriatakhuptong1@gmail.com"
ADMIN_PW_INITIAL = "Vanlalhriata123"
ADMIN_PW_NEW = "AdminTest12345!"

PNG_1x1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108020000009077")  # minimal PNG header
# Build a tiny valid-ish PNG payload (sniff only checks the magic bytes)
PNG_DATA = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
JPEG_DATA = b"\xff\xd8\xff\xe0" + b"\x00" * 256 + b"\xff\xd9"

CTX = {}


class Client:
    def __init__(self):
        self.s = requests.Session()

    def login(self, ident, pw):
        r = self.s.post(f"{BASE}/auth/login", json={"identifier": ident, "password": pw}, timeout=20)
        r.raise_for_status()
        return r

    @property
    def csrf(self):
        return self.s.cookies.get("vs_csrf")

    def h(self):
        return {"X-CSRF-Token": self.csrf or ""}

    def post(self, path, **kw):
        return self.s.post(f"{BASE}{path}", headers={**self.h(), **kw.pop("headers", {})}, timeout=30, **kw)

    def get(self, path, **kw):
        return self.s.get(f"{BASE}{path}", timeout=30, **kw)


def _login_admin():
    c = Client()
    r = c.s.post(f"{BASE}/auth/login", json={"identifier": ADMIN_EMAIL, "password": ADMIN_PW_INITIAL}, timeout=20)
    if r.status_code == 200 and r.json()["user"].get("must_change_password"):
        cp = c.post("/auth/change-password", json={"current_password": ADMIN_PW_INITIAL, "new_password": ADMIN_PW_NEW})
        assert cp.status_code == 200, cp.text
        # re-login
        r = c.s.post(f"{BASE}/auth/login", json={"identifier": ADMIN_EMAIL, "password": ADMIN_PW_NEW}, timeout=20)
    elif r.status_code != 200:
        # maybe password was already changed; try new
        r = c.s.post(f"{BASE}/auth/login", json={"identifier": ADMIN_EMAIL, "password": ADMIN_PW_NEW}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return c


@pytest.fixture(scope="module")
def admin():
    c = _login_admin()
    return c


def test_health():
    r = requests.get(f"{BASE}/health", timeout=15)
    assert r.status_code == 200


def test_admin_login_and_create_election_with_candidate_photo(admin):
    now = dt.datetime.now(dt.timezone.utc)
    reg = f"LIVE-{uuid.uuid4().hex[:5].upper()}"
    # register a student
    pub = requests.Session()
    rr = pub.post(f"{BASE}/students/register", json={
        "full_name": "Live Photo Test", "registration_number": reg,
        "department": "BCA", "semester": 3, "email": None,
        "password": "StudentPass123", "confirm_password": "StudentPass123", "accept_rules": True
    }, timeout=20)
    assert rr.status_code == 201, rr.text

    # approve student via verification queue
    reqs = admin.get("/verification/requests").json()["items"]
    match = next((i for i in reqs if i["student"]["registration_number"] == reg), None)
    assert match, "verification request missing"
    d = admin.post(f"/verification/requests/{match['id']}/decision", json={"decision": "approve", "reason": "Live E2E photo test — approving for photo+ballot test coverage."})
    assert d.status_code == 200, d.text

    # create election (draft)
    body = {
        "title": f"Live Photo Test {uuid.uuid4().hex[:4]}",
        "election_type": "department", "academic_year": "2025-26",
        "scope": "department", "departments": ["BCA"], "semesters": [],
        "opens_at": (now - dt.timedelta(minutes=5)).isoformat(),
        "closes_at": (now + dt.timedelta(hours=2)).isoformat(),
        "timezone": "Asia/Kolkata",
        "positions": [{"title": "President", "max_selections": 1}], "policy": {}
    }
    er = admin.post("/elections", json=body)
    assert er.status_code == 201, er.text
    election = er.json()
    pos = election["positions"][0]["id"]

    # add candidate
    cr = admin.post(f"/elections/{election['id']}/candidates", json={
        "registration_number": reg, "position_id": pos, "manifesto": "live test"
    })
    assert cr.status_code == 201, cr.text
    cid = cr.json()["id"]
    CTX["cid"] = cid
    CTX["election"] = election

    # negative: non-image
    r = admin.post(f"/candidates/{cid}/photo",
                   files={"file": ("x.txt", io.BytesIO(b"not an image"), "text/plain")},
                   headers=admin.h())
    assert r.status_code == 415, r.text

    # negative: oversize
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024 + 10)
    r = admin.post(f"/candidates/{cid}/photo",
                   files={"file": ("big.png", io.BytesIO(big), "image/png")},
                   headers=admin.h())
    assert r.status_code == 413, r.text

    # positive: PNG upload — REAL object storage
    r = admin.post(f"/candidates/{cid}/photo",
                   files={"file": ("c.png", io.BytesIO(PNG_DATA), "image/png")},
                   headers=admin.h())
    assert r.status_code == 200, f"photo upload failed via real storage: {r.status_code} {r.text}"
    body = r.json()
    assert body["ok"] is True and body["photo_file_id"]
    CTX["photo_fid_1"] = body["photo_file_id"]

    # GET photo returns bytes
    r = admin.get(f"/candidates/{cid}/photo")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == PNG_DATA

    # Replace with JPEG
    r = admin.post(f"/candidates/{cid}/photo",
                   files={"file": ("c.jpg", io.BytesIO(JPEG_DATA), "image/jpeg")},
                   headers=admin.h())
    assert r.status_code == 200
    assert r.json()["photo_file_id"] != CTX["photo_fid_1"]

    r = admin.get(f"/candidates/{cid}/photo")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert r.content == JPEG_DATA

    # Remove
    r = admin.post(f"/candidates/{cid}/photo/remove", json={"reason": "test cleanup"})
    assert r.status_code == 200
    r = admin.get(f"/candidates/{cid}/photo")
    assert r.status_code == 404

    # Re-upload for subsequent ballot test
    r = admin.post(f"/candidates/{cid}/photo",
                   files={"file": ("c.png", io.BytesIO(PNG_DATA), "image/png")},
                   headers=admin.h())
    assert r.status_code == 200

    CTX["student_reg"] = reg


def test_student_cannot_see_photo_while_election_draft(admin):
    reg = CTX["student_reg"]
    cid = CTX["cid"]
    s = requests.Session()
    lr = s.post(f"{BASE}/auth/login", json={"identifier": reg, "password": "StudentPass123"}, timeout=20)
    assert lr.status_code == 200
    r = s.get(f"{BASE}/candidates/{cid}/photo", timeout=20)
    assert r.status_code == 404, f"draft photo visible to student: {r.status_code}"


def test_full_election_flow_with_photo(admin):
    e = CTX["election"]
    cid = CTX["cid"]
    pos = e["positions"][0]["id"]
    # approve candidate
    r = admin.post(f"/candidates/{cid}/review", json={"decision": "approve", "reason": ""})
    assert r.status_code == 200, r.text
    # generate eligibility & lock
    gen = admin.post(f"/elections/{e['id']}/eligibility/generate", json={})
    assert gen.status_code == 200, gen.text
    lk = admin.post(f"/elections/{e['id']}/eligibility-lock/lock", json={})
    assert lk.status_code == 200, lk.text
    # schedule + open (opens_at is in future, but server may require manual actions)
    sc = admin.post(f"/elections/{e['id']}/actions/schedule", json={"reason": "ready to go"})
    assert sc.status_code in (200, 409), sc.text
    op = admin.post(f"/elections/{e['id']}/actions/open", json={"reason": "open now please"})
    assert op.status_code == 200, op.text

    # now student should be able to see photo
    s = requests.Session()
    lr = s.post(f"{BASE}/auth/login", json={"identifier": CTX["student_reg"], "password": "StudentPass123"}, timeout=20)
    assert lr.status_code == 200
    ph = s.get(f"{BASE}/candidates/{cid}/photo", timeout=20)
    assert ph.status_code == 200, f"open-election photo not accessible to student: {ph.status_code}"
    assert ph.headers["content-type"].startswith("image/")

    # cast ballot
    csrf = s.cookies.get("vs_csrf")
    bl = s.post(f"{BASE}/ballots", json={
        "election_id": e["id"],
        "selections": [{"position_id": pos, "candidate_ids": [cid]}]
    }, headers={"X-CSRF-Token": csrf}, timeout=20)
    assert bl.status_code == 201, bl.text
    receipt = bl.json()["receipt"]
    # duplicate rejected
    bl2 = s.post(f"{BASE}/ballots", json={
        "election_id": e["id"],
        "selections": [{"position_id": pos, "candidate_ids": [cid]}]
    }, headers={"X-CSRF-Token": csrf}, timeout=20)
    assert bl2.status_code == 409, bl2.text

    # close, reconcile, finalize, publish
    cl = admin.post(f"/elections/{e['id']}/actions/close", json={"reason": "closing live test"})
    assert cl.status_code == 200, cl.text
    rc = admin.post(f"/elections/{e['id']}/reconcile", json={})
    assert rc.status_code == 200 and rc.json()["passed"] is True, rc.text
    fn = admin.post(f"/elections/{e['id']}/finalize", json={"reason": "verified live"})
    assert fn.status_code == 200, fn.text
    pb = admin.post(f"/elections/{e['id']}/publish", json={"reason": "publish live"})
    assert pb.status_code == 200, pb.text
    CTX["receipt"] = receipt
