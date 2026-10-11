import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Request
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")

APP_ENV = os.environ["APP_ENV"]
COOKIE_SECURE = os.environ["COOKIE_SECURE"].lower() == "true"
AUDIT_CHECKPOINT_KEY = os.environ["AUDIT_CHECKPOINT_KEY"]
AUDIT_CHECKPOINT_DIR = Path(os.environ["AUDIT_CHECKPOINT_DIR"])
CORS_ORIGINS = [o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()]
INITIAL_ADMIN_EMAIL = os.environ["INITIAL_ADMIN_EMAIL"].strip().lower()
SESSION_IDLE_MINUTES = int(os.environ.get("SESSION_IDLE_MINUTES", "30"))
SESSION_ABSOLUTE_HOURS = int(os.environ.get("SESSION_ABSOLUTE_HOURS", "8"))

if APP_ENV == "production" and (len(AUDIT_CHECKPOINT_KEY) < 32 or not COOKIE_SECURE):
    raise RuntimeError("Production requires AUDIT_CHECKPOINT_KEY (>=32 chars) and COOKIE_SECURE=true")

client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]
STATE = {"transactions": False, "started_at": None}


class RedactFilter(logging.Filter):
    PATTERN = re.compile(r"(password|token|secret|code|selections)([\"']?\s*[:=]\s*)([^\s,}]+)", re.I)

    def filter(self, record):
        record.msg = self.PATTERN.sub(r"\1\2[REDACTED]", str(record.msg))
        return True


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("votesecure")
logger.addFilter(RedactFilter())


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def new_id() -> str:
    return str(uuid.uuid4())


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def norm_reg(s: str) -> str:
    return re.sub(r"\s+", "", s or "").upper()


def norm_name(s: str) -> str:
    return " ".join((s or "").split()).casefold()


def norm_dept(s: str) -> str:
    return " ".join((s or "").split()).upper()


_NAME_EXTRA = set(" '’\u2018-.")


def valid_name(s: str) -> bool:
    name = (s or "").strip()
    if not (2 <= len(name) <= 100) or not name[0].isalpha():
        return False
    letters = 0
    for ch in name:
        if ch.isalpha():
            letters += 1
        elif ch not in _NAME_EXTRA:
            return False
    return letters >= 2


REG_RE = re.compile(r"^[A-Z0-9/\-]{3,30}$")
DEPT_RE = re.compile(r"^[A-Z0-9 &().\-]{2,60}$")


def out(doc, exclude=()):
    if doc is None:
        return None
    res = {}
    for k, v in doc.items():
        if k in exclude:
            continue
        key = "id" if k == "_id" else k
        if isinstance(v, datetime):
            v = iso(v)
        elif isinstance(v, list):
            v = [out(i) if isinstance(i, dict) else (iso(i) if isinstance(i, datetime) else i) for i in v]
        elif isinstance(v, dict):
            v = out(v)
        res[key] = v
    return res


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def ip_hash(ip: str) -> str:
    return sha256(AUDIT_CHECKPOINT_KEY + ip)[:16]


async def rate_limit(key: str, limit: int, window_seconds: int):
    bucket = int(now().timestamp() // window_seconds)
    doc = await db.rate_limits.find_one_and_update(
        {"_id": f"{key}:{bucket}"},
        {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(seconds=window_seconds * 2)}},
        upsert=True, return_document=True,
    )
    if doc["count"] > limit:
        await security_event("rate_limited", "medium", detail=key.split(":")[0])
        raise ApiError(429, "rate_limited", "Too many requests. Please wait and try again.")


async def security_event(kind: str, severity: str = "low", ip: str = None, user_id: str = None, detail: str = ""):
    await db.security_events.insert_one({
        "_id": new_id(), "kind": kind, "severity": severity, "ip_hash": ip_hash(ip) if ip else None,
        "user_id": user_id, "detail": detail[:200], "at": now(),
    })


_audit_lock = asyncio.Lock()
SENSITIVE_META = {"password", "token", "selections", "code", "secret", "candidate_ids"}


def audit_hash(ev: dict) -> str:
    body = {k: ev[k] for k in ("_id", "seq", "ts", "event_type", "actor_id", "target_type", "target_id", "meta", "prev_hash")}
    return sha256(canonical(body))


