"""Tax settings: every figure for federal tax or one state, as the app shows it."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _items(body: dict, title: str) -> list[dict]:
    return next(section for section in body["sections"] if section["title"] == title)["items"]


def _value(items: list[dict], label: str) -> str:
    return next(item["value"] for item in items if item.get("label") == label)


def test_federal_figures(client: TestClient) -> None:
    body = client.get("/v1/meta/tax-rules", params={"jurisdiction": "US", "year": 2026}).json()
    assert body["name"] == "Federal"
    assert [section["title"] for section in body["sections"]] == ["Federal income tax", "Social Security", "Medicare"]
    social = _items(body, "Social Security")
    assert _value(social, "Rate") == "6.2%"
    assert _value(social, "Wage base, yearly") == "$184,500"
    medicare = _items(body, "Medicare")
    assert _value(medicare, "Additional tax on yearly wages over") == "$200,000"
    tables = [item for item in _items(body, "Federal income tax") if item["type"] == "table"]
    assert len(tables) == 6  # three statuses, standard and step 2 box checked
    assert tables[0]["columns"] == ["Yearly wages over", "Tax", "Plus %"]


def test_state_figures_read_as_money_and_rates(client: TestClient) -> None:
    body = client.get("/v1/meta/tax-rules", params={"jurisdiction": "il", "year": 2026}).json()
    assert body["jurisdiction"] == "IL" and body["name"] == "Illinois"
    income = _items(body, "State income tax")
    assert _value(income, "Rate") == "4.95%"
    assert _value(income, "Amount per · Line 1 allowances") == "$2,925"

    ca = client.get("/v1/meta/tax-rules", params={"jurisdiction": "CA", "year": 2026}).json()
    assert [section["title"] for section in ca["sections"]] == ["State income tax", "Disability insurance"]
    assert _value(_items(ca, "Disability insurance"), "Rate") == "1.3%"
    brackets = next(item for item in _items(ca, "State income tax") if item["type"] == "table")
    assert brackets["columns"] == ["Wages over", "Rate", "Plus"]
    assert brackets["rows"][0] == ["$0", "1.1%", "$0"]


def test_places_and_states_without_a_tax(client: TestClient) -> None:
    pa = client.get("/v1/meta/tax-rules", params={"jurisdiction": "PA", "year": 2026}).json()
    local = _items(pa, "County and city taxes")
    assert local[0]["columns"] == ["Place", "Rate"]
    assert any(row[0].startswith("Philadelphia") for row in local[0]["rows"])
    # Philadelphia's rate changed on July 1: the earlier one is listed under its own heading.
    assert any(item["type"] == "heading" for item in local)

    tx = client.get("/v1/meta/tax-rules", params={"jurisdiction": "TX", "year": 2026}).json()
    assert tx["sections"][0]["status"] == "none"


def test_unknown_jurisdiction_or_year(client: TestClient) -> None:
    assert client.get("/v1/meta/tax-rules", params={"jurisdiction": "ZZ"}).status_code == 400
    assert client.get("/v1/meta/tax-rules", params={"jurisdiction": "US", "year": 1999}).status_code == 404
    assert client.get("/v1/meta/tax-rules", params={"jurisdiction": "CA", "year": 1999}).status_code == 404
    assert client.get("/v1/meta/tax-rules").status_code == 200
