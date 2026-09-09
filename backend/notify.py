"""Alert escalation: tells a human when the belt changes state.

The dashboard only helps someone already looking at it. A maintenance system
has to reach the person who is not.

DESIGN DECISIONS THAT MATTER:

  * DEADBAND. A state must hold for several consecutive samples before it
    alerts. Health hovering on a threshold would otherwise send a mail every
    half-second, and an alert channel that cries wolf is one people filter to
    a folder. Same reasoning as the dashboard's event log.
  * ESCALATION ONLY, plus one "cleared" note. Getting worse is urgent; getting
    better is informational. Re-alerting for an unchanged state is noise, so
    each state alerts once until the state changes.
  * The mail carries the EVIDENCE, not just a score. "CRITICAL, health 32" is
    not actionable; "bearing housing 84 C, ISO 10816 unsatisfactory vibration"
    tells a fitter what to take to the belt. The fusion layer already produces
    exactly this, so nothing is duplicated here.
  * NO SMTP CONFIGURED IS A SUPPORTED STATE, not an error. The alert is logged
    and recorded so the escalation path is demonstrable without a mail server,
    and `configured` says plainly which mode it is in. A demo that silently
    pretends to send mail would be the dishonest option.

Configure by adding to .env (all optional):
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=you@example.com
    SMTP_PASSWORD=app-password
    ALERT_TO=maintenance@example.com,supervisor@example.com
    ALERT_FROM=beltguard@example.com
"""

from __future__ import annotations

import os
import smtplib
import time
from dataclasses import dataclass, field
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

RANK = {"NORMAL": 0, "WARNING": 1, "CRITICAL": 2}
HOLD_SAMPLES = 4          # consecutive samples before a state is believed

# There is deliberately NO time-based rate limit. The deadband above plus
# "alert once per confirmed transition" already make spam impossible, and a
# timer on top of that only ever suppresses something real -- the first version
# of this file silently swallowed the "recovered" notice, leaving anyone who
# got the CRITICAL mail believing the belt was still down.


@dataclass
class Alert:
    ts: float
    from_state: str
    to_state: str
    health: int
    subject: str
    body: str
    delivered: bool           # False when SMTP is not configured
    notified: bool = False    # False for transitions logged but not worth a mail
    reasons: list[str] = field(default_factory=list)


class Notifier:
    """Watches health states and escalates confirmed transitions."""

    def __init__(self) -> None:
        self.host = os.getenv("SMTP_HOST", "").strip()
        self.port = int(os.getenv("SMTP_PORT", "587"))
        self.user = os.getenv("SMTP_USER", "").strip()
        self.password = os.getenv("SMTP_PASSWORD", "").strip()
        self.sender = os.getenv("ALERT_FROM", self.user).strip()
        self.to = [a.strip() for a in os.getenv("ALERT_TO", "").split(",") if a.strip()]

        self.confirmed = "NORMAL"
        self._candidate: str | None = None
        self._streak = 0
        self.log: list[Alert] = []

    @property
    def configured(self) -> bool:
        return bool(self.host and self.to)

    # -- transition detection ---------------------------------------------

    def observe(self, health: dict) -> Alert | None:
        """Feed one health sample. Returns an Alert if one should be sent.

        Pure with respect to I/O -- sending is a separate step so this can be
        tested without a mail server, and so the caller decides threading.
        """
        state = health.get("state")
        if state not in RANK:
            return None

        if state == self.confirmed:
            self._candidate, self._streak = None, 0
            return None

        if state != self._candidate:
            self._candidate, self._streak = state, 1
            return None

        self._streak += 1
        if self._streak < HOLD_SAMPLES:
            return None

        previous, self.confirmed = self.confirmed, state
        self._candidate, self._streak = None, 0

        # EVERY confirmed transition is logged; only escalations and full
        # recoveries are worth a mail. The dashboard's event log reads this same
        # list, so the deadband rule lives in exactly one place -- it used to be
        # implemented a second time in TypeScript, which was a drift waiting to
        # happen.
        now = time.time()
        alert = self._compose(previous, state, health, now)
        alert.notified = RANK[state] > RANK[previous] or state == "NORMAL"
        self.log.append(alert)
        del self.log[:-50]
        return alert if alert.notified else None

    def _compose(self, previous: str, state: str, health: dict, now: float) -> Alert:
        reasons = [r["message"] for r in health.get("reasons", [])[:4]]
        subs = health.get("subsystems", {})
        worst = min(subs, key=subs.get) if subs else "unknown"
        sim = " [SIMULATED DATA]" if health.get("simulated", True) else ""

        subject = (f"BeltGuard {state}: conveyor CV-204 health "
                   f"{health.get('overall')}/100{sim}")
        lines = [
            f"Conveyor CV-204 (NMDC Line A) changed {previous} -> {state}.",
            "",
            f"  Health index : {health.get('overall')}/100",
            f"  Worst area   : {worst} ({subs.get(worst, '-')}/100)",
            f"  Detected at  : {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now))}",
            "",
            "Contributing indicators:",
            *(f"  - {m}" for m in reasons or ["(none recorded)"]),
        ]
        if health.get("simulated", True):
            # Never let an alert imply a real belt is failing.
            lines += ["", "NOTE: at least one contributing source is SIMULATED.",
                      "This alert was generated from simulated sensor data."]
        return Alert(now, previous, state, health.get("overall", 0),
                     subject, "\n".join(lines), delivered=False, reasons=reasons)

    # -- delivery ----------------------------------------------------------

    def send(self, alert: Alert) -> bool:
        """Blocking. Call from a thread. Returns True if actually delivered."""
        if not self.configured:
            print(f"[alert:not-configured] {alert.subject}")
            return False
        msg = EmailMessage()
        msg["Subject"] = alert.subject
        msg["From"] = self.sender or self.user
        msg["To"] = ", ".join(self.to)
        msg.set_content(alert.body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=15) as s:
                s.starttls()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(msg)
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            # A failed alert must never take the monitoring system down with it.
            print(f"[alert:failed] {type(exc).__name__}: {exc}")
            return False
        alert.delivered = True
        print(f"[alert:sent] {alert.subject} -> {', '.join(self.to)}")
        return True
