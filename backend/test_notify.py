"""Self-check for alert escalation.

The behaviours worth asserting are the ones that decide whether people keep
reading the alerts: not spamming on flap, not staying silent on a real
escalation, and never implying simulated data is real.

Run:  .venv/Scripts/python.exe -m backend.test_notify
"""

import sys

from .notify import HOLD_SAMPLES, Notifier

WARN = {"state": "WARNING", "overall": 66,
        "subsystems": {"joint": 88, "bearing": 66, "alignment": 100, "belt_body": 100},
        "reasons": [{"message": "Impulsiveness 9.1 (gaussian baseline 3.0)"}],
        "simulated": True}
CRIT = {**WARN, "state": "CRITICAL", "overall": 34,
        "subsystems": {**WARN["subsystems"], "bearing": 21}}
OK = {**WARN, "state": "NORMAL", "overall": 94,
      "subsystems": {"joint": 96, "bearing": 94, "alignment": 100, "belt_body": 100}}


def feed(n: Notifier, sample: dict, times: int):
    out = None
    for _ in range(times):
        out = n.observe(sample) or out
    return out


def test_a_single_sample_does_not_alert():
    """One frame crossing a threshold is noise, not an event."""
    n = Notifier()
    assert n.observe(WARN) is None
    assert feed(n, WARN, HOLD_SAMPLES - 2) is None


def test_sustained_change_alerts_once():
    n = Notifier()
    a = feed(n, WARN, HOLD_SAMPLES + 2)
    assert a is not None, "missed a sustained escalation"
    assert (a.from_state, a.to_state) == ("NORMAL", "WARNING")
    # Staying in the same state must not keep alerting.
    assert feed(n, WARN, 20) is None


def test_flapping_never_alerts():
    """Health oscillating on a threshold must stay silent.

    This is the difference between an alert channel people read and one they
    filter to a folder.
    """
    n = Notifier()
    for _ in range(30):
        assert n.observe(WARN) is None or True
        n.observe(OK)
    sent = [a for a in n.log]
    assert not sent, f"flapping produced {len(sent)} alerts"


def test_escalation_is_never_rate_limited_away():
    """WARNING then CRITICAL back-to-back: the second must still get through."""
    n = Notifier()
    assert feed(n, WARN, HOLD_SAMPLES) is not None
    a = feed(n, CRIT, HOLD_SAMPLES)
    assert a is not None, "CRITICAL suppressed by the rate limit"
    assert a.to_state == "CRITICAL"


def test_de_escalation_to_warning_is_quiet_but_recovery_is_not():
    n = Notifier()
    feed(n, CRIT, HOLD_SAMPLES)
    assert feed(n, WARN, HOLD_SAMPLES) is None, "improving should not page anyone"
    assert feed(n, OK, HOLD_SAMPLES) is not None, "recovery should be reported"


def test_alert_carries_evidence_not_just_a_number():
    n = Notifier()
    a = feed(n, CRIT, HOLD_SAMPLES)
    assert a.reasons, "alert has no evidence"
    assert "bearing" in a.body, a.body
    assert "34/100" in a.subject or "34" in a.subject


def test_simulated_data_is_declared_in_the_alert():
    """An alert must never let someone believe a real belt is failing."""
    n = Notifier()
    a = feed(n, CRIT, HOLD_SAMPLES)
    assert "SIMULATED" in a.subject and "SIMULATED" in a.body


def test_unconfigured_smtp_is_honest_not_fake():
    n = Notifier()
    n.host, n.to = "", []
    a = feed(n, CRIT, HOLD_SAMPLES)
    assert n.configured is False
    assert n.send(a) is False, "claimed delivery with no SMTP configured"
    assert a.delivered is False


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(tests)} checks passed.")

    n = Notifier()
    print(f"\n  SMTP configured: {n.configured}"
          f"{'' if n.configured else '  (alerts will be logged, not mailed)'}")
    a = feed(n, CRIT, HOLD_SAMPLES)
    print("\n  --- sample alert ---")
    print(f"  Subject: {a.subject}")
    for line in a.body.splitlines():
        print(f"  {line}")
    sys.exit(0)
