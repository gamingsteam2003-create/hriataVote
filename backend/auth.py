import base64
import hmac
import io
import os
import re
import secrets
from datetime import timedelta
from typing import Optional

import pyotp
import qrcode
from argon2 import PasswordHasher
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from core import (ApiError, COOKIE_SECURE, INITIAL_ADMIN_EMAIL, SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES,
                  audit, client_ip, db, ip_hash, logger, new_id, norm_reg, now, rate_limit, security_event, sha256)

router = APIRouter(prefix="/auth", tags=["auth"])
ph = PasswordHasher()
DUMMY_HASH = ph.hash(secrets.token_hex(16))
SESSION_COOKIE, CSRF_COOKIE = "vs_session", "vs_csrf"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
STAFF_ROLES = {"admin", "auditor", "operator"}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def hash_password(p: str) -> str:
    return ph.hash(p)


def verify_password(p: str, h: str) -> bool:
    try:
        return ph.verify(h, p)
    except Exception:
        return False


def check_strength(p: str):
    if len(p) < 10 or len(p) > 128 or not re.search(r"[A-Za-z]", p) or not re.search(r"\d", p):
        raise ApiError(422, "weak_password", "Password must be 10-128 characters and include letters and numbers.")


async def create_session(response: Response, user_id: str, request: Request):
    old = request.cookies.get(SESSION_COOKIE)
    if old:
        await db.sessions.delete_one({"token_hash": sha256(old)})
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    t = now()
    await db.sessions.insert_one({
        "_id": new_id(), "token_hash": sha256(token), "user_id": user_id, "csrf": csrf, "created_at": t,
        "last_seen": t, "expires_at": t + timedelta(hours=SESSION_ABSOLUTE_HOURS), "ip_hash": ip_hash(client_ip(request)),
    })
    age = SESSION_ABSOLUTE_HOURS * 3600
    response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=COOKIE_SECURE, samesite="none", max_age=age, path="/")
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=COOKIE_SECURE, samesite="none", max_age=age, path="/")


