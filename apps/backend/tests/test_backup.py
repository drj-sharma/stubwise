from __future__ import annotations

import copy
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.domain.tax.types import DEFAULT_TAX_PROFILE


def hourly(label: str, minutes: int, rate_cents: int, amount_cents: int) -> dict[str, Any]:
    return {
        "kind": "earning",
        "label": label,
        "minutes": minutes,
        "rateCents": rate_cents,
        "amountCents": amount_cents,
        "source": "manual",
    }


def flat(kind: str, label: str, amount_cents: int) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": label,
        "minutes": None,
        "rateCents": None,
        "amountCents": amount_cents,
        "source": "manual",
    }


def snapshot() -> dict[str, Any]:
    """The fixture from apps/api/src/app.test.ts: a backup in the original format, as an older app would send it."""
    return {
        "business": {
            "id": "biz-1",
            "name": "Ridgeline Auto Repair",
            "address": "2140 Alder St, Chattanooga, TN 37404",
            "phone": "(423) 555-0142",
            "employerId": "62-1847305",
            "paySchedule": "biweekly",
            "showEmployerId": True,
            "templateId": "classic",
            "accent": "#3F3D9E",
        },
        "workers": [
            {
                "id": "w-marcus",
                "name": "Marcus Bell",
                "address": "418 Dodson Ave, Chattanooga, TN 37406",
                "email": "marcus@example.com",
                "ssnLast4": "7483",
                "type": "employee",
                "payType": "hourly",
                "rateCents": 2400,
                "defaultDeductions": [{"label": "Health insurance", "amountCents": 8500}],
                "startingYtd": {
                    "year": 2026,
                    "lines": [{"kind": "earning", "label": "Regular", "amountCents": 3571200}],
                },
            },
            {
                "id": "w-tyrone",
                "name": "Tyrone Whitaker",
                "address": "",
                "email": "",
                "ssnLast4": "",
                "type": "contractor",
                "payType": "hourly",
                "rateCents": 3200,
                "defaultDeductions": [],
                "startingYtd": None,
            },
        ],
        "stubs": [
            {
                "id": "s-4",
                "workerId": "w-marcus",
                "periodStart": "2026-11-09",
                "periodEnd": "2026-11-22",
                "payDate": "2026-11-27",
                "createdAt": "2026-11-26T10:00:00.000Z",
                "lines": [
                    hourly("Regular", 76 * 60 + 45, 2400, 184200),
                    hourly("Overtime", 3 * 60 + 30, 3600, 12600),
                    flat("earning", "Bonus", 7500),
                    flat("deduction", "Federal income tax", 18600),
                    flat("deduction", "Health insurance", 8500),
                ],
            }
        ],
    }


def without_ids(snap: dict[str, Any]) -> dict[str, Any]:
    """A snapshot with ids replaced by names, so two copies with different ids can be compared."""
    names = {worker["id"]: worker["name"] for worker in snap["workers"]}
    return {
        "business": {key: value for key, value in snap["business"].items() if key != "id"},
        "workers": [
            {key: value for key, value in worker.items() if key not in ("id", "createdAt")}
            for worker in snap["workers"]
        ],
        "stubs": [
            {**{key: value for key, value in stub.items() if key != "id"}, "workerId": names[stub["workerId"]]}
            for stub in snap["stubs"]
        ],
    }


def test_imports_a_snapshot_and_exports_the_same_records(client: TestClient, auth: dict[str, str]) -> None:
    missing = client.get("/v1/backup", headers=auth)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "no_backup"

    saved = client.put("/v1/backup", headers=auth, json=snapshot())
    assert saved.status_code == 200, saved.text
    assert saved.json().keys() == {"savedAt", "workers", "stubs"}
    assert (saved.json()["workers"], saved.json()["stubs"]) == (2, 1)

    loaded = client.get("/v1/backup", headers=auth).json()
    assert loaded.pop("savedAt").endswith("Z")
    # Everything that was sent comes back; fields the old format did not have are filled with the app's defaults.
    expected = without_ids(snapshot())
    expected["business"].update(
        state=None,
        firstPayDate=None,
        logoDataUri=None,
        overtimePct=150,
        appearance="light",
        showPto=False,
        showEmployerTaxes=False,
        showDepositSlip=False,
    )
    for worker in expected["workers"]:
        worker["taxProfile"] = DEFAULT_TAX_PROFILE
    assert without_ids(loaded) == expected
    assert all(worker["createdAt"].endswith("Z") for worker in loaded["workers"])

    # Ids are the server's own, and the same records are now reachable as resources.
    assert loaded["business"]["id"] != "biz-1"
    assert {worker["id"] for worker in loaded["workers"]}.isdisjoint({"w-marcus", "w-tyrone"})
    listed = client.get("/v1/workers", headers=auth).json()["items"]
    assert [worker["name"] for worker in listed] == ["Marcus Bell", "Tyrone Whitaker"]
    stub = client.get("/v1/stubs", headers=auth).json()["items"][0]
    assert stub["id"] == loaded["stubs"][0]["id"]
    assert stub["totals"]["grossCents"] == 184200 + 12600 + 7500
    assert stub["ytd"]["grossCents"] == 3571200 + 184200 + 12600 + 7500  # includes the starting balance

    # An export imports again unchanged (apart from new ids).
    again = client.put("/v1/backup", headers=auth, json=loaded)
    assert again.status_code == 200, again.text
    second = client.get("/v1/backup", headers=auth).json()
    assert without_ids(second) == without_ids(loaded)
    assert second["stubs"][0]["id"] != loaded["stubs"][0]["id"]


