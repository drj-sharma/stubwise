"""Port of packages/domain/src/tax/applyTaxes.ts."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, TypedDict

from ..calc_stub import StubLine, calc_stub
from ..money import Cents
from ..pay_period import PaySchedule
from ..us_states import us_state_name
from .data import PAY_PERIODS_PER_YEAR
from .federal import federal_income_tax, federal_tax_data, medicare_tax, social_security_tax
from .state import state_income_tax
from .types import TaxProfile

TAX_LABELS = {"fit": "Federal income tax", "ss": "Social Security", "medicare": "Medicare"}

TaxStatus = Literal["calculated", "off", "no-data-for-year"]
"""``calculated``: tax lines are up to date. ``off``: contractor, or calculation turned
off for this worker. ``no-data-for-year``: the pay date is in a year with no tables."""


class TaxContext(TypedDict):
    profile: TaxProfile | None
    """None for contractors: no tax lines at all."""
    businessState: str | None
    """Used when the worker has no state of their own."""
    year: int
    """The calendar year of the pay date."""
    schedule: PaySchedule
    priorYtdGrossCents: Cents
    """Gross pay this calendar year before this stub, including pay entered as "before the app"."""


class TaxedLines(TypedDict):
    lines: list[StubLine]
    status: TaxStatus


def state_tax_label(state: str) -> str:
    return f"{us_state_name(state)} income tax"


def apply_taxes(lines: Sequence[StubLine], context: TaxContext) -> TaxedLines:
    """Brings a stub's tax lines in step with its earnings.

    A tax line is a deduction with a ``taxCode``. Lines worked out here have
    source ``calculated`` and are replaced on every call; a line the user typed
    over has source ``manual`` and is left exactly as typed. Everything that is
    not a tax line is returned untouched and in the same order, with the tax
    lines placed first among the deductions.
    """
    earnings = [line for line in lines if line["kind"] == "earning"]
    other_deductions = [line for line in lines if line["kind"] == "deduction" and not line.get("taxCode")]
    # Like a JavaScript Map: a repeated code keeps its first position and its last value.
    overrides: dict[str, StubLine] = {}
    for line in lines:
        if line["kind"] == "deduction" and line.get("taxCode") and line["source"] == "manual":
            overrides[line["taxCode"]] = line  # type: ignore[index]

    def keep_typed(status: TaxStatus) -> TaxedLines:
        return {"lines": [*earnings, *overrides.values(), *other_deductions], "status": status}

    profile = context["profile"]
    if not profile or not profile["calculate"]:
        return keep_typed("off")
    data = federal_tax_data(context["year"])
    if not data:
        return keep_typed("no-data-for-year")

    # Taxable wages are gross pay: pre-tax deductions are not modelled yet.
    wages = calc_stub(earnings)["grossCents"]
    periods = PAY_PERIODS_PER_YEAR[context["schedule"]]
    prior = context["priorYtdGrossCents"]
    w4 = profile["w4"]

    fit = federal_income_tax(data=data, wages_cents=wages, periods_per_year=periods, w4=w4)
    ss = social_security_tax(data=data, wages_cents=wages, prior_ytd_wages_cents=prior)
    medicare = medicare_tax(data=data, wages_cents=wages, prior_ytd_wages_cents=prior)
    # (tax code, label, amount, typed by hand)
    computed: list[tuple[str, str, Cents, bool]] = [
        ("fit", TAX_LABELS["fit"], fit, False),
        ("ss", TAX_LABELS["ss"], ss, False),
        ("medicare", TAX_LABELS["medicare"], medicare, False),
    ]

    state = profile["state"] if profile["state"] is not None else context["businessState"]
    if state:
        result = state_income_tax(
            state=state,
            year=context["year"],
            wages_cents=wages,
            periods_per_year=periods,
            w4=w4,
            state_w4=profile.get("stateW4"),
        )
        if result["kind"] == "amount":
            computed.append(("sit", state_tax_label(state), result["cents"], False))
        elif result["kind"] == "manual":
            # Not calculated yet for this state: leave a line for the employer to type the figure into.
            computed.append(("sit", state_tax_label(state), 0, True))

    tax_lines: list[StubLine] = []
    for tax_code, label, amount, typed in computed:
        override = overrides.pop(tax_code, None)
        tax_lines.append(
            override
            or {
                "kind": "deduction",
                "label": label,
                "minutes": None,
                "rateCents": None,
                "amountCents": amount,
                "source": "manual" if typed else "calculated",
                "taxCode": tax_code,  # type: ignore[typeddict-item]
            }
        )
    # A typed tax line with no computed figure (state tax in a no-tax state, say) stays as typed.
    return {"lines": [*earnings, *tax_lines, *overrides.values(), *other_deductions], "status": "calculated"}


def is_tax_override(line: StubLine, *, profile: TaxProfile | None, business_state: str | None, year: int) -> bool:
    """True when the user typed over a figure that would otherwise be calculated."""
    if not line.get("taxCode") or line["source"] != "manual":
        return False
    if not profile or not profile["calculate"] or not federal_tax_data(year):
        return False
    if line.get("taxCode") != "sit":
        return True
    state = profile["state"] if profile["state"] is not None else business_state
    if state is None:
        return False
    result = state_income_tax(state=state, year=year, wages_cents=0, periods_per_year=1, w4=profile["w4"])
    return result["kind"] == "amount"