def clear_cookies(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


async def revoke_sessions(user_id: str):
    await db.sessions.delete_many({"user_id": user_id})


async def public_user(u: dict) -> dict:
    res = {"id": u["_id"], "email": u.get("email"), "name": u.get("name"), "role": u["role"], "status": u["status"],
           "must_change_password": u.get("must_change_password", False), "mfa_enabled": u.get("mfa_enabled", False)}
    if u["role"] == "student":
        s = await db.students.find_one({"_id": u["_id"]})
        if s:
            res["student"] = {"registration_number": s["registration_number"], "full_name": s["full_name"],
                              "department": s["department"], "semester": s["semester"],
                              "verification_status": s["verification_status"]}
    return res


async def load_session(request: Request) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise ApiError(401, "not_authenticated", "Please sign in to continue.")
    s = await db.sessions.find_one({"token_hash": sha256(token)})
    t = now()
    if not s or s["expires_at"] < t or s["last_seen"] < t - timedelta(minutes=SESSION_IDLE_MINUTES):
        if s:
            await db.sessions.delete_one({"_id": s["_id"]})
        raise ApiError(401, "session_expired", "Your session has expired. Please sign in again.")
    if request.method not in SAFE_METHODS:
        header = request.headers.get("x-csrf-token", "")
        if not header or not hmac.compare_digest(header, s["csrf"]):
            await security_event("csrf_rejected", "high", client_ip(request), s["user_id"], request.url.path)
            raise ApiError(403, "csrf_failed", "Security token missing or invalid. Refresh the page and try again.")
    user = await db.users.find_one({"_id": s["user_id"]})
    if not user or user["status"] != "active":
        raise ApiError(401, "not_authenticated", "Please sign in to continue.")
    if (t - s["last_seen"]).total_seconds() > 60:
        await db.sessions.update_one({"_id": s["_id"]}, {"$set": {"last_seen": t}})
    request.state.user = user
    return user


async def current_user(request: Request) -> dict:
    user = await load_session(request)
    if user.get("must_change_password"):
        raise ApiError(403, "password_change_required", "You must change your password before continuing.")
    return user


def require(*roles):
    async def dep(request: Request):
        user = await current_user(request)
        if user["role"] not in roles:
            await security_event("unauthorized_access", "medium", client_ip(request), user["_id"], f"{request.method} {request.url.path}")
            raise ApiError(403, "forbidden", "You do not have permission to perform this action.")
        return user
    return dep


def verify_totp(user: dict, code: str, secret: str = None) -> Optional[int]:
    secret = secret or user.get("mfa_secret")
    if not secret or not re.fullmatch(r"\d{6}", code or ""):
        return None
    totp, step = pyotp.TOTP(secret), int(now().timestamp() // 30)
    for s in (step - 1, step, step + 1):
        if s > user.get("mfa_last_step", 0) and hmac.compare_digest(totp.at(s * 30), code):
            return s
    return None


class LoginIn(Strict):
    identifier: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=128)


class MfaLoginIn(Strict):
    challenge_id: str = Field(max_length=100)
    code: str = Field(max_length=6)


class ChangePasswordIn(Strict):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class ResetIn(Strict):
    identifier: str = Field(min_length=3, max_length=120)
    token: str = Field(min_length=10, max_length=100)
    new_password: str = Field(max_length=128)


class CodeIn(Strict):
    code: str = Field(max_length=6)


class DisableMfaIn(Strict):
    password: str = Field(max_length=128)
    code: str = Field(max_length=6)


async def find_by_identifier(identifier: str):
    ident = identifier.strip()
    if "@" in ident:
        return await db.users.find_one({"email": ident.lower()})
    s = await db.students.find_one({"registration_number": norm_reg(ident)})
    return await db.users.find_one({"_id": s["_id"]}) if s else None


async def finish_login(user, request, response):
    await create_session(response, user["_id"], request)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now()}})
    if user["role"] in STAFF_ROLES:
        await audit("auth.staff_login", user["_id"], "user", user["_id"], {"role": user["role"]})
    return {"user": await public_user(user)}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ip = client_ip(request)
    await rate_limit(f"login_ip:{ip}", 30, 300)
    fkey = sha256(body.identifier.strip().lower())
    fail = await db.login_failures.find_one({"_id": fkey})
    if fail and fail["count"] >= 5:
        await security_event("login_locked", "high", ip, None, "account temporarily locked")
        raise ApiError(429, "account_locked", "Too many failed attempts. Try again in 15 minutes.")
    user = await find_by_identifier(body.identifier)
    ok = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)
    if not user or not ok or user["status"] != "active":
        await db.login_failures.update_one({"_id": fkey}, {"$inc": {"count": 1}, "$set": {"expires_at": now() + timedelta(minutes=15)}}, upsert=True)
        await security_event("failed_login", "low", ip, user["_id"] if user else None, "invalid credentials")
        raise ApiError(401, "invalid_credentials", "Invalid credentials.")
    await db.login_failures.delete_one({"_id": fkey})
    if user.get("mfa_enabled"):
        cid = secrets.token_urlsafe(24)
        await db.mfa_challenges.insert_one({"_id": sha256(cid), "user_id": user["_id"], "attempts": 0, "expires_at": now() + timedelta(minutes=5)})
        return {"mfa_required": True, "challenge_id": cid}
    return await finish_login(user, request, response)


@router.post("/mfa/login")
async def mfa_login(body: MfaLoginIn, request: Request, response: Response):
    await rate_limit(f"mfa_ip:{client_ip(request)}", 20, 300)
    ch = await db.mfa_challenges.find_one({"_id": sha256(body.challenge_id)})
    if not ch or ch["expires_at"] < now() or ch["attempts"] >= 5:
        raise ApiError(401, "invalid_challenge", "Verification expired. Please sign in again.")
    user = await db.users.find_one({"_id": ch["user_id"]})
    step = verify_totp(user, body.code)
    if step is None:
        await db.mfa_challenges.update_one({"_id": ch["_id"]}, {"$inc": {"attempts": 1}})
        await security_event("failed_mfa", "medium", client_ip(request), user["_id"], "invalid code")
        raise ApiError(401, "invalid_code", "Invalid authentication code.")
    await db.mfa_challenges.delete_one({"_id": ch["_id"]})
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"mfa_last_step": step}})
    return await finish_login(user, request, response)


@router.post("/logout")
async def logout(request: Request, response: Response):
    user = await load_session(request)
    await db.sessions.delete_one({"token_hash": sha256(request.cookies.get(SESSION_COOKIE, ""))})
    clear_cookies(response)
    return {"ok": True, "user_id": user["_id"]}


