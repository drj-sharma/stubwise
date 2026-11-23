from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import API_VERSION, MIN_APP_VERSION
from ..db import get_session
from ..domain.tax.data import FEDERAL_DATA
from ..domain.tax.state import state_tax_support
from ..domain.us_states import US_STATES, is_us_state_code
from ..errors import ApiError
from ..filing import CONSENT_VERSION
from ..filing_schemas import SUPPORTED_TAX_YEARS
from ..schemas import TEMPLATES
from ..services.tax_view import federal_view, state_view
from ..tax_rules.store import RULES

router = APIRouter(tags=["Service"])


@router.get("/health", summary="Liveness: the process is up")
def health() -> dict[str, str]:
    return {"status": "ok", "version": API_VERSION}


@router.get("/ready", summary="Readiness: the database answers")
def ready(db: Session = Depends(get_session)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise ApiError(503, "not_ready", "The database is not reachable.") from None
    return {"status": "ready"}


@router.get("/v1/meta", summary="Versions, templates and which sign-in providers are on")
def meta(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    verifier = request.app.state.identity
    return {
        "version": API_VERSION,
        "minAppVersion": MIN_APP_VERSION,
        "templates": TEMPLATES,
        "signIn": {
            "google": verifier.enabled("google"),
            "apple": verifier.enabled("apple"),
            "password": settings.password_login_enabled,
        },
        "filing": {
            "available": settings.filing_active,
            "consentVersion": CONSENT_VERSION,
            "formTypes": ["W2", "1099NEC"],
            "taxYears": list(SUPPORTED_TAX_YEARS),
        },
    }


@router.get("/v1/meta/tax-coverage", summary="Which tax years and states are calculated, and what each asks for")
def tax_coverage(db: Session = Depends(get_session)) -> dict[str, Any]:
    """For each tax year, how every state is handled, from the tax_rules table.

    ``support`` is the state income tax: ``none`` (the state does not tax
    wages), ``calculated`` (worked out by the server) or ``manual`` (the
    employer types it). ``taxes`` lists every tax the state has on wages, with
    its method. ``certificate`` describes the state's withholding form: its
    name and the fields to ask the worker for (see StateW4). ``localities``
    lists the counties or cities a worker can owe local tax to, when the state
    has a calculated local tax.
    """
    years = sorted(set(FEDERAL_DATA) | set(RULES.years(db)))
    coverage = []
    for year in years:
        by_state = RULES.all_for_year(db, year)
        states = {}
        for state in US_STATES:
            code = state["code"]
            rules = by_state.get(code, [])
            entry: dict[str, Any] = {
                "name": state["name"],
                "support": state_tax_support(rules) if rules else "manual",
                "taxes": [{"tax": rule["tax"], "method": rule["method"]} for rule in rules],
            }
            income = next((rule for rule in rules if rule["tax"] == "income"), None)
            if income and income["method"] == "state":
                entry["certificate"] = income["params"].get("certificate")
                entry["source"] = income["source"]
            local = next((rule for rule in rules if rule["tax"] == "local" and rule["method"] == "local_rate"), None)
            if local:
                entry["localities"] = {
                    "choose": local["params"].get("choose", "Locality"),
                    "options": [
                        {"code": key, "name": place["name"]}
                        for key, place in local["params"].get("localities", {}).items()
                    ],
                }
            if income and income["method"] == "state" and income["params"].get("localities"):
                entry["localities"] = income["params"]["localities"]
            states[code] = entry
        coverage.append({"year": year, "federal": year in FEDERAL_DATA, "states": states})
    return {"years": coverage}


@router.get("/v1/meta/tax-rules", summary="Every figure used for federal tax or one state, laid out to read")
def tax_rules(jurisdiction: str = "US", year: int | None = None, db: Session = Depends(get_session)) -> dict[str, Any]:
    """``jurisdiction`` is ``US`` for federal or a state code. ``year`` defaults to the latest loaded."""
    code = jurisdiction.upper()
    years = sorted(set(FEDERAL_DATA) | set(RULES.years(db)))
    if year is None and years:
        this_year = date.today().year
        year = this_year if this_year in years else years[-1]
    if code == "US":
        data = FEDERAL_DATA.get(year) if year is not None else None
        if not data:
            raise ApiError(404, "not_found", "No federal figures for that year.")
        return federal_view(year, data)  # type: ignore[arg-type]
    if not is_us_state_code(code):
        raise ApiError(
            400,
            "invalid_request",
            "The request is not valid.",
            [{"path": "jurisdiction", "message": "must be US or a state code"}],
        )
    rules = RULES.for_state(db, year, code) if year is not None else []
    if not rules:
        raise ApiError(404, "not_found", "No rules for that state and year.")
    return state_view(year, code, rules)  # type: ignore[arg-type]
