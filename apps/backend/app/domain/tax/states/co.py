"""CO state income tax withholding: the Colorado Withholding Worksheet for Employers (DR 1098).

1. annual wages = wages x pay periods (1c)
2. less the annual withholding allowance (2a): DR 0004 line 2 when the employee entered
   one (zero included); otherwise by the federal W-4 filing status,
   ``allowanceFromFederalCents`` (by status, ``*`` for the rest)
3. times ``ratePercent`` (2c), divided by pay periods (2d)

An employee with only a federal W-4 that claims exempt has nothing withheld. DR 0004
line 3 is the certificate's extra withholding, which the engine adds.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, by_status, option, pct, per_period


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    line_2 = option(inp, "annualAllowanceCents")
    if line_2 is None or line_2 == "":
        if inp.w4.get("exempt"):
            return Withheld(0)
        allowance = Fraction(by_status(params["allowanceFromFederalCents"], inp.w4["filingStatus"]))
    else:
        allowance = Fraction(int(line_2))
    taxable = max(Fraction(0), inp.annual_wages - allowance)
    return Withheld(per_period(taxable * pct(params["ratePercent"]), inp, params.get("round", "cent")))
