"""Connecticut withholding: the Withholding Calculation Rules (TPG-211).

The figures, and the guide they come from, are in this state's income row of the
tax_rules table (seeded from app/tax_rules/data/<year>/CT.json). Each table is a list
of ``[more_than_cents, value]`` rows: the row used is the last one whose figure the
annualized salary is more than (the publication's "more than ... less than or equal to").

1. annualized salary = wages x pay periods
2. taxable = salary - personal exemption (Table A, by withholding code)
3. initial tax on taxable (Table B, graduated by code)
4. + 2% rate phase-out add-back (Table C) + tax recapture (Table D), both by salary
5. x (1 - personal tax credit decimal, Table E)
6. / pay periods, less CT-W4 line 3 reduced withholding (never below zero)

Code E means no withholding. With no CT-W4 on file the employer withholds the top
rate (``noCertificateRatePercent``) on all wages, without any exemption.
"""

from __future__ import annotations

from collections.abc import Sequence
from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, bracket_tax, count, pct, per_period, round_half_up


def _lookup(salary: Fraction, rows: Sequence[Sequence[Any]]) -> Any:
    """The value on the last row whose "more than" figure ``salary`` exceeds (0 when none)."""
    value: Any = 0
    for more_than, row_value in rows:
        if salary > more_than:
            value = row_value
    return value


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    code = inp.cert.get("status")
    if code not in params["statuses"]:
        return Withheld(round_half_up(Fraction(max(0, inp.wages_cents)) * pct(params["noCertificateRatePercent"])))
    if code in params.get("noWithholdingStatuses", []):
        return Withheld(0)

    salary = inp.annual_wages
    taxable = salary - _lookup(salary, params["exemptionCents"][code])
    if taxable <= 0:
        tax = Fraction(0)
    else:
        tax = bracket_tax(taxable, params["brackets"][code])
        tax += _lookup(salary, params["addBackCents"][code])
        tax += _lookup(salary, params["recaptureCents"][code])
        tax *= 1 - pct(_lookup(salary, params["creditPercent"][code]))
    cents = per_period(tax, inp, params.get("round", "cent"))
    return Withheld(max(0, cents - count(inp, "reducedCents")))
