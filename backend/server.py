import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from core import APP_ENV, COOKIE_SECURE, CORS_ORIGINS, STATE, ApiError, db, ensure_indexes, logger, new_id, now
import auth
import elections
import monitor
import photos
import reports
import storage
import students
import voting

MAX_BODY = 3 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    STATE["started_at"] = now()
    await ensure_indexes()
    hello = await db.command("hello")
    STATE["transactions"] = bool(hello.get("setName") or hello.get("msg") == "isdbgrid")
    logger.info(f"MongoDB multi-document transactions supported: {STATE['transactions']}")
    await auth.provision_initial_admin()
    try:
        await asyncio.to_thread(storage.init_storage)
        logger.info("Object storage initialized")
    except Exception as ex:
        logger.error(f"Object storage init failed: {type(ex).__name__}")
    task = asyncio.create_task(elections.auto_close_job())
    yield
    task.cancel()


docs = APP_ENV != "production"
app = FastAPI(title="VoteSecure API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/v1/docs" if docs else None, openapi_url="/api/v1/openapi.json" if docs else None, redoc_url=None)


def err(status: int, code: str, message: str, request: Request, details=None):
    body = {"error": {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(ApiError)
async def api_error(request: Request, exc: ApiError):
    return err(exc.status, exc.code, exc.message, request, exc.details)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    details = [{"field": ".".join(str(p) for p in e["loc"][1:]) or "body", "msg": e["msg"]} for e in exc.errors()]
    return err(422, "validation_error", "Request validation failed.", request, details)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return err(exc.status_code, "http_error", str(exc.detail) if exc.status_code < 500 else "Server error.", request)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.error(f"unhandled error request_id={getattr(request.state, 'request_id', None)} type={type(exc).__name__}")
    return err(500, "server_error", "An unexpected error occurred.", request)


@app.middleware("http")
async def guard(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id", new_id())[:64]
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return err(413, "payload_too_large", "Request body too large.", request)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    if COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    route = request.scope.get("route")
    if route is not None and request.url.path.startswith("/api/v1"):
        cls = f"{response.status_code // 100}xx"
        await db.request_metrics.update_one({"hour": now().strftime("%Y-%m-%d %H:00"), "route": f"{request.method} {route.path}", "cls": cls},
                                            {"$inc": {"count": 1}}, upsert=True)
    return response


api = APIRouter(prefix="/api/v1")
for r in (auth.router, students.router, elections.router, photos.router, voting.router, reports.router, monitor.router):
    api.include_router(r)
app.include_router(api)

app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"])
