"""AZ state income tax withholding: the percentage of gross taxable wages chosen on Form A-4.

``params``: ``rates`` (the percentages box 1 of Form A-4 allows), ``defaultRatePercent`` (what
is withheld when no A-4 is on file), ``round``. The employee's choice is ``options.rate``.
Box 2 (a zero election) is the certificate's exempt switch, and the box 1 extra amount is
the extra withholding, both of which the engine handles.
"""

from __future__ import annotations

from fractions import Fraction
from typing import Any

from ._common import StateInput, Withheld, option, pct, per_period


def withhold(params: dict[str, Any], inp: StateInput) -> Withheld:
    chosen = option(inp, "rate")
    rate = str(chosen) if chosen is not None and str(chosen) in params["rates"] else params["defaultRatePercent"]
    wages = Fraction(max(0, inp.wages_cents))
    # per_period divides by pay periods, so work from the annual figure to keep one rounding.
    return Withheld(per_period(wages * inp.periods_per_year * pct(rate), inp, params.get("round", "cent")))
