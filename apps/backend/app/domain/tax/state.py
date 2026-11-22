"""Port of packages/domain/src/tax/state.ts."""

from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict

from ..money import Cents, div_round_half_up
from .data import KNOWN_STATE_RULE_KINDS, NO_WAGE_INCOME_TAX_STATES, STATE_RULES
from .types import DEFAULT_STATE_W4, W4, StateW4

_NO_WAGE_INCOME_TAX = frozenset(NO_WAGE_INCOME_TAX_STATES)


class StateTaxResult(TypedDict):
    """``none``: the state does not tax wages. ``manual``: it does, but its formula
    has not been added yet, so the figure is typed by hand. ``amount``: ``cents`` is set."""

    kind: Literal["none", "manual", "amount"]
    cents: NotRequired[Cents]


def state_income_tax(
    *,
    state: str,
    year: int,
    wages_cents: Cents,
    periods_per_year: int,
    w4: W4,
    state_w4: StateW4 | None = None,
) -> StateTaxResult:
    """State income tax to withhold for one pay period.

    A state is only calculated once its rule has been added to the TypeScript
    data and tested against that state's own withholding guide; until then it
    reports ``manual``. ``w4`` is the federal form: states with no filing
    status of their own use its status to pick the standard deduction.

    The one rule kind so far, ``flat``, is a single rate on annual wages after
    a standard deduction and allowances, divided back to the pay period.
    """
    if state in _NO_WAGE_INCOME_TAX:
        return {"kind": "none"}
    rule = STATE_RULES.get(year, {}).get(state)
    if not rule:
        return {"kind": "manual"}
    if rule["kind"] not in KNOWN_STATE_RULE_KINDS:  # also checked when the data is loaded
        raise ValueError(f"Unknown state rule kind {rule['kind']!r} for {state} {year}")
    if state_w4 is None:
        state_w4 = DEFAULT_STATE_W4
    if state_w4["exempt"]:
        return {"kind": "amount", "cents": 0}

    annual_wages = max(0, wages_cents) * periods_per_year
    subtract = (
        (rule.get("standardDeductionCents") or {}).get(w4["filingStatus"], 0)
        + state_w4["allowances"] * rule.get("allowanceCents", 0)
        + state_w4["additionalAllowances"] * rule.get("additionalAllowanceCents", 0)
    )
    taxable = max(0, annual_wages - subtract)
    # One division at the end, so nothing is lost to rounding along the way.
    if rule["round"] == "dollar":
        per_period = div_round_half_up(taxable * rule["rateBasisPoints"], 10_000 * periods_per_year * 100) * 100
    else:
        per_period = div_round_half_up(taxable * rule["rateBasisPoints"], 10_000 * periods_per_year)
    # Nothing is withheld on a pay period with no pay, extra amount included.
    return {"kind": "amount", "cents": per_period + state_w4["extraWithholdingCents"] if wages_cents > 0 else 0}


def state_rule(state: str, year: int) -> dict[str, Any] | None:
    """The rule applied for a state and year, when that state is calculated."""
    return STATE_RULES.get(year, {}).get(state)


def state_tax_support(state: str, year: int) -> Literal["none", "manual", "calculated"]:
    """How each state is handled for a year, for showing people what to expect."""
    if state in _NO_WAGE_INCOME_TAX:
        return "none"
    return "calculated" if STATE_RULES.get(year, {}).get(state) else "manual"
