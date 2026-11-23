"""Per-mile, per-load, per-day and per-piece pay, and bonus pay taxed at the flat supplemental rate."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.domain.calc_stub import calc_stub, default_supplemental, line_amount
from app.domain.next_stub import draft_next_stub
from app.domain.tax.apply_taxes import apply_taxes, supplemental_notes
from app.domain.tax.federal import federal_income_tax, federal_tax_data, supplemental_income_tax
from app.domain.tax.types import DEFAULT_TAX_PROFILE, DEFAULT_W4
from app.domain.time import pay_for_quantity

from .test_backup import snapshot
from .test_records import BUSINESS, TODAY, flat, hourly


def per_unit(label: str, unit: str, quantity_milli: int, rate_cents: int, amount_cents: int = 0) -> dict[str, Any]:
    return {
        "kind": "earning",
        "label": label,
        "minutes": None,
        "rateCents": rate_cents,
        "quantityMilli": quantity_milli,
        "unit": unit,
        "amountCents": amount_cents,
        "source": "manual",
    }


def worker_and_stub(client: TestClient, auth: dict[str, str], pay_type: str, rate_cents: int) -> tuple[Any, Any]:
    assert client.post("/v1/business", headers=auth, json=BUSINESS).status_code == 201
    worker = client.post(
        "/v1/workers",
        headers=auth,
        json={"name": "Lena Ortiz", "type": "employee", "payType": pay_type, "rateCents": rate_cents},
    )
    assert worker.status_code == 201, worker.text
    stub = client.post(f"/v1/workers/{worker.json()['id']}/stubs/next", headers=auth, json=TODAY)
    assert stub.status_code == 201, stub.text
    return worker.json(), stub.json()


# ---- The arithmetic ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity_milli", "rate_cents", "expected"),
    [
        (0, 62, 0),
        (1_000, 62, 62),
        (12_500, 62, 775),  # 12.5 miles at $0.62
        (1_234_567, 62, 76_543),  # 1,234.567 miles: 765.43154 rounds down
        (3, 500, 2),  # 0.003 x $5.00 = 1.5 cents rounds half up
    ],
)
def test_pay_for_quantity_rounds_once_at_the_end(quantity_milli: int, rate_cents: int, expected: int) -> None:
    assert pay_for_quantity(quantity_milli, rate_cents) == expected


def test_a_per_unit_line_is_quantity_times_rate_and_is_not_hours() -> None:
    line = per_unit("Miles", "mile", 842_500, 62)
    assert line_amount(line) == 52_235  # type: ignore[arg-type]
    totals = calc_stub([line])  # type: ignore[list-item]
    assert totals == {"grossCents": 52_235, "deductionsCents": 0, "netCents": 52_235, "totalMinutes": 0}


def test_a_line_without_the_new_fields_still_works() -> None:
    old = {
        "kind": "earning",
        "label": "Regular",
        "minutes": 600,
        "rateCents": 2000,
        "amountCents": 0,
        "source": "manual",
    }
    assert line_amount(old) == 20_000  # type: ignore[arg-type]


# ---- Supplemental (bonus) pay -----------------------------------------------------

CONTEXT: Any = {
    "profile": DEFAULT_TAX_PROFILE,
    "businessState": "TN",  # no wage income tax, so only the federal figures move
    "year": 2026,
    "schedule": "biweekly",
    "priorYtdGrossCents": 0,
    "stateRules": [],
}


def fit(lines: list[Any], context: Any = CONTEXT) -> int:
    result = apply_taxes(lines, context)["lines"]
    return next(line["amountCents"] for line in result if line.get("taxCode") == "fit")


def test_a_supplemental_bonus_is_taxed_at_the_flat_rate_and_regular_pay_on_its_own() -> None:
    data = federal_tax_data(2026)
    assert data is not None
    regular = flat("earning", "Salary", 200_000)
    bonus = {**flat("earning", "Bonus", 100_000), "supplemental": True}
    expected = federal_income_tax(data=data, wages_cents=200_000, periods_per_year=26, w4=DEFAULT_W4) + 22_000
    assert fit([regular, bonus]) == expected
    assert supplemental_income_tax(data=data, wages_cents=100_000, w4=DEFAULT_W4) == 22_000


def test_without_the_flag_a_bonus_is_ordinary_pay() -> None:
    data = federal_tax_data(2026)
    assert data is not None
    plain = [flat("earning", "Salary", 200_000), flat("earning", "Bonus", 100_000)]
    assert fit(plain) == federal_income_tax(data=data, wages_cents=300_000, periods_per_year=26, w4=DEFAULT_W4)
    off = [plain[0], {**plain[1], "supplemental": False}]
    assert fit(off) == fit(plain)


def test_a_bonus_only_stub_is_taxed_at_the_flat_rate() -> None:
    assert fit([{**flat("earning", "Bonus", 50_000), "supplemental": True}]) == 11_000


def test_an_exempt_employee_has_nothing_withheld_on_a_bonus() -> None:
    exempt = {**CONTEXT, "profile": {**DEFAULT_TAX_PROFILE, "w4": {**DEFAULT_W4, "exempt": True}}}
    assert fit([{**flat("earning", "Bonus", 50_000), "supplemental": True}], exempt) == 0


def test_social_security_and_medicare_still_apply_to_the_whole_gross() -> None:
    result = apply_taxes([{**flat("earning", "Bonus", 100_000), "supplemental": True}], CONTEXT)["lines"]
    taxes = {line["taxCode"]: line["amountCents"] for line in result if line.get("taxCode")}
    assert taxes["ss"] == 6_200
    assert taxes["medicare"] == 1_450


def test_only_a_line_named_bonus_starts_out_supplemental() -> None:
    assert default_supplemental("Bonus") and default_supplemental("  bonus ")
    assert not default_supplemental("Commission") and not default_supplemental("Tips")


def test_the_state_is_told_it_gets_no_bonus_rate_and_a_no_tax_state_is_not() -> None:
    lines = [flat("earning", "Salary", 200_000), {**flat("earning", "Bonus", 100_000), "supplemental": True}]
    pa_rules = [{"tax": "income", "method": "state", "params": {}}]
    notes = supplemental_notes(lines, {**CONTEXT, "businessState": "PA", "stateRules": pa_rules})  # type: ignore[arg-type]
    assert len(notes) == 2
    assert "Pennsylvania" in notes[1] and "usual" in notes[1]
    assert len(supplemental_notes(lines, CONTEXT)) == 1  # type: ignore[arg-type]
    assert supplemental_notes(lines[:1], CONTEXT) == []  # type: ignore[arg-type]


# ---- Drafting the next stub -------------------------------------------------------


@pytest.mark.parametrize(
    ("pay_type", "label", "unit"),
    [("mile", "Miles", "mile"), ("load", "Loads", "load"), ("day", "Days", "day"), ("piece", "Pieces", "piece")],
)
def test_a_first_stub_for_a_per_unit_worker_has_one_empty_line(pay_type: str, label: str, unit: str) -> None:
    worker: Any = {"payType": pay_type, "rateCents": 62, "type": "contractor", "defaultDeductions": []}
    draft = draft_next_stub(worker, "weekly", None, "2026-11-18")
    assert draft["lines"] == [
        {
            "kind": "earning",
            "label": label,
            "minutes": None,
            "rateCents": 62,
            "quantityMilli": 0,
            "unit": unit,
            "amountCents": 0,
            "source": "manual",
        }
    ]


def test_units_carry_over_at_the_workers_new_rate_and_other_units_keep_theirs() -> None:
    worker: Any = {"payType": "mile", "rateCents": 62, "type": "contractor", "defaultDeductions": []}
    first = draft_next_stub(worker, "weekly", None, "2026-11-18")
    previous = {
        "period": first["period"],
        "payDate": first["payDate"],
        "lines": [
            per_unit("Miles", "mile", 1_000_000, 58, 58_000),
            per_unit("Loads", "load", 3_000, 7_500, 22_500),
            {**flat("earning", "Bonus", 10_000), "supplemental": True},
        ],
    }
    second = draft_next_stub({**worker, "rateCents": 65}, "weekly", previous, "2026-11-25")  # type: ignore[arg-type]
    assert [(line["label"], line["rateCents"], line["amountCents"]) for line in second["lines"]] == [
        ("Miles", 65, 65_000),
        ("Loads", 7_500, 22_500),
    ]


# ---- The API ----------------------------------------------------------------------


def test_a_per_mile_worker_gets_a_miles_line_and_a_saved_stub_adds_up(client: TestClient, auth: dict[str, str]) -> None:
    worker, stub = worker_and_stub(client, auth, "mile", 62)
    assert worker["payType"] == "mile"
    first = stub["lines"][0]
    assert (first["label"], first["unit"], first["quantityMilli"], first["rateCents"]) == ("Miles", "mile", 0, 62)

    sent = [per_unit("Miles", "mile", 842_500, 62, amount_cents=1), per_unit("Loads", "load", 6_000, 8_000)]
    response = client.put(f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": sent})
    assert response.status_code == 200, response.text
    saved = response.json()
    amounts = {line["label"]: line["amountCents"] for line in saved["lines"] if not line["taxCode"]}
    assert amounts == {"Miles": 52_235, "Loads": 48_000}  # the stale amount is not trusted
    assert saved["totals"]["grossCents"] == 100_235
    assert saved["totals"]["totalMinutes"] == 0
    assert [(line["quantityMilli"], line["unit"]) for line in saved["lines"][:2]] == [
        (842_500, "mile"),
        (6_000, "load"),
    ]

    # And it reads back the same.
    again = client.get(f"/v1/stubs/{stub['id']}", headers=auth).json()
    assert again["lines"] == saved["lines"]


def test_the_bonus_flag_is_saved_and_taxed_and_the_state_note_is_returned(
    client: TestClient, auth: dict[str, str]
) -> None:
    _, stub = worker_and_stub(client, auth, "salary", 200_000)
    bonus = {**flat("earning", "Bonus", 100_000), "supplemental": True}
    response = client.put(
        f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [flat("earning", "Salary", 200_000), bonus]}
    )
    saved = response.json()
    assert [line["supplemental"] for line in saved["lines"][:2]] == [False, True]
    data = federal_tax_data(2026)
    assert data is not None
    taxes = {line["taxCode"]: line["amountCents"] for line in saved["lines"] if line["taxCode"]}
    assert (
        taxes["fit"] == federal_income_tax(data=data, wages_cents=200_000, periods_per_year=26, w4=DEFAULT_W4) + 22_000
    )
    assert saved["taxNotes"][0].startswith("Bonus pay: federal income tax")
    assert "Pennsylvania" in saved["taxNotes"][1]


def test_a_stub_with_no_bonus_has_no_tax_notes(client: TestClient, auth: dict[str, str]) -> None:
    _, stub = worker_and_stub(client, auth, "hourly", 2400)
    assert stub["taxNotes"] == []


@pytest.mark.parametrize(
    "line",
    [
        {**per_unit("Miles", "mile", 1, 62), "minutes": 60},  # hours and units together
        {**per_unit("Miles", "mile", 1, 62), "unit": None},  # units with no unit label
        {**per_unit("Miles", "mile", 1, 62), "rateCents": None},  # units with no rate
        {**per_unit("Miles", "mile", 1, 62), "kind": "deduction"},
        {**flat("earning", "Salary", 1), "unit": "mile"},  # a unit with no quantity
        {**flat("deduction", "Health", 1), "supplemental": True},
        per_unit("Miles", "mile", 10_000_001, 62),
    ],
)
def test_malformed_lines_are_refused(client: TestClient, auth: dict[str, str], line: dict[str, Any]) -> None:
    _, stub = worker_and_stub(client, auth, "hourly", 2400)
    response = client.put(f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [line]})
    assert response.status_code == 400, response.text


def test_an_unknown_pay_type_is_refused(client: TestClient, auth: dict[str, str]) -> None:
    assert client.post("/v1/business", headers=auth, json=BUSINESS).status_code == 201
    body = {"name": "A", "type": "employee", "payType": "fortnight", "rateCents": 1}
    assert client.post("/v1/workers", headers=auth, json=body).status_code == 400


def test_next_period_carries_units_forward(client: TestClient, auth: dict[str, str]) -> None:
    worker, stub = worker_and_stub(client, auth, "mile", 62)
    client.put(f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [per_unit("Miles", "mile", 500_000, 62)]})
    nxt = client.post(f"/v1/workers/{worker['id']}/stubs/next", headers=auth, json=TODAY)
    assert nxt.status_code == 201, nxt.text
    line = nxt.json()["lines"][0]
    assert (line["quantityMilli"], line["amountCents"]) == (500_000, 31_000)


# ---- Backup -----------------------------------------------------------------------


def _snapshot(lines: list[dict[str, Any]]) -> dict[str, Any]:
    """The backup fixture with its first stub's lines swapped for these, on a per-mile worker."""
    data = snapshot()
    data["workers"][0]["payType"] = "mile"
    data["workers"][0]["rateCents"] = 62
    data["stubs"][0]["lines"] = lines
    return data