def test_new_fields_round_trip(client: TestClient, auth: dict[str, str]) -> None:
    full = snapshot()
    full["business"].update(
        state="IL", overtimePct=200, appearance="dark", logoDataUri="data:image/png;base64,iVBORw0KGgo="
    )
    profile = {
        "calculate": True,
        "state": "NC",
        "w4": {**DEFAULT_TAX_PROFILE["w4"], "filingStatus": "head"},
        "stateW4": {**DEFAULT_TAX_PROFILE["stateW4"], "allowances": 3, "extraWithholdingCents": 250, "status": "H"},
    }
    full["workers"][0]["taxProfile"] = profile
    full["workers"][0]["createdAt"] = "2026-03-01T09:30:00.000Z"
    full["stubs"][0]["lines"][3]["taxCode"] = "fit"
    assert client.put("/v1/backup", headers=auth, json=full).status_code == 200

    loaded = client.get("/v1/backup", headers=auth).json()
    assert {key: loaded["business"][key] for key in ("state", "overtimePct", "appearance", "logoDataUri")} == {
        "state": "IL",
        "overtimePct": 200,
        "appearance": "dark",
        "logoDataUri": "data:image/png;base64,iVBORw0KGgo=",
    }
    assert loaded["workers"][0]["taxProfile"] == profile
    assert loaded["workers"][0]["createdAt"] == "2026-03-01T09:30:00.000Z"
    assert loaded["stubs"][0]["createdAt"] == "2026-11-26T10:00:00.000Z"
    lines = loaded["stubs"][0]["lines"]
    assert lines[3]["taxCode"] == "fit"
    # Lines sent without a tax code come back without the key, not with a null.
    assert all("taxCode" not in line for i, line in enumerate(lines) if i != 3)


def test_tax_code_is_limited_to_20_characters(client: TestClient, auth: dict[str, str]) -> None:
    future = snapshot()
    future["stubs"][0]["lines"][3]["taxCode"] = "LOCAL_EIT_PA"  # a code this server does not know yet
    assert client.put("/v1/backup", headers=auth, json=future).status_code == 200
    assert client.get("/v1/backup", headers=auth).json()["stubs"][0]["lines"][3]["taxCode"] == "LOCAL_EIT_PA"

    too_long = snapshot()
    too_long["stubs"][0]["lines"][3]["taxCode"] = "X" * 21
    response = client.put("/v1/backup", headers=auth, json=too_long)
    assert response.status_code == 400
    assert response.json()["error"]["details"][0]["path"] == "stubs.0.lines.3.taxCode"

    not_text = snapshot()
    not_text["stubs"][0]["lines"][3]["taxCode"] = 7
    assert client.put("/v1/backup", headers=auth, json=not_text).status_code == 400


def test_import_replaces_everything_as_a_whole(client: TestClient, auth: dict[str, str]) -> None:
    client.put("/v1/backup", headers=auth, json=snapshot())
    smaller = snapshot()
    smaller["workers"] = [smaller["workers"][1]]
    smaller["stubs"] = []
    assert client.put("/v1/backup", headers=auth, json=smaller).status_code == 200
    loaded = client.get("/v1/backup", headers=auth).json()
    assert [worker["name"] for worker in loaded["workers"]] == ["Tyrone Whitaker"]
    assert loaded["stubs"] == []
    with client.app.state.sessions() as session:
        for table, count in (("businesses", 1), ("workers", 1), ("stubs", 0), ("stub_lines", 0)):
            assert session.execute(text(f"SELECT count(*) FROM {table}")).scalar() == count, table


def test_one_user_cannot_read_anothers_backup(client: TestClient, auth: dict[str, str], other: dict[str, str]) -> None:
    client.put("/v1/backup", headers=auth, json=snapshot())
    assert client.get("/v1/backup", headers=other).status_code == 404
    # Two users importing the same file (same ids inside it) do not collide.
    assert client.put("/v1/backup", headers=other, json=snapshot()).status_code == 200
    mine, theirs = (client.get("/v1/backup", headers=h).json() for h in (auth, other))
    assert mine["workers"][0]["id"] != theirs["workers"][0]["id"]
    assert without_ids(mine) == without_ids(theirs)


