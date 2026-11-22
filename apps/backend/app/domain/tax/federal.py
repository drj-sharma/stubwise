"""Port of packages/domain/src/tax/federal.ts.

Federal tax data is the dict loaded from tax-data.json. A bracket row is
``[at least (whole dollars), tentative amount (cents), percent of the excess]``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ..money import Cents, assert_cents, div_round_half_up
from .data import FEDERAL_DATA
from .types import W4

FederalTaxData = dict[str, Any]
BracketRow = Sequence[int]


def federal_tax_data(year: int) -> FederalTaxData | None:
    """The federal figures for a tax year, or None when that year has not been added yet."""
    return FEDERAL_DATA.get(year)


def federal_income_tax(*, data: FederalTaxData, wages_cents: Cents, periods_per_year: int, w4: W4) -> Cents:
    """Federal income tax to withhold for one pay period.

    The percentage method for automated payroll systems (Pub. 15-T, Worksheet
    1A) for a 2020-or-later Form W-4. Line numbers in the comments are the
    worksheet's. Amounts are carried in cents and rounded half up to the cent
    at each division, which is finer than the whole-dollar rounding the IRS permits.
    """
    assert_cents(wages_cents)
    if w4["exempt"] or wages_cents <= 0:
        return 0

    status = w4["filingStatus"]
    annual_wages = wages_cents * periods_per_year  # 1c
    with_other_income = annual_wages + w4["otherIncomeCents"]  # 1e
    standard_adjustment = 0 if w4["multipleJobs"] else data["standardAdjustmentCents"][status]  # 1g
    adjusted_annual_wage = max(0, with_other_income - (w4["deductionsCents"] + standard_adjustment))  # 1i

    table = (data["step2Checkbox"] if w4["multipleJobs"] else data["standard"])[status]
    annual_tax = tax_from_brackets(table, adjusted_annual_wage)  # 2g
    tentative = div_round_half_up(annual_tax, periods_per_year)  # 2h
    credit = div_round_half_up(w4["dependentsCents"], periods_per_year)  # 3b
    return max(0, tentative - credit) + w4["extraWithholdingCents"]  # 3c + 4a


def tax_from_brackets(table: Sequence[BracketRow], amount_cents: Cents) -> Cents:
    """Lines 2b-2g: the row whose "at least" amount is the highest one not above the wage."""
    if not table:
        return 0
    row = table[0]
    for candidate in table:
        if amount_cents >= candidate[0] * 100:
            row = candidate
    at_least_dollars, base_cents, percent = row
    return base_cents + div_round_half_up((amount_cents - at_least_dollars * 100) * percent, 100)


def social_security_tax(*, data: FederalTaxData, wages_cents: Cents, prior_ytd_wages_cents: Cents) -> Cents:
    """Employee Social Security tax for one pay period.

    The rate on wages, until wages for the calendar year reach the wage base.
    """
    rate = data["socialSecurity"]["rateBasisPoints"]
    room = max(0, data["socialSecurity"]["wageBaseCents"] - max(0, prior_ytd_wages_cents))
    taxable = min(max(0, wages_cents), room)
    return div_round_half_up(taxable * rate, 10_000)


def medicare_tax(*, data: FederalTaxData, wages_cents: Cents, prior_ytd_wages_cents: Cents) -> Cents:
    """Employee Medicare tax for one pay period.

    The regular rate on all wages, plus Additional Medicare Tax on wages paid
    past the threshold in the calendar year. The employer withholds the
    additional tax from the pay period in which the threshold is crossed,
    whatever the filing status.
    """
    medicare = data["medicare"]
    wages = max(0, wages_cents)
    prior = max(0, prior_ytd_wages_cents)
    over_threshold = max(0, prior + wages - max(medicare["additionalThresholdCents"], prior))
    return div_round_half_up(wages * medicare["rateBasisPoints"], 10_000) + div_round_half_up(
        over_threshold * medicare["additionalRateBasisPoints"], 10_000
    )
