"""Port of packages/domain/src/tax/applyTaxes.ts."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, NotRequired, TypedDict

from ..calc_stub import StubLine, calc_stub, is_supplemental_line
from ..money import Cents
from ..pay_period import PaySchedule
from ..us_states import us_state_name
from .data import PAY_PERIODS_PER_YEAR
from .federal import (
    federal_income_tax,
    federal_tax_data,
    medicare_tax,
    social_security_tax,
    supplemental_income_tax,
)
from .state import calculated_codes, state_taxes
from .states._common import StateInput
from .types import DEFAULT_STATE_W4, TaxProfile

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
    stateRules: list[dict[str, Any]]
    """The tax_rules rows for the work state and the pay date's year (empty: that year is not loaded)."""
    payDate: NotRequired[str | None]
    """The stub's pay date: picks the figures in force when a state changed them mid-year."""


class TaxedLines(TypedDict):
    lines: list[StubLine]
    status: TaxStatus


def work_state(profile: TaxProfile | None, business_state: str | None) -> str | None:
    """Where the work is done: the worker's own state, or the business's."""
    if profile and profile["state"] is not None:
        return profile["state"]
    return business_state


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
    # Bonus and commission lines marked supplemental are withheld on at the flat federal rate;
    # the rest of the pay goes through the percentage method on its own.
    supplemental_wages = calc_stub([line for line in earnings if is_supplemental_line(line)])["grossCents"]
    periods = PAY_PERIODS_PER_YEAR[context["schedule"]]
    prior = context["priorYtdGrossCents"]
    w4 = profile["w4"]

    fit = federal_income_tax(
        data=data, wages_cents=wages - supplemental_wages, periods_per_year=periods, w4=w4
    ) + supplemental_income_tax(data=data, wages_cents=supplemental_wages, w4=w4)
    ss = social_security_tax(data=data, wages_cents=wages, prior_ytd_wages_cents=prior)
    medicare = medicare_tax(data=data, wages_cents=wages, prior_ytd_wages_cents=prior)
    # (tax code, label, amount, typed by hand)
    computed: list[tuple[str, str, Cents, bool]] = [
        ("fit", TAX_LABELS["fit"], fit, False),
        ("ss", TAX_LABELS["ss"], ss, False),
        ("medicare", TAX_LABELS["medicare"], medicare, False),
    ]

    state = work_state(profile, context["businessState"])
    if state:
        inp = StateInput(
            year=context["year"],
            wages_cents=wages,
            periods_per_year=periods,
            w4=w4,
            cert={**DEFAULT_STATE_W4, **(profile.get("stateW4") or {})},
            federal_tax_cents=fit,
            prior_ytd_wages_cents=prior,
            fica_cents=ss + medicare,
            pay_date=context.get("payDate"),
        )
        for line in state_taxes(context.get("stateRules") or [], state, inp):
            computed.append((line["code"], line["label"], line["cents"], line["typed"]))

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


def supplemental_notes(lines: Sequence[StubLine], context: TaxContext) -> list[str]:
    """What to tell the employer about supplemental (bonus) pay on a stub.

    Only federal income tax has a flat supplemental rate in the tax data, so a
    state's income tax is worked out on the whole gross pay by its usual formula.
    """
    profile = context["profile"]
    if not profile or not profile["calculate"] or not federal_tax_data(context["year"]):
        return []
    if not any(is_supplemental_line(line) for line in lines):
        return []
    notes = ["Bonus pay: federal income tax is withheld on it at the flat supplemental rate."]
    state = work_state(profile, context["businessState"])
    income = next((rule for rule in context.get("stateRules") or [] if rule["tax"] == "income"), None)
    if state and income and income["method"] != "none":
        notes.append(
            f"{us_state_name(state)} has no separate bonus rate in the app's tax data, "
            "so state income tax is worked out on the whole gross pay as usual."
        )
    return notes


def is_tax_override(
    line: StubLine, *, profile: TaxProfile | None, year: int, state_rules: list[dict[str, Any]]
) -> bool:
    """True when the user typed over a figure that would otherwise be calculated."""
    code = line.get("taxCode")
    if not code or line["source"] != "manual":
        return False
    if not profile or not profile["calculate"] or not federal_tax_data(year):
        return False
    return code in ("fit", "ss", "medicare") or code in calculated_codes(state_rules)
