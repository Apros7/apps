"""Single-user period tracker API with PIN lock and JSON storage."""

from __future__ import annotations

import json
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from passlib.context import CryptContext
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "config.json"
PERIODS_PATH = DATA_DIR / "periods.json"
WEIGHTS_PATH = DATA_DIR / "weights.json"
STATIC_DIR = ROOT / "cycle"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# In-memory session tokens for this process (fine for single-user home host)
sessions: set[str] = set()

# PIN brute-force protection: max attempts per IP in a sliding window
PIN_WINDOW_SEC = 15 * 60
PIN_MAX_ATTEMPTS = 8
_pin_attempts: dict[str, deque[float]] = defaultdict(deque)

NEW_APP_URL = "https://apros7.github.io/apps/cycle/"
MIGRATE_TTL_SEC = 30 * 60
migrate_tickets: dict[str, dict] = {}

app = FastAPI(title="Period Tracker", docs_url=None, redoc_url=None)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://apros7.github.io"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_pin_rate_limit(request: Request) -> None:
    ip = client_ip(request)
    now = time.time()
    bucket = _pin_attempts[ip]
    while bucket and now - bucket[0] > PIN_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= PIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many PIN attempts. Try again in a few minutes.",
        )
    bucket.append(now)


# ── Models ──────────────────────────────────────────────────────────────────


class PinBody(BaseModel):
    pin: str = Field(min_length=4, max_length=12)

    @field_validator("pin")
    @classmethod
    def digits_only(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("PIN must be digits only")
        return value


class PeriodCreate(BaseModel):
    start: date
    end: date

    @field_validator("end")
    @classmethod
    def end_after_start(cls, end: date, info) -> date:
        start = info.data.get("start")
        if start and end < start:
            raise ValueError("end must be on or after start")
        return end


class PeriodUpdate(BaseModel):
    start: date | None = None
    end: date | None = None


class Period(BaseModel):
    id: str
    start: str
    end: str


class WeightUpsert(BaseModel):
    weight_kg: float = Field(ge=25, le=400)


class WeightEntry(BaseModel):
    date: str
    weight_kg: float


class MigrateCreate(BaseModel):
    pin: str | None = None
    periods: list[Period] = Field(default_factory=list)
    weights: list[WeightEntry] = Field(default_factory=list)


# ── Storage helpers ──────────────────────────────────────────────────────────


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PERIODS_PATH.exists():
        PERIODS_PATH.write_text("[]\n", encoding="utf-8")
    if not WEIGHTS_PATH.exists():
        WEIGHTS_PATH.write_text("[]\n", encoding="utf-8")


def read_config() -> dict:
    ensure_data_dir()
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def write_config(config: dict) -> None:
    ensure_data_dir()
    CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def read_periods() -> list[dict]:
    ensure_data_dir()
    return json.loads(PERIODS_PATH.read_text(encoding="utf-8"))


def write_periods(periods: list[dict]) -> None:
    ensure_data_dir()
    periods = sorted(periods, key=lambda p: p["start"])
    PERIODS_PATH.write_text(json.dumps(periods, indent=2) + "\n", encoding="utf-8")


def read_weights() -> list[dict]:
    ensure_data_dir()
    return json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))


def write_weights(weights: list[dict]) -> None:
    ensure_data_dir()
    weights = sorted(weights, key=lambda entry: entry["date"])
    WEIGHTS_PATH.write_text(json.dumps(weights, indent=2) + "\n", encoding="utf-8")