async def audit(event_type: str, actor_id, target_type: str, target_id, meta: dict = None):
    meta = {k: v for k, v in (meta or {}).items() if k not in SENSITIVE_META}
    async with _audit_lock:
        last = await db.audit_events.find_one(sort=[("seq", -1)])
        ev = {
            "_id": new_id(), "seq": (last["seq"] + 1) if last else 1, "ts": iso(now()),
            "event_type": event_type, "actor_id": actor_id, "target_type": target_type,
            "target_id": target_id, "meta": json.loads(canonical(meta)),
            "prev_hash": last["hash"] if last else "0" * 64,
        }
        ev["hash"] = audit_hash(ev)
        await db.audit_events.insert_one(ev)
    return ev


async def verify_audit_chain() -> dict:
    prev, expected_seq, count = "0" * 64, 1, 0
    async for ev in db.audit_events.find().sort("seq", 1):
        count += 1
        problem = None
        if ev["seq"] != expected_seq:
            problem = f"Sequence gap: expected {expected_seq}, found {ev['seq']}"
        elif ev["prev_hash"] != prev:
            problem = "Previous-hash link does not match preceding event"
        elif audit_hash(ev) != ev["hash"]:
            problem = "Event content does not match its stored hash (modified)"
        if problem:
            return {"ok": False, "checked": count, "first_inconsistency": {"seq": ev["seq"], "event_id": ev["_id"], "problem": problem}}
        prev, expected_seq = ev["hash"], expected_seq + 1
    cp_issue = await _verify_checkpoints()
    if cp_issue:
        return {"ok": False, "checked": count, "first_inconsistency": cp_issue}
    return {"ok": True, "checked": count, "head_hash": prev, "first_inconsistency": None}


def _sign(seq: int, h: str) -> str:
    return hmac.new(AUDIT_CHECKPOINT_KEY.encode(), f"{seq}:{h}".encode(), hashlib.sha256).hexdigest()


async def create_checkpoint(actor_id):
    last = await db.audit_events.find_one(sort=[("seq", -1)])
    if not last:
        return None
    cp = {"seq": last["seq"], "hash": last["hash"], "signature": _sign(last["seq"], last["hash"]), "at": iso(now()), "by": actor_id}
    AUDIT_CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_CHECKPOINT_DIR / "checkpoints.jsonl", "a") as f:
        f.write(canonical(cp) + "\n")
    await db.audit_checkpoints.insert_one({"_id": new_id(), **cp})
    return cp


async def _verify_checkpoints():
    path = AUDIT_CHECKPOINT_DIR / "checkpoints.jsonl"
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        cp = json.loads(line)
        if not hmac.compare_digest(_sign(cp["seq"], cp["hash"]), cp["signature"]):
            return {"seq": cp["seq"], "problem": "External checkpoint signature invalid"}
        ev = await db.audit_events.find_one({"seq": cp["seq"]})
        if not ev or ev["hash"] != cp["hash"]:
            return {"seq": cp["seq"], "problem": "Audit chain diverges from a signed external checkpoint (events rewritten or deleted)"}
    return None


async def paginate(coll, flt: dict, sort, page: int, size: int, exclude=()):
    page, size = max(page, 1), min(max(size, 1), 100)
    total = await coll.count_documents(flt)
    docs = await coll.find(flt).sort(sort).skip((page - 1) * size).limit(size).to_list(size)
    return {"items": [out(d, exclude) for d in docs], "total": total, "page": page, "size": size}


async def ensure_indexes():
    await db.users.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
    await db.students.create_index("registration_number", unique=True)
    await db.registry.create_index("registration_number", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.sessions.create_index("user_id")
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.login_failures.create_index("expires_at", expireAfterSeconds=0)
    await db.mfa_challenges.create_index("expires_at", expireAfterSeconds=0)
    await db.registry_previews.create_index("expires_at", expireAfterSeconds=0)
    await db.reset_tokens.create_index("token_hash", unique=True)
    await db.audit_events.create_index("seq", unique=True)
    await db.audit_events.create_index("event_type")
    await db.eligibility.create_index([("election_id", 1), ("user_id", 1)], unique=True)
    await db.participation.create_index([("election_id", 1), ("user_id", 1)], unique=True)
    await db.ballots.create_index("election_id")
    await db.ballots.create_index("receipt_hash", unique=True)
    await db.candidates.create_index([("election_id", 1), ("position_id", 1), ("student_user_id", 1)], unique=True)
    await db.election_results.create_index("election_id", unique=True)
    await db.approvals.create_index([("election_id", 1), ("action", 1), ("status", 1)])
    await db.verification_requests.create_index([("status", 1), ("created_at", -1)])
    await db.security_events.create_index("at")
    await db.request_metrics.create_index("hour")
