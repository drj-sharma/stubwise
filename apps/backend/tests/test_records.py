from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.domain.tax.apply_taxes import apply_taxes
from app.domain.tax.types import DEFAULT_TAX_PROFILE

from .conftest import FakeIdentityProviders, Outbound, make_client, new_user

BUSINESS = {
    "name": "Ridgeline Auto Repair",
    "address": "2140 Alder St, Pittsburgh, PA 15201",
    "phone": "(412) 555-0142",
    "state": "PA",
    "employerId": "62-1847305",
    "paySchedule": "biweekly",
}
WORKER = {
    "name": "Marcus Bell",
    "type": "employee",
    "payType": "hourly",
    "rateCents": 2400,
    "defaultDeductions": [{"label": "Health insurance", "amountCents": 8500}],
}
TODAY = {"today": "2026-11-18"}  # a Wednesday; the biweekly period containing it is Nov 9 - Nov 22


def hourly(label: str, minutes: int, rate_cents: int, amount_cents: int = 0) -> dict[str, Any]:
    return {
        "kind": "earning",
        "label": label,
        "minutes": minutes,
        "rateCents": rate_cents,
        "amountCents": amount_cents,
        "source": "manual",
    }


def flat(kind: str, label: str, amount_cents: int, **extra: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": label,
        "minutes": None,
        "rateCents": None,
        "amountCents": amount_cents,
        "source": "manual",
        **extra,
    }


def seed(client: TestClient, headers: dict[str, str], business_name: str = "Ridgeline Auto Repair") -> dict[str, Any]:
    """A business, one worker and that worker's first stub."""
    business = client.post("/v1/business", headers=headers, json={**BUSINESS, "name": business_name})
    assert business.status_code == 201, business.text
    worker = client.post("/v1/workers", headers=headers, json=WORKER)
    assert worker.status_code == 201, worker.text
    stub = client.post(f"/v1/workers/{worker.json()['id']}/stubs/next", headers=headers, json=TODAY)
    assert stub.status_code == 201, stub.text
    return {"business": business.json(), "worker": worker.json(), "stub": stub.json()}


def amounts(stub: dict[str, Any]) -> dict[str, int]:
    return {line["label"]: line["amountCents"] for line in stub["lines"]}


# ---- Business -----------------------------------------------------------------


def test_business_lifecycle(client: TestClient, auth: dict[str, str]) -> None:
    missing = client.get("/v1/business", headers=auth)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "business_not_found"

    created = client.post("/v1/business", headers=auth, json=BUSINESS)
    assert created.status_code == 201
    business = created.json()
    assert {key: business[key] for key in BUSINESS} == BUSINESS
    # Defaults match the app's.
    assert (business["templateId"], business["accent"], business["overtimePct"]) == ("classic", "#3F3D9E", 150)
    assert (business["appearance"], business["showEmployerId"], business["logoDataUri"]) == ("automatic", True, None)
    assert business["version"] == 1

    assert client.post("/v1/business", headers=auth, json=BUSINESS).json()["error"]["code"] == "business_exists"

    patched = client.patch("/v1/business", headers=auth, json={"overtimePct": 200, "state": None, "appearance": "dark"})
    assert patched.status_code == 200
    assert (patched.json()["overtimePct"], patched.json()["state"], patched.json()["appearance"]) == (200, None, "dark")
    assert patched.json()["name"] == BUSINESS["name"]
    assert patched.json()["version"] == 2
    assert client.get("/v1/business", headers=auth).json() == patched.json()

    assert client.delete("/v1/business", headers=auth).status_code == 204
    assert client.get("/v1/business", headers=auth).status_code == 404


