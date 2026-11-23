"""Order history: only the user's own purchases, newest first, and they outlive the stub."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.models import Order, User

from .test_records import seed


def _add_order(client: TestClient, email_or_id: str, **fields: object) -> None:
    with client.app.state.sessions() as db:  # type: ignore[attr-defined]
        user = db.query(User).filter(User.id == email_or_id).one()
        db.add(
            Order(
                user_id=user.id,
                worker_name="Maria Lopez",
                pay_date="2026-11-27",
                amount_cents=299,
                provider="apple",
                **fields,
            )
        )
        db.commit()


def _me(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/v1/me", headers=headers).json()["id"]


def test_orders_list_newest_first_and_only_your_own(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    assert client.get("/v1/orders", headers=auth).json() == {"items": [], "nextCursor": None}

    made = seed(client, auth)
    me = _me(client, auth)
    _add_order(client, me, provider_ref="t-1", stub_id=made["stub"]["id"], created_at=datetime(2026, 11, 1, tzinfo=UTC))
    _add_order(client, me, provider_ref="t-2", created_at=datetime(2026, 11, 20, tzinfo=UTC), status="refunded")
    _add_order(client, _me(client, other), provider_ref="t-3")

    items = client.get("/v1/orders", headers=auth).json()["items"]
    assert [item["status"] for item in items] == ["refunded", "paid"]
    assert items[1] == {
        "id": items[1]["id"],
        "stubId": made["stub"]["id"],
        "workerName": "Maria Lopez",
        "payDate": "2026-11-27",
        "amountCents": 299,
        "currency": "usd",
        "status": "paid",
        "provider": "apple",
        "createdAt": "2026-11-01T00:00:00.000Z",
    }
    assert len(client.get("/v1/orders", headers=other).json()["items"]) == 1
    assert client.get("/v1/orders").status_code == 401

    # Deleting the stub keeps the receipt; it just no longer links to the stub.
    assert client.delete(f"/v1/stubs/{made['stub']['id']}", headers=auth).status_code == 204
    assert client.get("/v1/orders", headers=auth).json()["items"][1]["stubId"] is None


def test_orders_page(client: TestClient, auth: dict[str, str]) -> None:
    me = _me(client, auth)
    for n in range(3):
        _add_order(client, me, provider_ref=f"p-{n}")
    first = client.get("/v1/orders", headers=auth, params={"limit": 2}).json()
    assert len(first["items"]) == 2 and first["nextCursor"]
    second = client.get("/v1/orders", headers=auth, params={"limit": 2, "cursor": first["nextCursor"]}).json()
    assert len(second["items"]) == 1 and second["nextCursor"] is None
