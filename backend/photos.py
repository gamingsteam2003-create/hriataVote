import asyncio
import io
import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from PIL import Image

import storage
from auth import require
from core import ApiError, audit, db, logger, new_id, now
from elections import ActionIn, _draft_candidate

router = APIRouter(tags=["candidates"])
admin_only = require("admin")
viewers = require("admin", "auditor", "student")
MAX_BYTES = 2 * 1024 * 1024
STUDENT_VISIBLE = {"scheduled", "open", "paused", "closed", "finalized"}


def sniff(data: bytes):
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


@router.post("/candidates/{cid}/photo")
async def upload_photo(cid: str, file: UploadFile = File(...), user=Depends(admin_only)):
    c, _ = await _draft_candidate(cid)
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES:
        raise ApiError(413, "file_too_large", "Photo must be 2 MB or smaller.")
    kind = sniff(data)
    if not kind or file.content_type != kind[0]:
        raise ApiError(415, "invalid_image", "Upload a JPEG, PNG or WebP image.")
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise ApiError(415, "invalid_image", "Upload a valid JPEG, PNG or WebP image.")
    path = f"{storage.APP_NAME}/candidates/{c['election_id']}/{uuid.uuid4()}.{kind[1]}"
    try:
        result = await asyncio.to_thread(storage.put_object, path, data, kind[0])
    except Exception as ex:
        logger.error(f"photo upload failed: {type(ex).__name__}")
        raise ApiError(502, "storage_unavailable", "Photo storage is unavailable. Please try again later.")
    fid = new_id()
    await db.files.insert_one({"_id": fid, "storage_path": result["path"], "content_type": kind[0], "size": len(data), "candidate_id": cid,
                               "uploaded_by": user["_id"], "is_deleted": False, "created_at": now()})
    if c.get("photo_file_id"):
        await db.files.update_one({"_id": c["photo_file_id"]}, {"$set": {"is_deleted": True}})
    await db.candidates.update_one({"_id": cid}, {"$set": {"photo_file_id": fid}})
    await audit("candidate.photo_uploaded", user["_id"], "candidate", cid, {"election_id": c["election_id"], "file_id": fid})
    return {"ok": True, "photo_file_id": fid}


@router.post("/candidates/{cid}/photo/remove")
async def remove_photo(cid: str, body: ActionIn, user=Depends(admin_only)):
    c, _ = await _draft_candidate(cid)
    if not c.get("photo_file_id"):
        raise ApiError(404, "no_photo", "This candidate has no photo.")
    await db.files.update_one({"_id": c["photo_file_id"]}, {"$set": {"is_deleted": True}})
    await db.candidates.update_one({"_id": cid}, {"$unset": {"photo_file_id": ""}})
    await audit("candidate.photo_removed", user["_id"], "candidate", cid, {"election_id": c["election_id"], "reason": body.reason})
    return {"ok": True}


@router.get("/candidates/{cid}/photo")
async def get_photo(cid: str, user=Depends(viewers)):
    c = await db.candidates.find_one({"_id": cid})
    if user["role"] == "student" and c:
        e = await db.elections.find_one({"_id": c["election_id"]}, {"state": 1})
        if c["status"] != "approved" or not e or e["state"] not in STUDENT_VISIBLE:
            c = None
    f = await db.files.find_one({"_id": c.get("photo_file_id"), "is_deleted": False}) if c and c.get("photo_file_id") else None
    if not f:
        raise ApiError(404, "not_found", "Photo not found.")
    try:
        data = await asyncio.to_thread(storage.get_object, f["storage_path"])
    except Exception as ex:
        logger.error(f"photo download failed: {type(ex).__name__}")
        raise ApiError(502, "storage_unavailable", "Photo storage is unavailable.")
    return Response(content=data, media_type=f["content_type"])
