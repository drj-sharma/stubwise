"""Optional stub extras: paid time off, employer-paid taxes, and the deposit slip switch."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.domain.extras import carry_forward, compute_employer_taxes, compute_pto

from .test_backup import snapshot
from .test_records import TODAY, seed

HOURS = 60


def stub_row(stub_id: str, pay_date: str, pto: Any = None, taxes: Any = None) -> Any:
    return {
        "id": stub_id,
        "payDate": pay_date,
        "createdAt": f"{pay_date}T00:00:00.000000Z",
        "pto": pto,
        "employerTaxes": taxes,
    }


def use(accrued: int = 0, used: int = 0) -> dict[str, int]:
    return {"accruedMinutes": accrued, "usedMinutes": used}


# ---- The calculations ---------------------------------------------------------


def test_pto_balance_is_the_opening_balance_plus_accrued_minus_used() -> None:
    first = stub_row("a", "2026-11-13", {"sick": use(90), "vacation": use(120, 480)})
    second = stub_row("b", "2026-11-27", {"sick": use(90, 60), "vacation": use(120)})
    later = stub_row("c", "2026-12-11", {"sick": use(999)})
    start = {"sickMinutes": 8 * HOURS, "vacationMinutes": 40 * HOURS}

    result = compute_pto(second, [first, second, later], start)

    assert result["sick"] == {"accruedMinutes": 90, "usedMinutes": 60, "availableMinutes": 480 + 90 + 90 - 60}
    assert result["vacation"] == {"accruedMinutes": 120, "usedMinutes": 0, "availableMinutes": 2400 + (120 - 480) + 120}


def test_pto_carries_across_the_new_year_and_handles_nothing_entered() -> None:
    december = stub_row("a", "2026-12-25", {"sick": use(100)})
    january = stub_row("b", "2027-01-08")
    assert compute_pto(january, [december, january], None)["sick"]["availableMinutes"] == 100
    assert compute_pto(january, [january], None)["vacation"] == {
        "accruedMinutes": 0,
        "usedMinutes": 0,
        "availableMinutes": 0,
    }


def test_employer_taxes_add_up_by_label_within_the_year() -> None:
    old = stub_row("a", "2025-12-26", taxes=[{"label": "FUTA", "amountCents": 5000}])
    one = stub_row(
        "b", "2026-11-13", taxes=[{"label": "FUTA", "amountCents": 1000}, {"label": "SUTA", "amountCents": 4000}]
    )
    two = stub_row("c", "2026-11-27", taxes=[{"label": "futa ", "amountCents": 1100}])
    assert compute_employer_taxes(two, [old, one, two]) == [{"label": "futa ", "amountCents": 1100, "ytdCents": 2100}]
    assert compute_employer_taxes(one, [old, one, two])[1]["ytdCents"] == 4000


def test_the_next_stub_starts_from_the_same_accrual_with_nothing_used() -> None:
    previous = stub_row(
        "a", "2026-11-13", {"sick": use(90, 30), "vacation": use(0, 480)}, [{"label": "FUTA", "amountCents": 1}]
    )
    pto, taxes = carry_forward(previous)
    assert pto == {"sick": use(90), "vacation": use(0)}
    assert taxes == [{"label": "FUTA", "amountCents": 1}]
    assert carry_forward(None) == (None, None)
    assert carry_forward(stub_row("b", "2026-11-27")) == (None, None)


# ---- The API ------------------------------------------------------------------


def test_the_extras_are_off_by_default_and_switchable(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)["business"]
    assert (made["showPto"], made["showEmployerTaxes"], made["showDepositSlip"]) == (False, False, False)
    patched = client.patch("/v1/business", headers=auth, json={"showPto": True, "showDepositSlip": True})
    assert patched.status_code == 200
    assert (patched.json()["showPto"], patched.json()["showEmployerTaxes"], patched.json()["showDepositSlip"]) == (
        True,
        False,
        True,
    )
    assert client.patch("/v1/business", headers=auth, json={"showPto": "yes"}).status_code == 400
    assert client.patch("/v1/business", headers=auth, json={"showPto": None}).status_code == 400


def test_a_new_stub_has_zero_pto_and_no_employer_taxes(client: TestClient, auth: dict[str, str]) -> None:
    stub = seed(client, auth)["stub"]
    assert stub["pto"]["sick"] == {"accruedMinutes": 0, "usedMinutes": 0, "availableMinutes": 0}
    assert stub["employerTaxes"] == []


def test_pto_and_employer_taxes_are_entered_per_stub_and_carry_forward(
    client: TestClient, auth: dict[str, str]
) -> None:
    made = seed(client, auth)
    worker, stub = made["worker"], made["stub"]
    patched = client.patch(
        f"/v1/workers/{worker['id']}", headers=auth, json={"ptoStart": {"sickMinutes": 480, "vacationMinutes": 2400}}
    )
    assert patched.json()["ptoStart"] == {"sickMinutes": 480, "vacationMinutes": 2400}
    net_before = stub["totals"]["netCents"]

    body = {
        "pto": {"sick": use(90, 0), "vacation": use(120, 480)},
        "employerTaxes": [{"label": "FUTA", "amountCents": 1104}, {"label": "SUTA", "amountCents": 5520}],
    }
    saved = client.put(f"/v1/stubs/{stub['id']}/extras", headers=auth, json=body)
    assert saved.status_code == 200, saved.text
    first = saved.json()
    assert first["pto"]["sick"] == {"accruedMinutes": 90, "usedMinutes": 0, "availableMinutes": 570}
    assert first["pto"]["vacation"] == {"accruedMinutes": 120, "usedMinutes": 480, "availableMinutes": 2040}
    assert first["employerTaxes"] == [
        {"label": "FUTA", "amountCents": 1104, "ytdCents": 1104},
        {"label": "SUTA", "amountCents": 5520, "ytdCents": 5520},
    ]
    # Employer-paid taxes never reduce what the worker takes home.
    assert first["totals"]["netCents"] == net_before
    assert first["version"] == stub["version"] + 1

    next_stub = client.post(f"/v1/workers/{worker['id']}/stubs/next", headers=auth, json=TODAY).json()
    assert next_stub["pto"]["sick"] == {"accruedMinutes": 90, "usedMinutes": 0, "availableMinutes": 660}
    assert next_stub["pto"]["vacation"] == {"accruedMinutes": 120, "usedMinutes": 0, "availableMinutes": 2160}
    assert [tax["ytdCents"] for tax in next_stub["employerTaxes"]] == [2208, 11040]

    # Editing the first stub moves the balance on the second, as year-to-date does.
    client.put(f"/v1/stubs/{stub['id']}/extras", headers=auth, json={"pto": {"sick": use(0, 0)}, "employerTaxes": []})
    reread = client.get(f"/v1/stubs/{next_stub['id']}", headers=auth).json()
    assert reread["pto"]["sick"]["availableMinutes"] == 480 + 90
    assert [tax["ytdCents"] for tax in reread["employerTaxes"]] == [1104, 5520]


def test_extras_are_validated_and_guarded_by_version_and_owner(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    stub = seed(client, auth)["stub"]
    url = f"/v1/stubs/{stub['id']}/extras"
    assert client.put(url, headers=auth, json={"pto": {"sick": use(-1)}}).status_code == 400
    assert client.put(url, headers=auth, json={"employerTaxes": [{"label": "", "amountCents": 1}]}).status_code == 400
    assert (
        client.put(url, headers=auth, json={"employerTaxes": [{"label": "X", "amountCents": 1.5}]}).status_code == 400
    )
    too_many = [{"label": f"T{i}", "amountCents": 1} for i in range(11)]
    assert client.put(url, headers=auth, json={"employerTaxes": too_many}).status_code == 400
    assert client.put(url, headers={**auth, "If-Match": "99"}, json={}).status_code == 412
    assert client.put(url, headers=other, json={}).status_code == 404


def test_clearing_a_workers_opening_balance(client: TestClient, auth: dict[str, str]) -> None:
    worker = seed(client, auth)["worker"]
    assert worker["ptoStart"] is None
    url = f"/v1/workers/{worker['id']}"
    client.patch(url, headers=auth, json={"ptoStart": {"sickMinutes": 60}})
    assert client.get(url, headers=auth).json()["ptoStart"] == {"sickMinutes": 60, "vacationMinutes": 0}
    client.patch(url, headers=auth, json={"ptoStart": None})
    assert client.get(url, headers=auth).json()["ptoStart"] is None


# ---- Backups ------------------------------------------------------------------


def test_the_extras_survive_a_backup(client: TestClient, auth: dict[str, str]) -> None:
    full = snapshot()
    full["business"].update(showPto=True, showEmployerTaxes=True, showDepositSlip=True)
    full["workers"][0]["ptoStart"] = {"sickMinutes": 480, "vacationMinutes": 0}
    full["stubs"][0]["pto"] = {"sick": use(90, 30), "vacation": use(0, 0)}
    full["stubs"][0]["employerTaxes"] = [{"label": "FUTA", "amountCents": 1104}]
    assert client.put("/v1/backup", headers=auth, json=full).status_code == 200

    loaded = client.get("/v1/backup", headers=auth).json()
    business = loaded["business"]
    assert (business["showPto"], business["showEmployerTaxes"], business["showDepositSlip"]) == (True, True, True)
    assert loaded["workers"][0]["ptoStart"] == {"sickMinutes": 480, "vacationMinutes": 0}
    assert "ptoStart" not in loaded["workers"][1]
    assert loaded["stubs"][0]["pto"] == {"sick": use(90, 30), "vacation": use(0, 0)}
    assert loaded["stubs"][0]["employerTaxes"] == [{"label": "FUTA", "amountCents": 1104}]

    stub = client.get("/v1/stubs", headers=auth).json()["items"][0]
    assert stub["pto"]["sick"]["availableMinutes"] == 480 + 90 - 30
    assert stub["employerTaxes"][0]["ytdCents"] == 1104


def test_a_backup_made_before_the_extras_existed_still_loads(client: TestClient, auth: dict[str, str]) -> None:
    assert client.put("/v1/backup", headers=auth, json=snapshot()).status_code == 200
    stub = client.get("/v1/stubs", headers=auth).json()["items"][0]
    assert stub["employerTaxes"] == []
    assert stub["pto"]["sick"]["availableMinutes"] == 0
    business = client.get("/v1/business", headers=auth).json()
    assert (business["showPto"], business["showEmployerTaxes"], business["showDepositSlip"]) == (False, False, False)


@pytest.mark.parametrize(
    "change",
    [
        {"pto": {"sick": {"accruedMinutes": 1.5}}},
        {"employerTaxes": [{"label": "FUTA", "amountCents": -1}]},
    ],
)
def test_a_backup_with_bad_extras_is_refused(client: TestClient, auth: dict[str, str], change: dict) -> None:
    bad = snapshot()
    bad["stubs"][0].update(change)
    assert client.put("/v1/backup", headers=auth, json=bad).status_code == 400