@router.get("/me")
async def me(request: Request):
    return {"user": await public_user(await load_session(request))}


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, request: Request, response: Response):
    user = await load_session(request)
    await rate_limit(f"chpw:{user['_id']}", 10, 900)
    if not verify_password(body.current_password, user["password_hash"]):
        raise ApiError(400, "invalid_password", "Current password is incorrect.")
    check_strength(body.new_password)
    if verify_password(body.new_password, user["password_hash"]):
        raise ApiError(400, "password_reused", "New password must differ from the current password.")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False, "password_changed_at": now()}})
    await revoke_sessions(user["_id"])
    await create_session(response, user["_id"], request)
    await audit("account.password_changed", user["_id"], "user", user["_id"], {})
    return {"ok": True}


@router.post("/reset-password")
async def reset_password(body: ResetIn, request: Request):
    await rate_limit(f"reset_ip:{client_ip(request)}", 10, 900)
    rec = await db.reset_tokens.find_one({"token_hash": sha256(body.token)})
    user = await find_by_identifier(body.identifier)
    if not rec or not user or rec["user_id"] != user["_id"] or rec.get("used_at") or rec["expires_at"] < now():
        await security_event("invalid_reset_token", "medium", client_ip(request), None, "reset attempt rejected")
        raise ApiError(400, "invalid_token", "Invalid or expired reset token.")
    check_strength(body.new_password)
    claimed = await db.reset_tokens.update_one({"_id": rec["_id"], "used_at": None}, {"$set": {"used_at": now()}})
    if claimed.modified_count != 1:
        raise ApiError(400, "invalid_token", "Invalid or expired reset token.")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False, "password_changed_at": now()}})
    await revoke_sessions(user["_id"])
    await audit("account.password_reset", user["_id"], "user", user["_id"], {"token_id": rec["_id"]})
    return {"ok": True}


@router.post("/mfa/setup")
async def mfa_setup(request: Request):
    user = await current_user(request)
    if user["role"] not in STAFF_ROLES:
        raise ApiError(403, "forbidden", "MFA is available for staff accounts.")
    secret = pyotp.random_base32()
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"mfa_pending_secret": secret}})
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name="VoteSecure")
    buf = io.BytesIO()
    qrcode.make(uri).save(buf, format="PNG")
    return {"secret": secret, "otpauth_uri": uri, "qr_png_base64": base64.b64encode(buf.getvalue()).decode()}


@router.post("/mfa/enable")
async def mfa_enable(body: CodeIn, request: Request, response: Response):
    user = await current_user(request)
    secret = user.get("mfa_pending_secret")
    step = verify_totp(user, body.code, secret) if secret else None
    if step is None:
        raise ApiError(400, "invalid_code", "Invalid authentication code.")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"mfa_enabled": True, "mfa_secret": secret, "mfa_last_step": step}, "$unset": {"mfa_pending_secret": ""}})
    await revoke_sessions(user["_id"])
    await create_session(response, user["_id"], request)
    await audit("account.mfa_enabled", user["_id"], "user", user["_id"], {})
    return {"ok": True}


@router.post("/mfa/disable")
async def mfa_disable(body: DisableMfaIn, request: Request):
    user = await current_user(request)
    if not verify_password(body.password, user["password_hash"]) or verify_totp(user, body.code) is None:
        raise ApiError(400, "invalid_credentials", "Password or authentication code is incorrect.")
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": ""}})
    await audit("account.mfa_disabled", user["_id"], "user", user["_id"], {})
    return {"ok": True}


async def provision_initial_admin():
    if await db.users.find_one({"email": INITIAL_ADMIN_EMAIL}):
        return
    pw = os.environ.get("INITIAL_ADMIN_PASSWORD")
    if not pw:
        logger.error("Initial administrator NOT provisioned: set the INITIAL_ADMIN_PASSWORD deployment secret and restart.")
        return
    uid, t = new_id(), now()
    await db.users.insert_one({"_id": uid, "email": INITIAL_ADMIN_EMAIL, "name": "Initial Administrator", "role": "admin",
                               "status": "active", "password_hash": hash_password(pw), "must_change_password": True,
                               "mfa_enabled": False, "created_at": t, "updated_at": t})
    await audit("account.admin_provisioned", "system", "user", uid, {"role": "admin"})
    logger.info("Initial administrator provisioned for configured email.")
