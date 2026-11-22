"""The stateless calculation endpoints, checked against the same TypeScript-generated cases as the port itself."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from .test_parity import VECTORS


def with_tax_code(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in line.items() if not (key == "taxCode" and value is None)} for line in lines]


def test_stub_totals_match_the_vectors(client: TestClient, auth: dict[str, str]) -> None:
    for case in VECTORS["stubTotals"][:20]:
        stale = [{**line, "amountCents": 1} if line["minutes"] is not None else line for line in case["lines"]]
        body = client.post("/v1/calc/stub", headers=auth, json={"lines": stale}).json()
        assert body["totals"] == case["expected"]
        assert [line["amountCents"] for line in body["lines"]] == case["lineAmounts"]


def test_taxes_match_the_vectors(client: TestClient, auth: dict[str, str]) -> None:
    checked = 0
    for case in VECTORS["taxLines"]:
        response = client.post(
            "/v1/calc/taxes", headers=auth, json={"lines": case["input"], "context": case["context"]}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert with_tax_code(body["lines"]) == case["expected"]["lines"]
        assert body["status"] == case["expected"]["status"]
        checked += 1
    assert checked == len(VECTORS["taxLines"]) >= 120


def test_ytd_matches_the_vectors(client: TestClient, auth: dict[str, str]) -> None:
    for case in VECTORS["ytd"]:
        target = next(stub for stub in case["stubs"] if stub["id"] == case["targetId"])
        request = {"stub": target, "workerStubs": case["stubs"], "startingYtd": case["startingYtd"]}
        response = client.post("/v1/calc/ytd", headers=auth, json=request)
        assert response.status_code == 200, response.text
        assert response.json() == case["expected"]
        assert list(response.json()["byLine"]) == list(case["expected"]["byLine"])  # same order too


def test_next_stub_matches_the_vectors(client: TestClient, auth: dict[str, str]) -> None:
    for case in VECTORS["nextStub"]:
        common = {"schedule": case["schedule"], "today": case["today"], "overtimeMultiplierPct": case["overtimePct"]}
        first = client.post("/v1/calc/next-stub", headers=auth, json={**common, "worker": case["worker"]}).json()
        assert {key: first[key] for key in ("period", "payDate")} == {
            key: case["first"][key] for key in ("period", "payDate")
        }
        assert with_tax_code(first["lines"]) == case["first"]["lines"]

        request = {**common, "worker": case["changedRate"], "previous": case["previous"]}
        second = client.post("/v1/calc/next-stub", headers=auth, json=request)
        assert second.status_code == 200, second.text
        assert with_tax_code(second.json()["lines"]) == case["second"]["lines"]
        assert second.json()["payDate"] == case["second"]["payDate"]
        assert "totals" in second.json()


def test_pay_period_matches_the_vectors(client: TestClient, auth: dict[str, str]) -> None:
    for case in VECTORS["periods"]:
        body = client.post(
            "/v1/calc/pay-period", headers=auth, json={"schedule": case["schedule"], "today": case["today"]}
        ).json()
        assert body["containing"] == body["current"] == case["containing"]
        assert body["next"] == case["next"]
        assert body["defaultPayDate"] == case["defaultPayDate"]

        later = {"schedule": case["schedule"], "today": case["laterToday"], "latest": case["containing"]}
        assert (
            client.post("/v1/calc/pay-period", headers=auth, json=later).json()["current"] == case["currentAfterLatest"]
        )


def test_calculations_need_sign_in_and_valid_input(client: TestClient, auth: dict[str, str]) -> None:
    assert client.post("/v1/calc/stub", json={"lines": []}).status_code == 401
    bad = client.post("/v1/calc/pay-period", headers=auth, json={"schedule": "daily", "today": "2026-02-30"})
    assert bad.status_code == 400
    assert {detail["path"] for detail in bad.json()["error"]["details"]} == {"schedule", "today"}
    context = {**VECTORS["taxLines"][0]["context"], "priorYtdGrossCents": -1}
    assert client.post("/v1/calc/taxes", headers=auth, json={"lines": [], "context": context}).status_code == 400


def test_tax_coverage_lists_every_state(client: TestClient) -> None:
    body = client.get("/v1/meta/tax-coverage").json()
    assert [entry["year"] for entry in body["years"]] == [2026]
    year = body["years"][0]
    assert year["federal"] is True
    states = year["states"]
    assert len(states) == 51
    assert states["TN"] == {"name": "Tennessee", "support": "none"}
    assert states["CA"] == {"name": "California", "support": "manual"}
    assert states["PA"]["support"] == "calculated"
    assert states["PA"]["certificate"] is None
    assert states["IL"]["certificate"] == {
        "form": "IL-W-4",
        "allowances": "Line 1 allowances",
        "additionalAllowances": "Line 2 allowances",
    }
    assert states["NC"]["certificate"] == {"form": "NC-4", "allowances": "Allowances"}
    assert states["IL"]["source"].startswith("https://tax.illinois.gov/")
    calculated = sorted(code for code, entry in states.items() if entry["support"] == "calculated")
    # Whatever the data file holds, not a list kept here: adding a state to the data must not need a code change.
    from app.domain.tax.data import STATE_RULES

    assert calculated == sorted(STATE_RULES[2026])
    assert set(body["noWageIncomeTaxStates"]) == {c for c, e in states.items() if e["support"] == "none"}
