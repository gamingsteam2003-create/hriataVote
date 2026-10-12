import os
from io import BytesIO
from pathlib import PurePosixPath

import cloudinary
import cloudinary.uploader
import requests
from cloudinary.utils import cloudinary_url


APP_NAME = "votesecure"


def _configure():
    cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME", "").strip()
    api_key = os.environ.get("CLOUDINARY_API_KEY", "").strip()
    api_secret = os.environ.get("CLOUDINARY_API_SECRET", "").strip()

    if not cloud_name or not api_key or not api_secret:
        raise RuntimeError(
            "Cloudinary configuration is incomplete. "
            "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, "
            "and CLOUDINARY_API_SECRET."
        )

    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )


def init_storage(force: bool = False) -> str:
    """Validate configuration without calling the old Emergent service."""
    _configure()
    return "cloudinary"


def _public_id(path: str) -> str:
    clean_path = path.strip("/")

    if not clean_path or ".." in PurePosixPath(clean_path).parts:
        raise ValueError("Invalid storage path.")

    # Cloudinary public IDs should not include the file extension.
    return str(PurePosixPath(clean_path).with_suffix(""))


def put_object(path: str, data: bytes, content_type: str) -> dict:
    _configure()

    allowed_types = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }

    if content_type not in allowed_types:
        raise ValueError("Unsupported image content type.")

    public_id = _public_id(path)

    result = cloudinary.uploader.upload(
        BytesIO(data),
        public_id=public_id,
        resource_type="image",
        overwrite=True,
        invalidate=True,
        format=allowed_types[content_type],
    )

    return {
        "path": result["public_id"] + "." + allowed_types[content_type]
    }


def get_object(path: str) -> bytes:
    _configure()

    clean_path = path.strip("/")
    suffix = PurePosixPath(clean_path).suffix.lower().lstrip(".")

    if suffix not in {"jpg", "jpeg", "png", "webp"}:
        raise ValueError("Unsupported stored image format.")

    public_id = _public_id(clean_path)

    url, _ = cloudinary_url(
        public_id,
        resource_type="image",
        type="upload",
        format=suffix,
        secure=True,
    )

    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.content
