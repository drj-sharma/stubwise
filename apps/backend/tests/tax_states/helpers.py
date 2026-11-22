"""Runs one state's seeded rules for a pay period, the way a stub would.

Use in tests/tax_states/test_<state>.py:

    from .helpers import withhold
    lines = withhold("IL", 2026, wages_cents=200_000, periods=26, cert={"allowances": 1})
    assert lines["sit"] == 8_758

``lines`` maps each tax code on the stub (``sit``, ``sdi``, ``local:XYZ``, ...)
to its cents; a tax the employer types appears with the value ``"typed"``.
"""

from __future__ import annotations

from typing import Any

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4
from app.tax_rules.store import seed_files

_SEED = seed_files()


def rules_for(state: str, year: int) -> list[dict[str, Any]]:
    return [dict(rule) for rule in _SEED if rule["jurisdiction"] == state and rule["year"] == year]


def withhold(
    state: str,
    year: int,
    *,
    wages_cents: int,
    periods: int,
    w4: dict[str, Any] | None = None,
    cert: dict[str, Any] | None = None,
    federal_tax_cents: int = 0,
    prior_ytd_wages_cents: int = 0,
    fica_cents: int = 0,
) -> dict[str, Any]:
    inp = StateInput(
        year=year,
        wages_cents=wages_cents,
        periods_per_year=periods,
        w4={**DEFAULT_W4, **(w4 or {})},  # type: ignore[typeddict-item]
        cert={**DEFAULT_STATE_W4, **(cert or {})},  # type: ignore[typeddict-item]
        federal_tax_cents=federal_tax_cents,
        prior_ytd_wages_cents=prior_ytd_wages_cents,
        fica_cents=fica_cents,
    )
    return {
        line["code"]: "typed" if line["typed"] else line["cents"]
        for line in state_taxes(rules_for(state, year), state, inp)
    }
