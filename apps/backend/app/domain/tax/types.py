"""Port of packages/domain/src/tax/types.ts."""

from __future__ import annotations

from typing import Any, Literal, TypedDict, get_args

from ..calc_stub import TaxCode
from ..money import Cents, is_integer, is_safe_integer
from ..us_states import is_us_state_code

FilingStatus = Literal["single", "married", "head"]
"""Step 1(c) of Form W-4. "single" also covers married filing separately."""

TAX_CODES: tuple[TaxCode, ...] = get_args(TaxCode)


class W4(TypedDict):
    """What an employee wrote on a 2020-or-later Form W-4."""

    filingStatus: FilingStatus
    multipleJobs: bool
    """Step 2(c) checkbox: two jobs, or married and both work."""
    dependentsCents: Cents
    """Step 3: the dollar total claimed for dependents and other credits, per year."""
    otherIncomeCents: Cents
    """Step 4(a), per year."""
    deductionsCents: Cents
    """Step 4(b), per year."""
    extraWithholdingCents: Cents
    """Step 4(c), per pay period."""
    exempt: bool
    """Claimed exempt from federal income tax withholding. Social Security and Medicare still apply."""


class StateW4(TypedDict, total=False):
    """What an employee wrote on their state's withholding certificate.

    States name these lines differently; each state's rule (its ``certificate``
    in the tax_rules params) says which it asks for and what they are called.
    """

    allowances: int
    additionalAllowances: int
    """A second kind of allowance, on certificates that have one (Illinois Line 2)."""
    dependents: int
    """Dependents claimed, on certificates that count them separately."""
    status: str | None
    """The certificate's own filing status code, for states that have one; None uses the federal W-4's."""
    localities: list[str]
    """County, city or school district codes the worker owes local tax to (see the state's local rule)."""
    options: dict[str, Any]
    """Answers particular to one state's certificate (Arizona's chosen percentage, say)."""
    extraWithholdingCents: Cents
    """Extra state withholding, per pay period."""
    exempt: bool
    """Claimed exempt from state income tax withholding."""


class TaxProfile(TypedDict):
    """A worker's tax settings. Contractors (1099) have none: nothing is withheld from them."""

    calculate: bool
    """Off means no tax lines are added; anything on the stub is typed by hand."""
    w4: W4
    state: str | None
    """Where the work is done. None falls back to the business's state."""
    stateW4: StateW4
    """Answers from the work state's own withholding certificate, where it has one."""


# The IRS rule for an employee who gives no Form W-4: withhold as a single filer
# with no other entries (Pub. 15-T, "New employee fails to furnish Form W-4").
DEFAULT_W4: W4 = {
    "filingStatus": "single",
    "multipleJobs": False,
    "dependentsCents": 0,
    "otherIncomeCents": 0,
    "deductionsCents": 0,
    "extraWithholdingCents": 0,
    "exempt": False,
}
# With no state certificate on file: no allowances, nothing extra.
DEFAULT_STATE_W4: StateW4 = {
    "allowances": 0,
    "additionalAllowances": 0,
    "dependents": 0,
    "status": None,
    "localities": [],
    "options": {},
    "extraWithholdingCents": 0,
    "exempt": False,
}
DEFAULT_TAX_PROFILE: TaxProfile = {
    "calculate": True,
    "w4": DEFAULT_W4,
    "state": None,
    "stateW4": DEFAULT_STATE_W4,
}


def is_tax_code(value: object) -> bool:
    return isinstance(value, str) and value in TAX_CODES


def _cents_or_zero(value: object) -> Cents:
    return value if is_safe_integer(value) and value >= 0 else 0  # type: ignore[operator, return-value]


def _count(value: object) -> int:
    return value if is_integer(value) and 0 <= value <= 99 else 0  # type: ignore[operator, return-value]


def _code(value: object) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= 20 else None


def _state_w4(value: dict[str, Any]) -> StateW4:
    localities = value.get("localities")
    options = value.get("options")
    return {
        "allowances": _count(value.get("allowances")),
        "additionalAllowances": _count(value.get("additionalAllowances")),
        "dependents": _count(value.get("dependents")),
        "status": _code(value.get("status")),
        "localities": [code for code in localities if _code(code)][:4] if isinstance(localities, list) else [],
        "options": {
            key: item
            for key, item in options.items()
            if isinstance(key, str) and len(key) <= 30 and isinstance(item, str | int | bool) and len(str(item)) <= 30
        }
        if isinstance(options, dict)
        else {},
        "extraWithholdingCents": _cents_or_zero(value.get("extraWithholdingCents")),
        "exempt": value.get("exempt") is True,
    }


def normalize_tax_profile(value: Any) -> TaxProfile:
    """Reads a stored tax profile, falling back to the defaults for anything missing or malformed."""
    if not isinstance(value, dict):
        return {"calculate": True, "w4": {**DEFAULT_W4}, "state": None, "stateW4": _state_w4({})}
    w4 = value.get("w4") if isinstance(value.get("w4"), dict) else {}
    state_w4 = value.get("stateW4") if isinstance(value.get("stateW4"), dict) else {}
    status = w4.get("filingStatus")
    state = value.get("state")
    return {
        "calculate": value.get("calculate") is not False,
        "state": state if is_us_state_code(state) else None,
        "stateW4": _state_w4(state_w4),
        "w4": {
            "filingStatus": status if status in ("married", "head") else "single",
            "multipleJobs": w4.get("multipleJobs") is True,
            "dependentsCents": _cents_or_zero(w4.get("dependentsCents")),
            "otherIncomeCents": _cents_or_zero(w4.get("otherIncomeCents")),
            "deductionsCents": _cents_or_zero(w4.get("deductionsCents")),
            "extraWithholdingCents": _cents_or_zero(w4.get("extraWithholdingCents")),
            "exempt": w4.get("exempt") is True,
        },
    }
