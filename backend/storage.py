import os

import requests

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "votesecure"
_key = None


def init_storage(force: bool = False) -> str:
    global _key
    if _key and not force:
        return _key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    resp.raise_for_status()
    _key = resp.json()["storage_key"]
    return _key


def _request(method: str, path: str, headers=None, **kw):
    url = f"{STORAGE_URL}/objects/{path}"
    resp = requests.request(method, url, headers={"X-Storage-Key": init_storage(), **(headers or {})}, **kw)
    if resp.status_code == 404 and method == "PUT":
        resp = requests.request(method, url, headers={"X-Storage-Key": init_storage(force=True), **(headers or {})}, **kw)
    resp.raise_for_status()
    return resp


def put_object(path: str, data: bytes, content_type: str) -> dict:
    return _request("PUT", path, headers={"Content-Type": content_type}, data=data, timeout=120).json()


def get_object(path: str) -> bytes:
    return _request("GET", path, timeout=60).content
