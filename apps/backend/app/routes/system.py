from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import API_VERSION, MIN_APP_VERSION
from ..db import get_session
from ..domain.tax.data import FEDERAL_DATA, NO_WAGE_INCOME_TAX_STATES, STATE_RULES
from ..domain.tax.state import state_rule, state_tax_support
from ..domain.us_states import US_STATES
from ..errors import ApiError
from ..filing import CONSENT_VERSION
from ..filing_schemas import SUPPORTED_TAX_YEARS
from ..schemas import TEMPLATES

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


@router.get("/v1/meta/tax-coverage", summary="Which tax years and states are calculated")
def tax_coverage() -> dict[str, Any]:
    """For each loaded tax year, how every state is handled.

    `none`: the state does not tax wages. `calculated`: worked out by the
    server and the app. `manual`: the state taxes wages but its formula has not
    been added, so the employer types the figure. For a calculated state,
    `certificate` names the state's withholding form and what its allowance
    lines are called, when it has one.
    """
    years = sorted(set(FEDERAL_DATA) | set(STATE_RULES))
    coverage = []
    for year in years:
        states = {}
        for state in US_STATES:
            code = state["code"]
            entry: dict[str, Any] = {"name": state["name"], "support": state_tax_support(code, year)}
            rule = state_rule(code, year)
            if entry["support"] == "calculated" and rule:
                entry["certificate"] = rule.get("certificate")
                entry["source"] = rule.get("source")
            states[code] = entry
        coverage.append({"year": year, "federal": year in FEDERAL_DATA, "states": states})
    return {"years": coverage, "noWageIncomeTaxStates": list(NO_WAGE_INCOME_TAX_STATES)}
