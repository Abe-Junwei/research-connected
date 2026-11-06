"""Persistent anonymous operation quota for the standalone web product.

Operation counters reset at Beijing 08:00. OpenAlex dollar budget resets on the
UTC calendar day (OpenAlex accounting). Reservations never migrate into a new
operation period. Session nonce + idempotency key bind confirmations.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

BEIJING = timezone(timedelta(hours=8))
UTC = timezone.utc
BROWSER_DAILY = 10
SITE_DAILY = 500
RESERVE_TTL_SEC = 5 * 60
IP_STARTS_PER_MINUTE = 10
OPENALEX_DAILY_BUDGET_USD = 1.0
DEFAULT_REQUEST_COST_USD = 0.0001
SESSION_TTL_SEC = 12 * 60 * 60


def operation_period_id(now: float | None = None) -> str:
    """Beijing calendar date for the open operation window (resets 08:00)."""
    instant = datetime.fromtimestamp(now if now is not None else time.time(), tz=BEIJING)
    if instant.hour < 8:
        instant = instant - timedelta(days=1)
    return instant.date().isoformat()


def operation_reset_at(period: str) -> datetime:
    start = datetime.fromisoformat(period).replace(tzinfo=BEIJING, hour=8, minute=0, second=0, microsecond=0)
    return start + timedelta(days=1)


def budget_period_id(now: float | None = None) -> str:
    """UTC calendar date aligned with OpenAlex daily free credit."""
    return datetime.fromtimestamp(now if now is not None else time.time(), tz=UTC).date().isoformat()


# Back-compat aliases used by older tests/imports.
period_id = operation_period_id
period_reset_at = operation_reset_at


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class QuotaDecision:
    ok: bool
    code: str
    message: str
    reservation_id: str | None = None
    expires_at: float | None = None
    browser_remaining: int = 0
    site_remaining: int = 0
    reset_at: str = ""
    reason: str = ""
    idempotency_key: str | None = None


class QuotaStore:
    """File-backed counters shared across process restarts."""

    def __init__(
        self,
        path: str,
        *,
        browser_daily: int = BROWSER_DAILY,
        site_daily: int = SITE_DAILY,
        reserve_ttl: int = RESERVE_TTL_SEC,
        ip_starts_per_minute: int = IP_STARTS_PER_MINUTE,
        openalex_budget_usd: float = OPENALEX_DAILY_BUDGET_USD,
        request_cost_usd: float = DEFAULT_REQUEST_COST_USD,
        clock=None,
    ):
        self.path = path
        self.browser_daily = browser_daily
        self.site_daily = site_daily
        self.reserve_ttl = reserve_ttl
        self.ip_starts_per_minute = ip_starts_per_minute
        self.openalex_budget_usd = openalex_budget_usd
        self.request_cost_usd = request_cost_usd
        self.clock = clock or time.time
        self.lock = threading.RLock()
        self.state = self._empty(operation_period_id(self.clock()))
        self._load()

    def _empty(self, period: str) -> dict[str, Any]:
        now = self.clock()
        return {
            "period": period,
            "browsers": {},
            "site_success": 0,
            "reservations": {},
            "ip_starts": {},
            "active": {},
            "sessions": {},
            "openalex": {
                "period": budget_period_id(now),
                "spent_micros": 0,
                "held_micros": 0,
                "requests": 0,
                "holds": {},
            },
        }

    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if isinstance(raw, dict) and isinstance(raw.get("period"), str):
                self.state = raw
                self.state.setdefault("sessions", {})
                self.state.setdefault("openalex", {})
        except FileNotFoundError:
            pass
        except (OSError, ValueError, json.JSONDecodeError):
            self.state = self._empty(operation_period_id(self.clock()))
        self._roll_periods(self.clock())

    def _save(self) -> None:
        directory = os.path.dirname(self.path) or "."
        os.makedirs(directory, exist_ok=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(self.state, handle, separators=(",", ":"), ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, self.path)

    def _roll_budget(self, now: float) -> None:
        current = budget_period_id(now)
        openalex = self.state.setdefault("openalex", {})
        if openalex.get("period") == current:
            openalex.setdefault("spent_micros", int(round(float(openalex.get("spent_usd") or 0) * 1_000_000)))
            openalex.setdefault("held_micros", 0)
            openalex.setdefault("holds", {})
            openalex.setdefault("requests", 0)
            return
        self.state["openalex"] = {
            "period": current,
            "spent_micros": 0,
            "held_micros": 0,
            "requests": 0,
            "holds": {},
        }

    def _roll_periods(self, now: float) -> None:
        self._roll_budget(now)
        current = operation_period_id(now)
        if self.state.get("period") == current:
            return
        previous = self.state
        fresh = self._empty(current)
        # Keep closed reservation records briefly for idempotent confirm replies,
        # but never migrate an open reservation into the new operation period.
        for reservation_id, reservation in previous.get("reservations", {}).items():
            if reservation.get("status") == "reserved":
                reservation = {**reservation, "status": "expired", "expired_reason": "period_closed"}
            created = float(reservation.get("created_at", 0))
            if now - created <= 2 * 86400:
                fresh["reservations"][reservation_id] = reservation
        # Sessions may continue across operation midnight; keep unexpired ones.
        for token_hash, session in previous.get("sessions", {}).items():
            if float(session.get("expires_at", 0)) > now:
                fresh["sessions"][token_hash] = session
        # Preserve UTC budget state already rolled above into previous["openalex"].
        fresh["openalex"] = previous.get("openalex", fresh["openalex"])
        self.state = fresh

    def _cleanup(self, now: float) -> None:
        self._roll_periods(now)
        reservations = self.state["reservations"]
        active = self.state["active"]
        for reservation_id, reservation in list(reservations.items()):
            if reservation.get("status") != "reserved":
                created = float(reservation.get("created_at", 0))
                if now - created > 2 * 86400:
                    reservations.pop(reservation_id, None)
                continue
            if float(reservation.get("expires_at", 0)) <= now:
                reservation["status"] = "expired"
                reservation["expired_reason"] = "ttl"
                browser = reservation.get("browser_token_hash")
                if browser and active.get(browser) == reservation_id:
                    active.pop(browser, None)
        for token_hash, session in list(self.state.get("sessions", {}).items()):
            if float(session.get("expires_at", 0)) <= now:
                self.state["sessions"].pop(token_hash, None)
        cutoff = now - 60
        for ip, stamps in list(self.state["ip_starts"].items()):
            kept = [stamp for stamp in stamps if stamp > cutoff]
            if kept:
                self.state["ip_starts"][ip] = kept
            else:
                self.state["ip_starts"].pop(ip, None)
        openalex = self.state.setdefault("openalex", {})
        holds = openalex.setdefault("holds", {})
        for hold_id, hold in list(holds.items()):
            if float(hold.get("expires_at", 0)) <= now and hold.get("status") == "held":
                # Auto-refund abandoned holds so pre-charges cannot stick past TTL.
                micros = int(hold.get("micros") or 0)
                openalex["held_micros"] = max(0, int(openalex.get("held_micros") or 0) - micros)
                hold["status"] = "refunded"

    def create_session(self) -> dict[str, Any]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            token = secrets.token_urlsafe(32)
            nonce = secrets.token_urlsafe(32)
            token_hash = _hash(token)
            self.state.setdefault("sessions", {})[token_hash] = {
                "nonce_hash": _hash(nonce),
                "created_at": now,
                "expires_at": now + SESSION_TTL_SEC,
            }
            self._save()
            return {
                "browser_token": token,
                "session_nonce": nonce,
                "expires_at": now + SESSION_TTL_SEC,
            }

    def _session(self, browser_token: str, session_nonce: str) -> dict[str, Any] | None:
        now = self.clock()
        self._cleanup(now)
        if not browser_token or not session_nonce:
            return None
        if len(browser_token) > 256 or len(session_nonce) > 256:
            return None
        row = self.state.get("sessions", {}).get(_hash(browser_token))
        if not row:
            return None
        if float(row.get("expires_at", 0)) <= now:
            return None
        if row.get("nonce_hash") != _hash(session_nonce):
            return None
        return row

    def _browser_key(self, browser_token: str) -> str:
        return _hash(browser_token)

    def _held_slots(self, period: str) -> tuple[dict[str, int], int]:
        browsers: dict[str, int] = {}
        site = int(self.state.get("site_success") or 0) if self.state.get("period") == period else 0
        if self.state.get("period") == period:
            for browser_id, row in self.state.get("browsers", {}).items():
                browsers[browser_id] = int(row.get("success") or 0)
        for reservation in self.state.get("reservations", {}).values():
            if reservation.get("status") != "reserved":
                continue
            if reservation.get("period") != period:
                continue
            browser_id = reservation.get("browser_token_hash")
            if not browser_id:
                continue
            browsers[browser_id] = browsers.get(browser_id, 0) + 1
            site += 1
        return browsers, site

    def _budget_micros(self) -> int:
        return int(round(self.openalex_budget_usd * 1_000_000))

    def _spent_micros(self) -> int:
        openalex = self.state.get("openalex", {})
        return int(openalex.get("spent_micros") or 0) + int(openalex.get("held_micros") or 0)

    def _cost_micros(self, cost_usd: float | None = None) -> int:
        return int(round(float(cost_usd if cost_usd is not None else self.request_cost_usd) * 1_000_000))

    def status(self, browser_token: str, session_nonce: str) -> dict[str, Any]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            if not self._session(browser_token, session_nonce):
                return {
                    "ok": False,
                    "code": "session_invalid",
                    "message": "Session nonce is missing or invalid.",
                    "browser_remaining": 0,
                    "site_remaining": 0,
                    "reset_at": operation_reset_at(operation_period_id(now)).isoformat(),
                    "reason": "session_invalid",
                }
            period = operation_period_id(now)
            key = self._browser_key(browser_token)
            held, site = self._held_slots(period)
            browser_used = held.get(key, 0)
            spent_usd = self._spent_micros() / 1_000_000
            return {
                "ok": True,
                "period": period,
                "budget_period": budget_period_id(now),
                "reset_at": operation_reset_at(period).isoformat(),
                "browser_remaining": max(0, self.browser_daily - browser_used),
                "site_remaining": max(0, self.site_daily - site),
                "browser_limit": self.browser_daily,
                "site_limit": self.site_daily,
                "openalex_budget_remaining_usd": max(0.0, self.openalex_budget_usd - spent_usd),
                "openalex_budget_usd": self.openalex_budget_usd,
                "active_reservation": self.state.get("active", {}).get(key),
                "reason": self._reason(key, held, site),
            }

    def _reason(self, browser_key: str, held: dict[str, int], site: int) -> str:
        if self._spent_micros() >= self._budget_micros():
            return "openalex_budget"
        if held.get(browser_key, 0) >= self.browser_daily:
            return "browser_quota"
        if site >= self.site_daily:
            return "site_quota"
        if browser_key in self.state.get("active", {}):
            return "browser_busy"
        return ""

    def reserve(self, browser_token: str, session_nonce: str, action: str, ip: str, idempotency_key: str) -> QuotaDecision:
        if action not in {"build", "rebuild", "expand"}:
            return QuotaDecision(False, "invalid_action", "Unsupported action.", reason="invalid_action")
        if not idempotency_key or len(idempotency_key) > 128:
            return QuotaDecision(False, "invalid_idempotency", "Missing idempotency key.", reason="invalid_idempotency")
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            if not self._session(browser_token, session_nonce):
                return QuotaDecision(False, "session_invalid", "Session nonce is missing or invalid.", reason="session_invalid")
            period = operation_period_id(now)
            key = self._browser_key(browser_token)
            status = self.status(browser_token, session_nonce)
            held, site = self._held_slots(period)
            if self._spent_micros() >= self._budget_micros():
                return self._deny("openalex_budget", "OpenAlex daily free budget is exhausted.", status)
            if key in self.state.get("active", {}):
                return self._deny("browser_busy", "This browser already has an active graph task.", status)
            if held.get(key, 0) >= self.browser_daily:
                return self._deny("browser_quota", "Browser daily operation quota reached.", status)
            if site >= self.site_daily:
                return self._deny("site_quota", "Site-wide daily operation quota reached.", status)
            stamps = self.state.setdefault("ip_starts", {}).setdefault(ip or "unknown", [])
            recent = [stamp for stamp in stamps if stamp > now - 60]
            if len(recent) >= self.ip_starts_per_minute:
                return self._deny("ip_rate", "Too many task starts from this network. Try again later.", status)
            reservation_id = uuid.uuid4().hex
            expires = now + self.reserve_ttl
            self.state["reservations"][reservation_id] = {
                "browser_token_hash": key,
                "nonce_hash": _hash(session_nonce),
                "idempotency_key": idempotency_key,
                "period": period,
                "action": action,
                "created_at": now,
                "expires_at": expires,
                "status": "reserved",
                "ip": ip or "unknown",
            }
            self.state["active"][key] = reservation_id
            self.state["ip_starts"][ip or "unknown"] = recent + [now]
            self._save()
            return QuotaDecision(
                True,
                "reserved",
                "Reservation held for five minutes.",
                reservation_id=reservation_id,
                expires_at=expires,
                browser_remaining=max(0, self.browser_daily - held.get(key, 0) - 1),
                site_remaining=max(0, self.site_daily - site - 1),
                reset_at=operation_reset_at(period).isoformat(),
                idempotency_key=idempotency_key,
            )

    def _deny(self, code: str, message: str, status: dict[str, Any]) -> QuotaDecision:
        return QuotaDecision(
            False,
            code,
            message,
            browser_remaining=int(status.get("browser_remaining") or 0),
            site_remaining=int(status.get("site_remaining") or 0),
            reset_at=str(status.get("reset_at") or ""),
            reason=code,
        )

    def confirm(self, browser_token: str, session_nonce: str, reservation_id: str, idempotency_key: str) -> QuotaDecision:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            if not self._session(browser_token, session_nonce):
                return QuotaDecision(False, "session_invalid", "Session nonce is missing or invalid.", reason="session_invalid")
            key = self._browser_key(browser_token)
            status = self.status(browser_token, session_nonce)
            reservation = self.state.get("reservations", {}).get(reservation_id)
            if not reservation:
                return self._deny("unknown_reservation", "Unknown reservation.", status)
            if reservation.get("browser_token_hash") != key:
                return self._deny("browser_mismatch", "Reservation belongs to another browser.", status)
            if reservation.get("nonce_hash") != _hash(session_nonce):
                return self._deny("nonce_mismatch", "Session nonce does not match the reservation.", status)
            if reservation.get("idempotency_key") != idempotency_key:
                return self._deny("idempotency_mismatch", "Idempotency key does not match the reservation.", status)
            if reservation.get("status") == "confirmed":
                return QuotaDecision(
                    True,
                    "confirmed",
                    "Already confirmed.",
                    reservation_id=reservation_id,
                    browser_remaining=status["browser_remaining"],
                    site_remaining=status["site_remaining"],
                    reset_at=status["reset_at"],
                    idempotency_key=idempotency_key,
                )
            if reservation.get("status") in {"released", "expired"}:
                return self._deny(reservation["status"], "Reservation is no longer active.", status)
            if float(reservation.get("expires_at", 0)) <= now:
                reservation["status"] = "expired"
                reservation["expired_reason"] = "ttl"
                if self.state.get("active", {}).get(key) == reservation_id:
                    self.state["active"].pop(key, None)
                self._save()
                return self._deny("expired", "Reservation expired before confirmation.", self.status(browser_token, session_nonce))
            current = operation_period_id(now)
            if reservation.get("period") != current:
                reservation["status"] = "expired"
                reservation["expired_reason"] = "period_closed"
                if self.state.get("active", {}).get(key) == reservation_id:
                    self.state["active"].pop(key, None)
                self._save()
                return self._deny("period_closed", "Reservation belonged to a previous quota period.", self.status(browser_token, session_nonce))
            reservation["status"] = "confirmed"
            reservation["confirmed_at"] = now
            browsers = self.state.setdefault("browsers", {})
            row = browsers.setdefault(key, {"success": 0})
            row["success"] = int(row.get("success") or 0) + 1
            self.state["site_success"] = int(self.state.get("site_success") or 0) + 1
            if self.state.get("active", {}).get(key) == reservation_id:
                self.state["active"].pop(key, None)
            self._save()
            status = self.status(browser_token, session_nonce)
            return QuotaDecision(
                True,
                "confirmed",
                "Operation counted.",
                reservation_id=reservation_id,
                browser_remaining=status["browser_remaining"],
                site_remaining=status["site_remaining"],
                reset_at=status["reset_at"],
                idempotency_key=idempotency_key,
            )

    def release(self, browser_token: str, session_nonce: str, reservation_id: str, idempotency_key: str | None = None) -> QuotaDecision:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            if not self._session(browser_token, session_nonce):
                return QuotaDecision(False, "session_invalid", "Session nonce is missing or invalid.", reason="session_invalid")
            key = self._browser_key(browser_token)
            status = self.status(browser_token, session_nonce)
            reservation = self.state.get("reservations", {}).get(reservation_id)
            if not reservation:
                return self._deny("unknown_reservation", "Unknown reservation.", status)
            if reservation.get("browser_token_hash") != key:
                return self._deny("browser_mismatch", "Reservation belongs to another browser.", status)
            if reservation.get("nonce_hash") != _hash(session_nonce):
                return self._deny("nonce_mismatch", "Session nonce does not match the reservation.", status)
            if idempotency_key is not None and reservation.get("idempotency_key") != idempotency_key:
                return self._deny("idempotency_mismatch", "Idempotency key does not match the reservation.", status)
            if reservation.get("status") == "confirmed":
                return self._deny("already_confirmed", "Confirmed reservations cannot be released.", status)
            if reservation.get("status") in {"released", "expired"}:
                return QuotaDecision(
                    True,
                    reservation["status"],
                    "Already inactive.",
                    reservation_id=reservation_id,
                    browser_remaining=status["browser_remaining"],
                    site_remaining=status["site_remaining"],
                    reset_at=status["reset_at"],
                )
            reservation["status"] = "released"
            reservation["released_at"] = now
            if self.state.get("active", {}).get(key) == reservation_id:
                self.state["active"].pop(key, None)
            self._save()
            status = self.status(browser_token, session_nonce)
            return QuotaDecision(
                True,
                "released",
                "Reservation released without charging.",
                reservation_id=reservation_id,
                browser_remaining=status["browser_remaining"],
                site_remaining=status["site_remaining"],
                reset_at=status["reset_at"],
            )

    def hold_openalex(self, cost_usd: float | None = None, ttl_sec: float = 60.0) -> tuple[bool, str, str | None]:
        """Pre-charge estimated cost without exceeding the UTC daily budget."""
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            cost = self._cost_micros(cost_usd)
            if self._spent_micros() + cost > self._budget_micros():
                return False, "openalex_budget", None
            hold_id = uuid.uuid4().hex
            openalex = self.state.setdefault("openalex", {})
            holds = openalex.setdefault("holds", {})
            holds[hold_id] = {"micros": cost, "status": "held", "created_at": now, "expires_at": now + ttl_sec}
            openalex["held_micros"] = int(openalex.get("held_micros") or 0) + cost
            self._save()
            return True, "", hold_id

    def settle_openalex(self, hold_id: str, actual_cost_usd: float | None = None) -> tuple[bool, str]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            openalex = self.state.setdefault("openalex", {})
            hold = openalex.setdefault("holds", {}).get(hold_id)
            if not hold or hold.get("status") != "held":
                return False, "unknown_hold"
            reserved = int(hold.get("micros") or 0)
            actual = self._cost_micros(actual_cost_usd) if actual_cost_usd is not None else reserved
            # Never let settlement push committed spend over the budget; clamp and keep the hold refund for the rest.
            committed = int(openalex.get("spent_micros") or 0)
            room = max(0, self._budget_micros() - committed)
            actual = min(actual, room, reserved)
            openalex["held_micros"] = max(0, int(openalex.get("held_micros") or 0) - reserved)
            openalex["spent_micros"] = committed + actual
            openalex["requests"] = int(openalex.get("requests") or 0) + 1
            hold["status"] = "settled"
            hold["settled_micros"] = actual
            hold["settled_at"] = now
            self._save()
            return True, ""

    def refund_openalex(self, hold_id: str) -> tuple[bool, str]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            openalex = self.state.setdefault("openalex", {})
            hold = openalex.setdefault("holds", {}).get(hold_id)
            if not hold:
                return False, "unknown_hold"
            if hold.get("status") == "refunded":
                return True, ""
            if hold.get("status") != "held":
                return False, "not_held"
            reserved = int(hold.get("micros") or 0)
            openalex["held_micros"] = max(0, int(openalex.get("held_micros") or 0) - reserved)
            hold["status"] = "refunded"
            hold["refunded_at"] = now
            self._save()
            return True, ""

    def openalex_allowed(self) -> bool:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            return self._spent_micros() < self._budget_micros()