@pytest.mark.parametrize(
    ("change", "path"),
    [
        ({"name": "  "}, "name"),
        ({"state": "ZZ"}, "state"),
        ({"state": "pa"}, "state"),
        ({"paySchedule": "daily"}, "paySchedule"),
        ({"templateId": "neon"}, "templateId"),
        ({"accent": "blue"}, "accent"),
        ({"overtimePct": 99}, "overtimePct"),
        ({"overtimePct": 1.5}, "overtimePct"),
        ({"appearance": "sepia"}, "appearance"),
        ({"showEmployerId": "yes"}, "showEmployerId"),
        ({"logoDataUri": "https://example.com/logo.png"}, "logoDataUri"),
        ({"logoDataUri": "data:image/svg+xml;base64,AAAA"}, "logoDataUri"),
        ({"logoDataUri": "data:image/png;base64," + "A" * 400_000}, "logoDataUri"),
    ],
)
def test_business_fields_are_validated(client: TestClient, auth: dict[str, str], change: dict, path: str) -> None:
    response = client.post("/v1/business", headers=auth, json={**BUSINESS, **change})
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "invalid_request"
    assert [detail["path"] for detail in response.json()["error"]["details"]] == [path]
    client.post("/v1/business", headers=auth, json=BUSINESS)
    assert client.patch("/v1/business", headers=auth, json=change).status_code == 400


def test_a_logo_within_the_cap_is_stored(client: TestClient, auth: dict[str, str]) -> None:
    logo = "data:image/png;base64," + "iVBORw0KGgo" * 1000 + "A="
    created = client.post("/v1/business", headers=auth, json={**BUSINESS, "logoDataUri": logo})
    assert created.status_code == 201
    assert client.get("/v1/business", headers=auth).json()["logoDataUri"] == logo
    assert client.patch("/v1/business", headers=auth, json={"name": None}).status_code == 400


# ---- Workers ------------------------------------------------------------------