def ranges_overlap(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    return a_start <= b_end and b_start <= a_end


# ── Auth ────────────────────────────────────────────────────────────────────


def require_auth(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    if token not in sessions:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return token


# ── Auth routes ─────────────────────────────────────────────────────────────


@app.get("/api/status")
def api_status(authorization: Annotated[str | None, Header()] = None) -> dict:
    config = read_config()
    setup_complete = bool(config.get("pin_hash"))
    authenticated = False
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        authenticated = token in sessions
    return {"setup_complete": setup_complete, "authenticated": authenticated}


@app.post("/api/setup")
def api_setup(body: PinBody, request: Request) -> dict:
    check_pin_rate_limit(request)
    config = read_config()
    if config.get("pin_hash"):
        raise HTTPException(status_code=400, detail="PIN already set")
    write_config(
        {
            "pin_hash": pwd_context.hash(body.pin),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    token = secrets.token_urlsafe(32)
    sessions.add(token)
    return {"token": token}


@app.post("/api/login")
def api_login(body: PinBody, request: Request) -> dict:
    check_pin_rate_limit(request)
    config = read_config()
    pin_hash = config.get("pin_hash")
    if not pin_hash:
        raise HTTPException(status_code=400, detail="PIN not set yet")
    if not pwd_context.verify(body.pin, pin_hash):
        raise HTTPException(status_code=401, detail="Incorrect PIN")
    token = secrets.token_urlsafe(32)
    sessions.add(token)
    return {"token": token}


@app.post("/api/logout")
def api_logout(token: Annotated[str, Depends(require_auth)]) -> dict:
    sessions.discard(token)
    return {"ok": True}


def _purge_migrate_tickets() -> None:
    now = time.time()
    expired = [key for key, item in migrate_tickets.items() if item["exp"] <= now]
    for key in expired:
        migrate_tickets.pop(key, None)


@app.post("/api/migrate")
def create_migrate(
    body: MigrateCreate,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    authed = False
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        authed = token in sessions
    if not authed:
        if not body.pin:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        check_pin_rate_limit(request)
        pin_hash = read_config().get("pin_hash")
        if not pin_hash or not pwd_context.verify(body.pin, pin_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect PIN")
    _purge_migrate_tickets()
    periods = [item.model_dump() for item in body.periods]
    weights = [item.model_dump() for item in body.weights]
    if not periods and not weights:
        periods = read_periods()
        weights = read_weights()
    token = secrets.token_urlsafe(16)
    migrate_tickets[token] = {
        "periods": periods,
        "weights": weights,
        "exp": time.time() + MIGRATE_TTL_SEC,
    }
    return {"token": token, "url": f"{NEW_APP_URL}?move={token}"}


@app.get("/api/migrate/{token}")
def take_migrate(token: str) -> dict:
    _purge_migrate_tickets()
    item = migrate_tickets.pop(token, None)
    if not item:
        raise HTTPException(status_code=404, detail="That move link expired. Try Move again.")
    return {"periods": item["periods"], "weights": item["weights"]}


# ── Period routes ───────────────────────────────────────────────────────────


@app.get("/api/periods")
def list_periods(_: Annotated[str, Depends(require_auth)]) -> list[Period]:
    return [Period(**p) for p in read_periods()]


@app.post("/api/periods", status_code=201)
def create_period(body: PeriodCreate, _: Annotated[str, Depends(require_auth)]) -> Period:
    periods = read_periods()
    for existing in periods:
        if ranges_overlap(
            body.start,
            body.end,
            date.fromisoformat(existing["start"]),
            date.fromisoformat(existing["end"]),
        ):
            raise HTTPException(status_code=400, detail="Overlaps an existing period")
    period = {
        "id": str(uuid.uuid4()),
        "start": body.start.isoformat(),
        "end": body.end.isoformat(),
    }
    periods.append(period)
    write_periods(periods)
    return Period(**period)


@app.patch("/api/periods/{period_id}")
def update_period(
    period_id: str, body: PeriodUpdate, _: Annotated[str, Depends(require_auth)]
) -> Period:
    periods = read_periods()
    target = next((p for p in periods if p["id"] == period_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Period not found")

    new_start = body.start or date.fromisoformat(target["start"])
    new_end = body.end or date.fromisoformat(target["end"])
    if new_end < new_start:
        raise HTTPException(status_code=400, detail="end must be on or after start")

    for existing in periods:
        if existing["id"] == period_id:
            continue
        if ranges_overlap(
            new_start,
            new_end,
            date.fromisoformat(existing["start"]),
            date.fromisoformat(existing["end"]),
        ):
            raise HTTPException(status_code=400, detail="Overlaps an existing period")

    target["start"] = new_start.isoformat()
    target["end"] = new_end.isoformat()
    write_periods(periods)
    return Period(**target)


@app.delete("/api/periods/{period_id}")
def delete_period(period_id: str, _: Annotated[str, Depends(require_auth)]) -> dict:
    periods = read_periods()
    filtered = [p for p in periods if p["id"] != period_id]
    if len(filtered) == len(periods):
        raise HTTPException(status_code=404, detail="Period not found")
    write_periods(filtered)
    return {"ok": True}


# ── Weight routes ────────────────────────────────────────────────────────────


@app.get("/api/weights")
def list_weights(_: Annotated[str, Depends(require_auth)]) -> list[WeightEntry]:
    return [WeightEntry(**entry) for entry in read_weights()]


@app.put("/api/weights/{entry_date}")
def upsert_weight(
    entry_date: date, body: WeightUpsert, _: Annotated[str, Depends(require_auth)]
) -> WeightEntry:
    weights = read_weights()
    iso_date = entry_date.isoformat()
    value = round(body.weight_kg, 2)
    existing = next((entry for entry in weights if entry["date"] == iso_date), None)
    if existing:
        existing["weight_kg"] = value
        entry = existing
    else:
        entry = {"date": iso_date, "weight_kg": value}
        weights.append(entry)
    write_weights(weights)
    return WeightEntry(**entry)


@app.delete("/api/weights/{entry_date}")
def delete_weight(entry_date: date, _: Annotated[str, Depends(require_auth)]) -> dict:
    weights = read_weights()
    iso_date = entry_date.isoformat()
    filtered = [entry for entry in weights if entry["date"] != iso_date]
    if len(filtered) == len(weights):
        raise HTTPException(status_code=404, detail="Weight entry not found")
    write_weights(filtered)
    return {"ok": True}


# ── Static / PWA ────────────────────────────────────────────────────────────


MIME_OVERRIDES = {
    ".webmanifest": "application/manifest+json",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{asset_path:path}")
def static_asset(asset_path: str) -> FileResponse:
    if asset_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    file_path = (STATIC_DIR / asset_path).resolve()
    if STATIC_DIR.resolve() not in file_path.parents and file_path != STATIC_DIR.resolve():
        raise HTTPException(status_code=404, detail="Not found")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media_type = MIME_OVERRIDES.get(file_path.suffix)
    headers = {}
    if file_path.name == "sw.js":
        headers["Service-Worker-Allowed"] = "/"
    return FileResponse(file_path, media_type=media_type, headers=headers)
