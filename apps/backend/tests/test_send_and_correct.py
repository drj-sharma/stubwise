"""Worker email, Form W-4 from 2019 or earlier, and free corrections to a paid stub."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.models import Order, Stub, User

from .test_records import WORKER, flat, hourly, seed


def _orders(client: TestClient) -> list[Order]:
    with client.app.state.sessions() as db:  # type: ignore[attr-defined]
        return list(db.query(Order).all())


def _pay(client: TestClient, headers: dict[str, str], stub_id: str) -> None:
    """What the (future) payment confirmation writes: one order for the stub."""
    me = client.get("/v1/me", headers=headers).json()["id"]
    with client.app.state.sessions() as db:  # type: ignore[attr-defined]
        user = db.query(User).filter(User.id == me).one()
        db.add(
            Order(
                user_id=user.id,
                stub_id=stub_id,
                worker_name="Marcus Bell",
                pay_date="2026-11-27",
                amount_cents=299,
                provider="apple",
                provider_ref="pay-1",
            )
        )
        db.commit()


def test_a_worker_has_an_optional_email(client: TestClient, auth: dict[str, str]) -> None:
    client.post("/v1/business", headers=auth, json={"name": "Ridgeline", "paySchedule": "biweekly"})
    created = client.post("/v1/workers", headers=auth, json=WORKER)
    assert created.json()["email"] == ""

    patched = client.patch(f"/v1/workers/{created.json()['id']}", headers=auth, json={"email": "  Marcus@Example.com "})
    assert patched.status_code == 200, patched.text
    assert patched.json()["email"] == "marcus@example.com"

    cleared = client.patch(f"/v1/workers/{created.json()['id']}", headers=auth, json={"email": ""})
    assert cleared.json()["email"] == ""


@pytest.mark.parametrize(
    "email", ["marcus", "marcus@", "@example.com", "a b@example.com", "marcus@example", "x" * 250 + "@a.co"]
)
def test_a_bad_worker_email_is_refused(client: TestClient, auth: dict[str, str], email: str) -> None:
    client.post("/v1/business", headers=auth, json={"name": "Ridgeline", "paySchedule": "biweekly"})
    response = client.post("/v1/workers", headers=auth, json={**WORKER, "email": email})
    assert response.status_code == 400
    assert response.json()["error"]["details"][0]["path"] == "email"


def test_the_worker_email_survives_a_backup_restore(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    client.patch(f"/v1/workers/{made['worker']['id']}", headers=auth, json={"email": "marcus@example.com"})
    snapshot = client.get("/v1/backup", headers=auth)
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["workers"][0]["email"] == "marcus@example.com"


def test_a_pre_2020_w4_changes_federal_tax_and_is_stored(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    stub_id = made["stub"]["id"]
    lines = {"lines": [hourly("Regular", 80 * 60, 2500)]}  # $2,000 biweekly

    def federal() -> int:
        stub = client.put(f"/v1/stubs/{stub_id}/lines", headers=auth, json=lines).json()
        return next(line["amountCents"] for line in stub["lines"] if line["taxCode"] == "fit")

    new_form = federal()
    profile = {
        **made["worker"]["taxProfile"],
        "w4": {**made["worker"]["taxProfile"]["w4"], "legacy": True, "allowances": 3},
    }
    patched = client.patch(f"/v1/workers/{made['worker']['id']}", headers=auth, json={"taxProfile": profile})
    assert patched.json()["taxProfile"]["w4"]["legacy"] is True
    assert patched.json()["taxProfile"]["w4"]["allowances"] == 3
    # Single, 3 allowances: 52,000 - 12,900 = 39,100 -> 1,240 + 12% x 19,200 = 3,544; / 26 = 136.31.
    assert federal() == 136_31 != new_form


def test_correcting_a_paid_stub_is_free_and_never_makes_a_second_order(
    client: TestClient, auth: dict[str, str]
) -> None:
    made = seed(client, auth)
    stub_id = made["stub"]["id"]
    _pay(client, auth, stub_id)
    assert len(_orders(client)) == 1

    # Edit the lines, move the pay date, change the worker: every kind of correction.
    assert (
        client.put(
            f"/v1/stubs/{stub_id}/lines", headers=auth, json={"lines": [flat("earning", "Bonus", 5000)]}
        ).status_code
        == 200
    )
    moved = client.patch(f"/v1/stubs/{stub_id}", headers=auth, json={"payDate": "2026-11-30"})
    assert moved.status_code == 200, moved.text
    client.patch(f"/v1/workers/{made['worker']['id']}", headers=auth, json={"rateCents": 3000})

    orders = _orders(client)
    assert len(orders) == 1 and orders[0].stub_id == stub_id and orders[0].status == "paid"
    with client.app.state.sessions() as db:  # type: ignore[attr-defined]
        assert db.query(Stub).filter(Stub.id == stub_id).one().pay_date == "2026-11-30"

    # The app asks "was this stub paid for?" with the stub filter.
    paid = client.get("/v1/orders", headers=auth, params={"stubId": stub_id}).json()["items"]
    assert [item["stubId"] for item in paid] == [stub_id]
    assert client.get("/v1/orders", headers=auth, params={"stubId": "someone-elses"}).json()["items"] == []