def test_worker_lifecycle(client: TestClient, auth: dict[str, str]) -> None:
    needs_business = client.post("/v1/workers", headers=auth, json=WORKER)
    assert needs_business.status_code == 404
    assert needs_business.json()["error"]["code"] == "business_not_found"
    client.post("/v1/business", headers=auth, json=BUSINESS)

    created = client.post("/v1/workers", headers=auth, json=WORKER)
    assert created.status_code == 201
    worker = created.json()
    assert {key: worker[key] for key in WORKER} == WORKER
    assert worker["address"] == ""
    assert worker["startingYtd"] is None
    assert worker["taxProfile"] == DEFAULT_TAX_PROFILE

    profile = {
        "calculate": True,
        "state": "IL",
        "w4": {**DEFAULT_TAX_PROFILE["w4"], "filingStatus": "married", "dependentsCents": 200000},
        "stateW4": {"allowances": 2, "additionalAllowances": 1, "extraWithholdingCents": 500, "exempt": False},
    }
    starting = {"year": 2026, "lines": [{"kind": "earning", "label": "Regular", "amountCents": 3571200}]}
    patched = client.patch(
        f"/v1/workers/{worker['id']}",
        headers=auth,
        json={"rateCents": 2550, "taxProfile": profile, "startingYtd": starting},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["rateCents"] == 2550
    assert patched.json()["taxProfile"] == profile
    assert patched.json()["startingYtd"] == starting
    assert patched.json()["name"] == "Marcus Bell"
    assert patched.json()["version"] == 2
    assert client.get(f"/v1/workers/{worker['id']}", headers=auth).json() == patched.json()

    cleared = client.patch(f"/v1/workers/{worker['id']}", headers=auth, json={"startingYtd": None})
    assert cleared.json()["startingYtd"] is None

    assert client.delete(f"/v1/workers/{worker['id']}", headers=auth).status_code == 204
    gone = client.get(f"/v1/workers/{worker['id']}", headers=auth)
    assert gone.status_code == 404
    assert gone.json()["error"]["code"] == "worker_not_found"


def test_a_tax_profile_saved_before_state_certificates_gets_the_default(
    client: TestClient, auth: dict[str, str]
) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    old_shape = {"calculate": True, "w4": DEFAULT_TAX_PROFILE["w4"], "state": None}
    created = client.post("/v1/workers", headers=auth, json={**WORKER, "taxProfile": old_shape})
    assert created.status_code == 201
    assert created.json()["taxProfile"]["stateW4"] == DEFAULT_TAX_PROFILE["stateW4"]

    # A row written by an older server, with no stateW4 at all, reads back complete too.
    with client.app.state.sessions() as db:
        db.execute(text("""UPDATE workers SET tax_profile = '{"calculate": false}'"""))
        db.commit()
    stored = client.get(f"/v1/workers/{created.json()['id']}", headers=auth).json()["taxProfile"]
    assert stored == {**DEFAULT_TAX_PROFILE, "calculate": False}


@pytest.mark.parametrize(
    "change",
    [
        {"name": ""},
        {"type": "intern"},
        {"payType": "daily"},
        {"rateCents": -1},
        {"rateCents": 24.5},
        {"rateCents": "2400"},
        {"defaultDeductions": [{"label": "", "amountCents": 1}]},
        {"defaultDeductions": [{"label": "x", "amountCents": 1}] * 21},
        {"startingYtd": {"year": 1999, "lines": []}},
        {"taxProfile": {"calculate": True, "state": "XX"}},
        {"taxProfile": {"w4": {"filingStatus": "widowed"}}},
        {"taxProfile": {"stateW4": {"allowances": 100}}},
        {"taxProfile": {"stateW4": {"allowances": 1.5}}},
    ],
)
def test_worker_fields_are_validated(client: TestClient, auth: dict[str, str], change: dict) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    response = client.post("/v1/workers", headers=auth, json={**WORKER, **change})
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "invalid_request"


def test_lists_are_paginated(client: TestClient, auth: dict[str, str]) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    ids = [
        client.post("/v1/workers", headers=auth, json={**WORKER, "name": f"Worker {n}"}).json()["id"] for n in range(5)
    ]
    for worker_id in ids[:3]:
        client.post(f"/v1/workers/{worker_id}/stubs/next", headers=auth, json=TODAY)

    seen, cursor, pages = [], None, 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        body = client.get("/v1/workers", headers=auth, params=params).json()
        seen += [worker["id"] for worker in body["items"]]
        pages += 1
        cursor = body["nextCursor"]
        if cursor is None:
            break
    assert (seen, pages) == (ids, 3)

    first = client.get("/v1/stubs", headers=auth, params={"limit": 2}).json()
    rest = client.get("/v1/stubs", headers=auth, params={"limit": 2, "cursor": first["nextCursor"]}).json()
    assert (len(first["items"]), len(rest["items"]), rest["nextCursor"]) == (2, 1, None)
    only = client.get("/v1/stubs", headers=auth, params={"workerId": ids[0]}).json()
    assert [stub["workerId"] for stub in only["items"]] == [ids[0]]

    assert client.get("/v1/workers", headers=auth, params={"limit": 0}).status_code == 400
    assert client.get("/v1/workers", headers=auth, params={"limit": 201}).status_code == 400
    bad = client.get("/v1/workers", headers=auth, params={"cursor": "garbage"})
    assert bad.json()["error"]["code"] == "invalid_cursor"


def test_the_plan_limits_how_many_workers_an_account_has(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import plans

    monkeypatch.setitem(plans.PLANS, "free", plans.Entitlements(max_businesses=1, max_workers=2))
    client.post("/v1/business", headers=auth, json=BUSINESS)
    codes = [client.post("/v1/workers", headers=auth, json=WORKER).status_code for _ in range(3)]
    assert codes == [201, 201, 409]
    assert client.get("/v1/me", headers=auth).json()["entitlements"]["maxWorkers"] == 2


# ---- Lost updates and retries ---------------------------------------------------


def test_if_match_prevents_lost_updates(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    worker_url = f"/v1/workers/{made['worker']['id']}"
    stub_url = f"/v1/stubs/{made['stub']['id']}"

    assert client.patch(worker_url, headers={**auth, "if-match": "1"}, json={"rateCents": 2500}).status_code == 200
    stale = client.patch(worker_url, headers={**auth, "if-match": "1"}, json={"rateCents": 9999})
    assert stale.status_code == 412
    assert stale.json()["error"] == {
        "code": "version_conflict",
        "message": "This record was changed elsewhere since you loaded it. Reload it and try again.",
        "details": {"currentVersion": 2},
    }
    assert client.get(worker_url, headers=auth).json()["rateCents"] == 2500
    # Quoted, as an ETag would be, and with no header at all, both work.
    assert client.patch(worker_url, headers={**auth, "if-match": '"2"'}, json={"rateCents": 2600}).status_code == 200
    assert client.patch(worker_url, headers=auth, json={"rateCents": 2700}).status_code == 200

    lines = {"lines": [hourly("Regular", 60, 2400)]}
    assert client.put(f"{stub_url}/lines", headers={**auth, "if-match": "7"}, json=lines).status_code == 412
    assert client.patch(stub_url, headers={**auth, "if-match": "7"}, json={"payDate": "2026-12-01"}).status_code == 412
    assert client.patch("/v1/business", headers={**auth, "if-match": "7"}, json={"phone": "x"}).status_code == 412
    assert client.put(f"{stub_url}/lines", headers={**auth, "if-match": "1"}, json=lines).json()["version"] == 2


def test_an_idempotency_key_makes_a_retry_safe(client: TestClient, auth: dict[str, str], other: dict[str, str]) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    key = {**auth, "idempotency-key": "create-marcus-1"}
    first = client.post("/v1/workers", headers=key, json=WORKER)
    retry = client.post("/v1/workers", headers=key, json=WORKER)
    assert (first.status_code, retry.status_code) == (201, 201)
    assert retry.json() == first.json()
    assert retry.headers["idempotency-replayed"] == "true"
    assert "idempotency-replayed" not in first.headers
    assert len(client.get("/v1/workers", headers=auth).json()["items"]) == 1

    different = client.post("/v1/workers", headers=key, json={**WORKER, "name": "Someone Else"})
    assert different.status_code == 422
    assert different.json()["error"]["code"] == "idempotency_key_reused"

    # Without a key, the same request twice is two workers.
    client.post("/v1/workers", headers=auth, json=WORKER)
    assert len(client.get("/v1/workers", headers=auth).json()["items"]) == 2

    # Keys are per user: another account using the same key is not handed this user's worker.
    client.post("/v1/business", headers=other, json=BUSINESS)
    theirs = client.post("/v1/workers", headers={**other, "idempotency-key": "create-marcus-1"}, json=WORKER)
    assert theirs.status_code == 201
    assert theirs.json()["id"] != first.json()["id"]
    assert "idempotency-replayed" not in theirs.headers

    worker_id = first.json()["id"]
    stub_key = {**auth, "idempotency-key": "next-stub-1"}
    one = client.post(f"/v1/workers/{worker_id}/stubs/next", headers=stub_key, json=TODAY)
    two = client.post(f"/v1/workers/{worker_id}/stubs/next", headers=stub_key, json=TODAY)
    assert one.json()["id"] == two.json()["id"]
    assert len(client.get("/v1/stubs", headers=auth, params={"workerId": worker_id}).json()["items"]) == 1

    assert client.post("/v1/workers", headers={**auth, "idempotency-key": "has space"}, json=WORKER).status_code == 400


def test_a_failed_request_does_not_burn_its_idempotency_key(client: TestClient, auth: dict[str, str]) -> None:
    key = {**auth, "idempotency-key": "first-worker"}
    assert client.post("/v1/workers", headers=key, json=WORKER).status_code == 404  # no business yet
    client.post("/v1/business", headers=auth, json=BUSINESS)
    assert client.post("/v1/workers", headers=key, json=WORKER).status_code == 201


def test_writes_are_rate_limited_per_user(outbound: Outbound, identity: FakeIdentityProviders) -> None:
    with make_client(outbound, write_rate_limit_per_minute=2) as client:
        first, second = new_user(client, identity, "u1"), new_user(client, identity, "u2")
        codes = [client.post("/v1/business", headers=first, json=BUSINESS).status_code for _ in range(3)]
        assert codes == [201, 409, 429]
        assert client.get("/v1/business", headers=first).status_code == 200  # reads are not counted
        assert client.post("/v1/business", headers=second, json=BUSINESS).status_code == 201


# ---- Isolation ----------------------------------------------------------------


def test_one_user_can_never_read_or_change_anothers_records(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    mine = seed(client, auth)
    worker_id, stub_id = mine["worker"]["id"], mine["stub"]["id"]
    before = client.get("/v1/me/export", headers=auth).json()["records"]
    lines = {"lines": [hourly("Regular", 60, 2400)]}

    # With no records of their own, the other user sees nothing anywhere.
    assert client.get("/v1/business", headers=other).status_code == 404
    assert client.get("/v1/workers", headers=other).json() == {"items": [], "nextCursor": None}
    assert client.get("/v1/stubs", headers=other).json() == {"items": [], "nextCursor": None}
    assert client.get("/v1/backup", headers=other).status_code == 404
    assert client.get("/v1/me/export", headers=other).json()["records"] is None

    theirs = seed(client, other, business_name="Other Shop")
    attempts = [
        ("GET", f"/v1/workers/{worker_id}", None),
        ("PATCH", f"/v1/workers/{worker_id}", {"rateCents": 1}),
        ("DELETE", f"/v1/workers/{worker_id}", None),
        ("POST", f"/v1/workers/{worker_id}/stubs/next", TODAY),
        ("GET", f"/v1/stubs/{stub_id}", None),
        ("PATCH", f"/v1/stubs/{stub_id}", {"payDate": "2026-12-25"}),
        ("PUT", f"/v1/stubs/{stub_id}/lines", lines),
        ("DELETE", f"/v1/stubs/{stub_id}", None),
        ("GET", f"/v1/stubs?workerId={worker_id}", None),
    ]
    for method, url, body in attempts:
        response = client.request(method, url, headers=other, json=body)
        assert response.status_code == 404, (method, url)
        assert response.json()["error"]["code"] in ("worker_not_found", "stub_not_found"), (method, url)

    # Their own lists and exports hold only their own rows.
    assert [w["id"] for w in client.get("/v1/workers", headers=other).json()["items"]] == [theirs["worker"]["id"]]
    assert [s["id"] for s in client.get("/v1/stubs", headers=other).json()["items"]] == [theirs["stub"]["id"]]
    assert client.get("/v1/business", headers=other).json()["name"] == "Other Shop"
    backup = client.get("/v1/backup", headers=other)
    assert worker_id not in backup.text and stub_id not in backup.text

    # Batch, business changes, import and delete act on the caller's data only.
    client.post("/v1/stubs/batch", headers=other, json={"today": "2026-12-01"})
    client.patch("/v1/business", headers=other, json={"name": "Renamed", "state": "TN"})
    client.put("/v1/backup", headers=other, json=client.get("/v1/backup", headers=other).json())
    client.delete("/v1/backup", headers=other)
    client.delete("/v1/business", headers=other)

    assert client.get("/v1/me/export", headers=auth).json()["records"] == before
    assert client.get(f"/v1/stubs/{stub_id}", headers=auth).json() == mine["stub"]


# ---- Stubs --------------------------------------------------------------------


def test_the_first_stub_is_drafted_with_taxes(client: TestClient, auth: dict[str, str]) -> None:
    stub = seed(client, auth)["stub"]
    assert stub["period"] == {"start": "2026-11-09", "end": "2026-11-22"}
    assert stub["payDate"] == "2026-11-27"  # the Friday after the period ends
    assert [(line["label"], line["minutes"], line["rateCents"]) for line in stub["lines"][:2]] == [
        ("Regular", 0, 2400),
        ("Overtime", 0, 3600),
    ]
    assert [(line["label"], line["taxCode"], line["source"]) for line in stub["lines"][2:]] == [
        ("Federal income tax", "fit", "calculated"),
        ("Social Security", "ss", "calculated"),
        ("Medicare", "medicare", "calculated"),
        ("Pennsylvania income tax", "sit", "calculated"),
        ("Health insurance", None, "manual"),
    ]
    assert stub["taxStatus"] == "calculated"
    assert stub["totals"] == {"grossCents": 0, "deductionsCents": 8500, "netCents": -8500, "totalMinutes": 0}
    assert stub["ytd"]["grossCents"] == 0


def test_replacing_lines_recalculates_pay_and_taxes(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    url = f"/v1/stubs/{made['stub']['id']}"
    sent = [
        hourly("Regular", 76 * 60 + 45, 2400, amount_cents=1),  # a stale amount is not trusted
        hourly("Overtime", 3 * 60 + 30, 3600),
        flat("earning", "Bonus", 7500),
        flat("deduction", "Health insurance", 8500),
    ]
    response = client.put(f"{url}/lines", headers=auth, json={"lines": sent})
    assert response.status_code == 200, response.text
    stub = response.json()

    # The server's answer is exactly what the shared calculation gives for these lines.
    earnings = [{**sent[0], "amountCents": 184200}, {**sent[1], "amountCents": 12600}, sent[2]]
    expected = apply_taxes(
        [*earnings, sent[3]],
        {
            "profile": DEFAULT_TAX_PROFILE,
            "businessState": "PA",
            "year": 2026,
            "schedule": "biweekly",
            "priorYtdGrossCents": 0,
        },
    )["lines"]
    returned = [{k: v for k, v in line.items() if k not in ("id", "taxOverride")} for line in stub["lines"]]
    assert returned == [{**line, "taxCode": line.get("taxCode")} for line in expected]

    gross = 184200 + 12600 + 7500
    assert stub["totals"]["grossCents"] == gross
    assert stub["totals"]["totalMinutes"] == 76 * 60 + 45 + 3 * 60 + 30
    assert amounts(stub)["Social Security"] == 12667  # 6.2% of $2,043.00
    assert amounts(stub)["Medicare"] == 2962  # 1.45%
    assert amounts(stub)["Pennsylvania income tax"] == 6272  # 3.07%
    assert stub["totals"]["netCents"] == gross - stub["totals"]["deductionsCents"]
    assert stub["ytd"]["byLine"]["earning:regular"] == 184200
    assert list(stub["ytd"]["byLine"]) == sorted(stub["ytd"]["byLine"])
    assert stub["version"] == 2
    assert client.get(url, headers=auth).json() == stub


def test_a_typed_over_tax_is_kept_and_flagged(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    url = f"/v1/stubs/{made['stub']['id']}/lines"
    lines = [
        hourly("Regular", 4800, 2400),
        flat("deduction", "Federal income tax", 12345, taxCode="fit"),
        flat("deduction", "Social Security", 1, taxCode="ss", source="calculated"),
    ]
    stub = client.put(url, headers=auth, json={"lines": lines}).json()
    by_code = {line["taxCode"]: line for line in stub["lines"] if line["taxCode"]}
    assert (by_code["fit"]["amountCents"], by_code["fit"]["source"], by_code["fit"]["taxOverride"]) == (
        12345,
        "manual",
        True,
    )
    # A "calculated" figure sent by the client is replaced by the server's own.
    assert (by_code["ss"]["amountCents"], by_code["ss"]["taxOverride"]) == (11904, False)

    # Sending the line back as calculated returns it to the computed figure.
    reset = [dict(line, source="calculated") if line.get("taxCode") == "fit" else line for line in lines]
    again = client.put(url, headers=auth, json={"lines": reset}).json()
    fit = next(line for line in again["lines"] if line["taxCode"] == "fit")
    assert fit["source"] == "calculated"
    assert fit["amountCents"] != 12345


def test_stub_lines_are_validated(client: TestClient, auth: dict[str, str]) -> None:
    url = f"/v1/stubs/{seed(client, auth)['stub']['id']}/lines"
    bad_lines = [
        [],
        [hourly("Regular", 60, 2400)] * 41,
        [{**hourly("Regular", 60, 2400), "rateCents": None}],
        [{**flat("deduction", "Garnishment", 100), "minutes": 60, "rateCents": 100}],
        [flat("deduction", "Mystery", 100, taxCode="vat")],
        [flat("earning", "Bonus", 10.5)],
        [flat("earning", "Bonus", -5)],
        [flat("bribe", "Bonus", 5)],
        [flat("earning", "", 5)],
    ]
    for lines in bad_lines:
        response = client.put(url, headers=auth, json={"lines": lines})
        assert response.status_code == 400, lines
        assert response.json()["error"]["code"] == "invalid_request"


def test_next_stub_carries_hours_forward_and_year_to_date_accumulates(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    worker_id = made["worker"]["id"]
    lines = [hourly("Regular", 4800, 2400), flat("earning", "Bonus", 5000), flat("deduction", "Health insurance", 8500)]
    first = client.put(f"/v1/stubs/{made['stub']['id']}/lines", headers=auth, json={"lines": lines}).json()

    client.patch(f"/v1/workers/{worker_id}", headers=auth, json={"rateCents": 2500})
    second = client.post(f"/v1/workers/{worker_id}/stubs/next", headers=auth, json=TODAY)
    assert second.status_code == 201
    stub = second.json()
    assert stub["period"] == {"start": "2026-11-23", "end": "2026-12-06"}
    assert stub["payDate"] == "2026-12-11"  # the same gap after the period as before
    labels = [line["label"] for line in stub["lines"]]
    assert "Bonus" not in labels  # one-off pay is not repeated
    regular = stub["lines"][0]
    assert (regular["minutes"], regular["rateCents"], regular["amountCents"]) == (4800, 2500, 200000)
    assert amounts(stub)["Social Security"] == 12400
    assert amounts(stub)["Health insurance"] == 8500

    assert stub["ytd"]["grossCents"] == first["totals"]["grossCents"] + 200000
    assert stub["ytd"]["byLine"]["earning:regular"] == 192000 + 200000
    assert stub["ytd"]["byLine"]["earning:bonus"] == 5000
    # The earlier stub's year to date does not include the later one.
    assert (
        client.get(f"/v1/stubs/{first['id']}", headers=auth).json()["ytd"]["grossCents"]
        == first["totals"]["grossCents"]
    )

    # Deleting the first stub takes it out of the second's year to date.
    assert client.delete(f"/v1/stubs/{first['id']}", headers=auth).status_code == 204
    assert client.get(f"/v1/stubs/{stub['id']}", headers=auth).json()["ytd"]["grossCents"] == 200000


def test_starting_balances_count_toward_year_to_date_and_the_social_security_cap(
    client: TestClient, auth: dict[str, str]
) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    # $184,000 already paid this year: only $500 of room is left under the $184,500 wage base.
    starting = {"year": 2026, "lines": [{"kind": "earning", "label": "Salary", "amountCents": 18_400_000}]}
    salaried = {
        "name": "Dana Reyes",
        "type": "employee",
        "payType": "salary",
        "rateCents": 800_000,
        "startingYtd": starting,
    }
    worker = client.post("/v1/workers", headers=auth, json=salaried).json()
    stub = client.post(f"/v1/workers/{worker['id']}/stubs/next", headers=auth, json=TODAY).json()
    assert stub["lines"][0]["label"] == "Salary"
    assert stub["totals"]["grossCents"] == 800_000
    assert amounts(stub)["Social Security"] == 3100  # 6.2% of the last $500
    assert amounts(stub)["Medicare"] == 11600
    assert stub["ytd"]["grossCents"] == 18_400_000 + 800_000


def test_contractors_have_nothing_withheld(client: TestClient, auth: dict[str, str]) -> None:
    client.post("/v1/business", headers=auth, json=BUSINESS)
    contractor = client.post("/v1/workers", headers=auth, json={**WORKER, "type": "contractor"}).json()
    stub = client.post(f"/v1/workers/{contractor['id']}/stubs/next", headers=auth, json=TODAY).json()
    assert [line["label"] for line in stub["lines"]] == ["Regular", "Overtime"]
    assert stub["taxStatus"] == "off"


def test_moving_the_pay_date_recalculates_taxes(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    url = f"/v1/stubs/{made['stub']['id']}"
    client.put(f"{url}/lines", headers=auth, json={"lines": [hourly("Regular", 4800, 2400)]})

    moved = client.patch(url, headers=auth, json={"payDate": "2027-01-04"})
    assert moved.status_code == 200
    # No tables for 2027 yet: calculated tax lines are dropped rather than left stale.
    assert moved.json()["taxStatus"] == "no-data-for-year"
    assert [line["label"] for line in moved.json()["lines"]] == ["Regular"]

    back = client.patch(
        url, headers=auth, json={"payDate": "2026-12-31", "period": {"start": "2026-12-14", "end": "2026-12-27"}}
    )
    assert back.json()["taxStatus"] == "calculated"
    assert back.json()["period"] == {"start": "2026-12-14", "end": "2026-12-27"}
    assert amounts(back.json())["Social Security"] == 11904

    assert client.patch(url, headers=auth, json={"payDate": "2026-02-30"}).status_code == 400
    backwards = client.patch(url, headers=auth, json={"period": {"start": "2026-12-14", "end": "2026-12-01"}})
    assert backwards.status_code == 400


def test_the_state_certificate_changes_state_tax(client: TestClient, auth: dict[str, str]) -> None:
    client.post("/v1/business", headers=auth, json={**BUSINESS, "state": "IL"})
    profile = {**DEFAULT_TAX_PROFILE, "stateW4": {**DEFAULT_TAX_PROFILE["stateW4"], "allowances": 2}}
    worker = client.post("/v1/workers", headers=auth, json={**WORKER, "taxProfile": profile}).json()
    stub = client.post(f"/v1/workers/{worker['id']}/stubs/next", headers=auth, json=TODAY).json()
    stub = client.put(
        f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [hourly("Regular", 4800, 2400)]}
    ).json()
    # IL-700-T: 4.95% x ($1,920.00 x 26 - 2 x $2,925) / 26 = $83.90
    assert amounts(stub)["Illinois income tax"] == 8390

    # A state whose formula is not in yet gets an empty line to type into.
    client.patch("/v1/business", headers=auth, json={"state": "CA"})
    stub = client.put(
        f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [hourly("Regular", 4800, 2400)]}
    ).json()
    california = next(line for line in stub["lines"] if line["taxCode"] == "sit")
    assert (california["label"], california["amountCents"], california["source"]) == (
        "California income tax",
        0,
        "manual",
    )
    assert california["taxOverride"] is False


def test_batch_makes_this_periods_stub_for_everyone_without_one(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    marcus = made["worker"]["id"]
    dana = client.post("/v1/workers", headers=auth, json={**WORKER, "name": "Dana Reyes"}).json()["id"]

    # Still inside the period Marcus already has a stub for: only Dana gets one.
    first = client.post("/v1/stubs/batch", headers=auth, json=TODAY)
    assert first.status_code == 201
    assert first.json()["period"] == {"start": "2026-11-09", "end": "2026-11-22"}
    assert [stub["workerId"] for stub in first.json()["created"]] == [dana]
    assert client.post("/v1/stubs/batch", headers=auth, json=TODAY).json()["created"] == []

    # Two weeks on, everyone gets the next period's stub, each keeping their own pay-date gap.
    later = client.post("/v1/stubs/batch", headers=auth, json={"today": "2026-12-02"}).json()
    assert later["period"] == {"start": "2026-11-23", "end": "2026-12-06"}
    assert [stub["workerId"] for stub in later["created"]] == [marcus, dana]
    assert {stub["payDate"] for stub in later["created"]} == {"2026-12-11"}
    assert len(client.get("/v1/stubs", headers=auth).json()["items"]) == 4


def test_stub_actions_need_a_business_and_a_real_date(client: TestClient, auth: dict[str, str]) -> None:
    assert client.post("/v1/stubs/batch", headers=auth, json=TODAY).json()["error"]["code"] == "business_not_found"
    made = seed(client, auth)
    url = f"/v1/workers/{made['worker']['id']}/stubs/next"
    assert client.post(url, headers=auth, json={"today": "2026-13-01"}).status_code == 400
    # With no body the server's own (UTC) date is used.
    assert client.post(url, headers=auth).status_code == 201


def test_deleting_a_worker_deletes_their_stubs(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    assert client.delete(f"/v1/workers/{made['worker']['id']}", headers=auth).status_code == 204
    assert client.get(f"/v1/stubs/{made['stub']['id']}", headers=auth).status_code == 404
    with client.app.state.sessions() as db:
        assert db.execute(text("SELECT count(*) FROM stub_lines")).scalar() == 0