def test_refuses_amounts_that_do_not_match_hours_and_rate_and_saves_nothing(
    client: TestClient, auth: dict[str, str]
) -> None:
    client.put("/v1/backup", headers=auth, json=snapshot())
    before = client.get("/v1/backup", headers=auth).json()

    tampered = snapshot()
    tampered["business"]["name"] = "Changed"
    tampered["stubs"][0]["lines"][0] = hourly("Regular", 76 * 60 + 45, 2400, 999999)
    response = client.put("/v1/backup", headers=auth, json=tampered)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "snapshot_rejected"
    assert error["details"] == [
        {
            "stubId": "s-4",
            "message": '"Regular" should be $1,842.00 for its hours and rate, but $9,999.99 was sent',
        }
    ]
    assert client.get("/v1/backup", headers=auth).json() == before


def test_half_cents_round_up(client: TestClient, auth: dict[str, str]) -> None:
    # 1 minute at $18.30/h is 30.5 cents: 31 is right, 30 is not.
    exact = snapshot()
    exact["stubs"][0]["lines"] = [hourly("Regular", 1, 1830, 31)]
    assert client.put("/v1/backup", headers=auth, json=exact).status_code == 200
    rounded_down = copy.deepcopy(exact)
    rounded_down["stubs"][0]["lines"][0]["amountCents"] = 30
    assert client.put("/v1/backup", headers=auth, json=rounded_down).status_code == 422


def test_refuses_records_that_do_not_fit_together(client: TestClient, auth: dict[str, str]) -> None:
    orphan = snapshot()
    orphan["stubs"][0]["workerId"] = "w-missing"

    backwards = snapshot()
    backwards["stubs"][0]["periodEnd"] = "2026-11-01"

    twins = snapshot()
    twins["workers"].append(copy.deepcopy(twins["workers"][0]))

    for bad, expected in ((orphan, "unknown worker w-missing"), (backwards, "period ends"), (twins, "duplicate")):
        response = client.put("/v1/backup", headers=auth, json=bad)
        assert response.status_code == 422
        assert expected in response.json()["error"]["details"][0]["message"]


def test_rejects_malformed_fields_with_field_level_messages(client: TestClient, auth: dict[str, str]) -> None:
    bad = snapshot()
    stub = bad["stubs"][0]
    stub["payDate"] = "2026-02-30"
    stub["createdAt"] = "2026-11-26 10:00"
    stub["lines"][2]["amountCents"] = 10.5
    stub["lines"][3]["minutes"] = 60  # a deduction cannot carry hours (and has no rate)
    stub["lines"][4]["amountCents"] = "8500"
    bad["business"]["templateId"] = "neon"
    bad["business"]["accent"] = "blue"
    bad["workers"][0]["id"] = "has space"
    bad["workers"][1]["name"] = "   "

    response = client.put("/v1/backup", headers=auth, json=bad)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert {detail["path"] for detail in error["details"]} == {
        "stubs.0.payDate",
        "stubs.0.createdAt",
        "stubs.0.lines.2.amountCents",
        "stubs.0.lines.3",
        "stubs.0.lines.4.amountCents",
        "business.templateId",
        "business.accent",
        "workers.0.id",
        "workers.1.name",
    }

    too_many = snapshot()
    too_many["workers"] = [{**too_many["workers"][1], "id": f"w-{n}"} for n in range(51)]
    assert client.put("/v1/backup", headers=auth, json=too_many).status_code == 400


def test_text_is_trimmed_and_unknown_keys_are_dropped(client: TestClient, auth: dict[str, str]) -> None:
    padded = snapshot()
    padded["business"]["name"] = "  Ridgeline Auto Repair  "
    padded["business"]["futureField"] = "ignored"
    assert client.put("/v1/backup", headers=auth, json=padded).status_code == 200
    business = client.get("/v1/backup", headers=auth).json()["business"]
    assert business["name"] == "Ridgeline Auto Repair"
    assert "futureField" not in business


def test_delete_removes_the_records_and_keeps_the_account(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    client.put("/v1/backup", headers=auth, json=snapshot())
    client.put("/v1/backup", headers=other, json=snapshot())

    deleted = client.delete("/v1/backup", headers=auth)
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert client.get("/v1/backup", headers=auth).status_code == 404
    assert client.get("/v1/workers", headers=auth).json()["items"] == []
    assert client.get("/v1/me", headers=auth).status_code == 200
    assert client.get("/v1/backup", headers=other).status_code == 200
    with client.app.state.sessions() as session:
        assert session.execute(text("SELECT count(*) FROM users")).scalar() == 2
        assert session.execute(text("SELECT count(*) FROM businesses")).scalar() == 1
        assert session.execute(text("SELECT count(*) FROM stubs")).scalar() == 1
