"""Self-check for the phone hand-off pairing endpoints.

Round trip, single-use, and expiry are the three behaviours that matter here:
get any of them wrong and either a phone can't pick up the session, or a
token silently outlives its purpose.

Run:  .venv/Scripts/python.exe -m backend.test_pair
"""

import sys

from fastapi.testclient import TestClient

from . import app as app_module

PROFILE = {"name": "Ada Lovelace", "email": "ada@example.com",
           "picture": "https://example.com/p.jpg", "sub": "123"}


def main() -> int:
    with TestClient(app_module.app) as c:
        token = c.post("/api/pair", json=PROFILE).json()["token"]
        assert token and token not in PROFILE.values(), "token must be opaque, not the profile"

        got = c.get(f"/api/pair/{token}")
        assert got.status_code == 200 and got.json() == PROFILE, "redeemed profile must round-trip exactly"

        again = c.get(f"/api/pair/{token}")
        assert again.status_code == 404, "a token must not survive a second redeem"

        assert c.get("/api/pair/not-a-real-token").status_code == 404

        # Expiry: backdate the entry past its TTL without waiting 2 minutes.
        token2 = c.post("/api/pair", json=PROFILE).json()["token"]
        app_module._pairs[token2] = (PROFILE, 0.0)
        assert c.get(f"/api/pair/{token2}").status_code == 404, "an expired token must not redeem"

    print("PASS  pair: round trip, single-use, expiry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
