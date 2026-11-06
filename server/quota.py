"""Persistent anonymous operation quota for the standalone web product.

Beijing-time 08:00 periods; reserve → browser save → confirm.
Does not store DOI query history.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

BEIJING = timezone(timedelta(hours=8))
BROWSER_DAILY = 10
SITE_DAILY = 500
RESERVE_TTL_SEC = 5 * 60
IP_STARTS_PER_MINUTE = 10
OPENALEX_DAILY_BUDGET_USD = 1.0
DEFAULT_REQUEST_COST_USD = 0.0001


def period_id(now: float | None = None) -> str:
    """Return the Beijing calendar date for the open quota window (resets 08:00)."""
    instant = datetime.fromtimestamp(now if now is not None else time.time(), tz=BEIJING)
    if instant.hour < 8:
        instant = instant - timedelta(days=1)
    return instant.date().isoformat()


def period_reset_at(period: str) -> datetime:
    start = datetime.fromisoformat(period).replace(tzinfo=BEIJING, hour=8, minute=0, second=0, microsecond=0)
    return start + timedelta(days=1)


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
        self.state = self._empty(period_id(self.clock()))
        self._load()

    def _empty(self, period: str) -> dict[str, Any]:
        return {
            "period": period,
            "browsers": {},
            "site_success": 0,
            "reservations": {},
            "ip_starts": {},
            "active": {},
            "openalex": {"period": period, "spent_usd": 0.0, "requests": 0},
        }

    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
            if isinstance(raw, dict) and isinstance(raw.get("period"), str):
                self.state = raw
        except FileNotFoundError:
            pass
        except (OSError, ValueError, json.JSONDecodeError):
            self.state = self._empty(period_id(self.clock()))
        self._roll_period(self.clock())

    def _save(self) -> None:
        directory = os.path.dirname(self.path) or "."
        os.makedirs(directory, exist_ok=True)
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(self.state, handle, separators=(",", ":"), ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, self.path)

    def _roll_period(self, now: float) -> None:
        current = period_id(now)
        if self.state.get("period") == current:
            openalex = self.state.setdefault("openalex", {"period": current, "spent_usd": 0.0, "requests": 0})
            if openalex.get("period") != current:
                self.state["openalex"] = {"period": current, "spent_usd": 0.0, "requests": 0}
            return
        previous = self.state
        fresh = self._empty(current)
        for reservation_id, reservation in previous.get("reservations", {}).items():
            if reservation.get("status") != "reserved":
                continue
            if float(reservation.get("expires_at", 0)) <= now:
                reservation["status"] = "expired"
                continue
            fresh["reservations"][reservation_id] = reservation
            browser = reservation.get("browser_id")
            if browser:
                fresh["active"][browser] = reservation_id
        self.state = fresh

    def _cleanup(self, now: float) -> None:
        self._roll_period(now)
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
                browser = reservation.get("browser_id")
                if browser and active.get(browser) == reservation_id:
                    active.pop(browser, None)
        cutoff = now - 60
        for ip, stamps in list(self.state["ip_starts"].items()):
            kept = [stamp for stamp in stamps if stamp > cutoff]
            if kept:
                self.state["ip_starts"][ip] = kept
            else:
                self.state["ip_starts"].pop(ip, None)

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
            browser_id = reservation.get("browser_id")
            if not browser_id:
                continue
            browsers[browser_id] = browsers.get(browser_id, 0) + 1
            site += 1
        return browsers, site

    def status(self, browser_id: str) -> dict[str, Any]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            period = period_id(now)
            held, site = self._held_slots(period)
            browser_used = held.get(browser_id, 0)
            spent_usd = self._spent_micros() / 1_000_000
            return {
                "period": period,
                "reset_at": period_reset_at(period).isoformat(),
                "browser_remaining": max(0, self.browser_daily - browser_used),
                "site_remaining": max(0, self.site_daily - site),
                "browser_limit": self.browser_daily,
                "site_limit": self.site_daily,
                "openalex_budget_remaining_usd": max(0.0, self.openalex_budget_usd - spent_usd),
                "openalex_budget_usd": self.openalex_budget_usd,
                "active_reservation": self.state.get("active", {}).get(browser_id),
                "reason": self._reason(browser_id, held, site, spent_usd),
            }

    def _reason(self, browser_id: str, held: dict[str, int], site: int, spent: float) -> str:
        if self._spent_micros() >= self._budget_micros():
            return "openalex_budget"
        if held.get(browser_id, 0) >= self.browser_daily:
            return "browser_quota"
        if site >= self.site_daily:
            return "site_quota"
        if browser_id in self.state.get("active", {}):
            return "browser_busy"
        return ""

    def reserve(self, browser_id: str, action: str, ip: str) -> QuotaDecision:
        if action not in {"build", "rebuild", "expand"}:
            return QuotaDecision(False, "invalid_action", "Unsupported action.", reason="invalid_action")
        if not browser_id or len(browser_id) > 128:
            return QuotaDecision(False, "invalid_browser", "Missing browser id.", reason="invalid_browser")
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            period = period_id(now)
            status = self.status(browser_id)
            held, site = self._held_slots(period)
            if self._spent_micros() >= self._budget_micros():
                return self._deny("openalex_budget", "OpenAlex daily free budget is exhausted.", status)
            if browser_id in self.state.get("active", {}):
                return self._deny("browser_busy", "This browser already has an active graph task.", status)
            if held.get(browser_id, 0) >= self.browser_daily:
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
                "browser_id": browser_id,
                "period": period,
                "action": action,
                "created_at": now,
                "expires_at": expires,
                "status": "reserved",
                "ip": ip or "unknown",
            }
            self.state["active"][browser_id] = reservation_id
            self.state["ip_starts"][ip or "unknown"] = recent + [now]
            self._save()
            return QuotaDecision(
                True,
                "reserved",
                "Reservation held for five minutes.",
                reservation_id=reservation_id,
                expires_at=expires,
                browser_remaining=max(0, self.browser_daily - held.get(browser_id, 0) - 1),
                site_remaining=max(0, self.site_daily - site - 1),
                reset_at=period_reset_at(period).isoformat(),
            )

    def _deny(self, code: str, message: str, status: dict[str, Any]) -> QuotaDecision:
        return QuotaDecision(
            False,
            code,
            message,
            browser_remaining=status["browser_remaining"],
            site_remaining=status["site_remaining"],
            reset_at=status["reset_at"],
            reason=code,
        )

    def confirm(self, browser_id: str, reservation_id: str) -> QuotaDecision:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            reservation = self.state.get("reservations", {}).get(reservation_id)
            status = self.status(browser_id)
            if not reservation:
                return self._deny("unknown_reservation", "Unknown reservation.", status)
            if reservation.get("browser_id") != browser_id:
                return self._deny("browser_mismatch", "Reservation belongs to another browser.", status)
            if reservation.get("status") == "confirmed":
                return QuotaDecision(
                    True,
                    "confirmed",
                    "Already confirmed.",
                    reservation_id=reservation_id,
                    browser_remaining=status["browser_remaining"],
                    site_remaining=status["site_remaining"],
                    reset_at=status["reset_at"],
                )
            if reservation.get("status") in {"released", "expired"}:
                return self._deny(reservation["status"], "Reservation is no longer active.", status)
            if float(reservation.get("expires_at", 0)) <= now:
                reservation["status"] = "expired"
                if self.state.get("active", {}).get(browser_id) == reservation_id:
                    self.state["active"].pop(browser_id, None)
                self._save()
                return self._deny("expired", "Reservation expired before confirmation.", self.status(browser_id))
            current = period_id(now)
            if reservation.get("period") != current:
                reservation["status"] = "expired"
                if self.state.get("active", {}).get(browser_id) == reservation_id:
                    self.state["active"].pop(browser_id, None)
                self._save()
                return self._deny("period_closed", "Reservation belonged to a previous quota period.", self.status(browser_id))
            reservation["status"] = "confirmed"
            reservation["confirmed_at"] = now
            browsers = self.state.setdefault("browsers", {})
            row = browsers.setdefault(browser_id, {"success": 0})
            row["success"] = int(row.get("success") or 0) + 1
            self.state["site_success"] = int(self.state.get("site_success") or 0) + 1
            if self.state.get("active", {}).get(browser_id) == reservation_id:
                self.state["active"].pop(browser_id, None)
            self._save()
            status = self.status(browser_id)
            return QuotaDecision(
                True,
                "confirmed",
                "Operation counted.",
                reservation_id=reservation_id,
                browser_remaining=status["browser_remaining"],
                site_remaining=status["site_remaining"],
                reset_at=status["reset_at"],
            )

    def release(self, browser_id: str, reservation_id: str) -> QuotaDecision:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            reservation = self.state.get("reservations", {}).get(reservation_id)
            status = self.status(browser_id)
            if not reservation:
                return self._deny("unknown_reservation", "Unknown reservation.", status)
            if reservation.get("browser_id") != browser_id:
                return self._deny("browser_mismatch", "Reservation belongs to another browser.", status)
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
            if self.state.get("active", {}).get(browser_id) == reservation_id:
                self.state["active"].pop(browser_id, None)
            self._save()
            status = self.status(browser_id)
            return QuotaDecision(
                True,
                "released",
                "Reservation released without charging.",
                reservation_id=reservation_id,
                browser_remaining=status["browser_remaining"],
                site_remaining=status["site_remaining"],
                reset_at=status["reset_at"],
            )

    def _spent_micros(self) -> int:
        openalex = self.state.get("openalex", {})
        if "spent_micros" in openalex:
            return int(openalex.get("spent_micros") or 0)
        return int(round(float(openalex.get("spent_usd") or 0) * 1_000_000))

    def _budget_micros(self) -> int:
        return int(round(self.openalex_budget_usd * 1_000_000))

    def _cost_micros(self, cost_usd: float | None = None) -> int:
        return int(round(float(cost_usd if cost_usd is not None else self.request_cost_usd) * 1_000_000))

    def charge_openalex(self, cost_usd: float | None = None) -> tuple[bool, str]:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            openalex = self.state.setdefault("openalex", {"period": period_id(now), "spent_usd": 0.0, "spent_micros": 0, "requests": 0})
            spent = self._spent_micros()
            cost = self._cost_micros(cost_usd)
            if spent >= self._budget_micros():
                return False, "openalex_budget"
            openalex["spent_micros"] = spent + cost
            openalex["spent_usd"] = openalex["spent_micros"] / 1_000_000
            openalex["requests"] = int(openalex.get("requests") or 0) + 1
            openalex["period"] = period_id(now)
            self._save()
            return True, ""

    def openalex_allowed(self) -> bool:
        with self.lock:
            now = self.clock()
            self._cleanup(now)
            return self._spent_micros() < self._budget_micros()