def test_backup_round_trips_per_unit_and_supplemental_lines(client: TestClient, auth: dict[str, str]) -> None:
    lines = [per_unit("Miles", "mile", 842_500, 62, 52_235), {**flat("earning", "Bonus", 10_000), "supplemental": True}]
    assert client.put("/v1/backup", headers=auth, json=_snapshot(lines)).status_code == 200
    loaded = client.get("/v1/backup", headers=auth).json()["stubs"][0]["lines"]
    assert loaded == lines


def test_backup_refuses_a_per_unit_amount_that_does_not_add_up(client: TestClient, auth: dict[str, str]) -> None:
    response = client.put("/v1/backup", headers=auth, json=_snapshot([per_unit("Miles", "mile", 842_500, 62, 99)]))
    assert response.status_code == 422
    assert "quantity and rate" in response.text


def test_a_backup_from_before_these_fields_loads_without_them(client: TestClient, auth: dict[str, str]) -> None:
    old = [hourly("Regular", 600, 2000, 20_000)]
    assert client.put("/v1/backup", headers=auth, json=_snapshot(old)).status_code == 200
    assert client.get("/v1/backup", headers=auth).json()["stubs"][0]["lines"] == old


# ---- Earnings report --------------------------------------------------------------


def test_the_earnings_report_totals_units_beside_the_amount(client: TestClient, auth: dict[str, str]) -> None:
    _worker, stub = worker_and_stub(client, auth, "mile", 62)
    sent = [per_unit("Miles", "mile", 842_500, 62), per_unit("Loads", "load", 6_000, 8_000)]
    saved = client.put(f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": sent}).json()
    pay_date = saved["payDate"]
    params = {"from": pay_date, "to": pay_date}

    report = client.get("/v1/reports/earnings", headers=auth, params=params).json()
    rows = [(r["label"], r["quantityMilli"], r["unit"], r["amountCents"]) for r in report["totals"]["lines"]]
    assert rows == [("Miles", 842_500, "mile", 52_235), ("Loads", 6_000, "load", 48_000)]
    assert report["workers"][0]["lines"] == report["totals"]["lines"]
    assert report["totals"]["grossCents"] == 100_235

    csv_text = client.get("/v1/reports/earnings", headers=auth, params={**params, "format": "csv"}).text
    assert "Lena Ortiz,Miles,,842.5,mile,522.35" in csv_text
    assert "All workers,Loads,,6,load,480.00" in csv_text
    assert "All workers,Gross pay,,,,1002.35" in csv_text


def test_hourly_rows_in_the_report_have_no_units(client: TestClient, auth: dict[str, str]) -> None:
    _, stub = worker_and_stub(client, auth, "hourly", 2400)
    saved = client.put(
        f"/v1/stubs/{stub['id']}/lines", headers=auth, json={"lines": [hourly("Regular", 600, 2400)]}
    ).json()
    report = client.get("/v1/reports/earnings", headers=auth, params={"from": saved["payDate"], "to": saved["payDate"]})
    row = report.json()["totals"]["lines"][0]
    assert (row["quantityMilli"], row["unit"], row["minutes"]) == (None, None, 600)
