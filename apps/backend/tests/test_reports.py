"""Earnings and deductions reports, worked out on the server from saved stubs."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from .test_records import flat, hourly, seed


def _stub_with(client: TestClient, auth: dict[str, str], stub_id: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    response = client.put(f"/v1/stubs/{stub_id}/lines", headers=auth, json={"lines": lines})
    assert response.status_code == 200, response.text
    return response.json()


def test_earnings_and_deductions_add_up_the_stubs_in_the_range(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    stub = _stub_with(
        client,
        auth,
        made["stub"]["id"],
        [
            hourly("Regular", 80 * 60, 2400),
            hourly("Overtime", 2 * 60, 3600),
            flat("earning", "Bonus", 10000),
            flat("deduction", "Health insurance", 8500),
        ],
    )
    pay_date = stub["payDate"]

    earnings = client.get("/v1/reports/earnings", headers=auth, params={"from": pay_date, "to": pay_date}).json()
    assert earnings["stubCount"] == 1
    assert [(line["label"], line["minutes"], line["amountCents"]) for line in earnings["totals"]["lines"]] == [
        ("Regular", 4800, 192000),
        ("Overtime", 120, 7200),
        ("Bonus", 0, 10000),
    ]
    assert earnings["totals"]["grossCents"] == stub["totals"]["grossCents"] == 209200
    assert earnings["totals"]["minutes"] == 4920
    assert [worker["name"] for worker in earnings["workers"]] == [made["worker"]["name"]]

    deductions = client.get("/v1/reports/deductions", headers=auth, params={"from": pay_date, "to": pay_date}).json()
    totals = deductions["totals"]
    assert [line["taxCode"] for line in totals["taxes"]][:3] == ["fit", "ss", "medicare"]
    assert [line["label"] for line in totals["other"]] == ["Health insurance"]
    assert totals["deductionsCents"] == stub["totals"]["deductionsCents"]
    assert totals["netCents"] == stub["totals"]["netCents"]
    assert totals["taxesCents"] + totals["otherCents"] == totals["deductionsCents"]

    # Outside the range: nothing.
    empty = client.get("/v1/reports/earnings", headers=auth, params={"from": "2020-01-01", "to": "2020-12-31"}).json()
    assert empty["stubCount"] == 0
    assert empty["workers"] == []
    assert empty["totals"]["grossCents"] == 0


def test_reports_download_as_csv(client: TestClient, auth: dict[str, str]) -> None:
    made = seed(client, auth)
    pay_date = made["stub"]["payDate"]
    response = client.get(
        "/v1/reports/earnings", headers=auth, params={"from": pay_date, "to": pay_date, "format": "csv"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.text.splitlines()[1] == "Worker,Pay,Hours,Amount"
    deductions = client.get(
        "/v1/reports/deductions", headers=auth, params={"from": pay_date, "to": pay_date, "format": "csv"}
    )
    assert "Social Security,Tax" in deductions.text


def test_reports_only_show_your_own_stubs_and_check_dates(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    made = seed(client, auth)
    pay_date = made["stub"]["payDate"]
    seed(client, other, "Someone Else")
    mine = client.get("/v1/reports/earnings", headers=auth, params={"from": pay_date, "to": pay_date}).json()
    assert mine["stubCount"] == 1
    bad = client.get("/v1/reports/earnings", headers=auth, params={"from": "2026-12-31", "to": "2026-01-01"})
    assert bad.status_code == 400
    assert (
        client.get("/v1/reports/earnings", headers=auth, params={"from": "nope", "to": "2026-01-01"}).status_code == 400
    )
    assert client.get("/v1/reports/earnings", params={"from": pay_date, "to": pay_date}).status_code == 401
