"""Maine, 2026: Withholding Tables for Individual Income Tax, revised August 2026
(standard deduction and 2% surcharge), percentage method; and Maine Paid Family and
Medical Leave (employer FAQ, July 2026): worker share 0.5% up to the Social Security
wage base ($184,500 for 2026, IRS Publication 15 (2026)).

Examples 1-3 are the booklet's own. Pay dates up to 2026-08-16 use the January 2026
booklet (revised December 2025): standard deduction $12,450 / $27,750 and no surcharge;
its examples 2 and 3 are checked below.
"""

from __future__ import annotations

from typing import Any

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def _sit_on(pay_date: str, wages_cents: int, cert: dict[str, Any]) -> int:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=52,
        w4=DEFAULT_W4,
        cert={**DEFAULT_STATE_W4, **cert},  # type: ignore[typeddict-item]
        pay_date=pay_date,
    )
    lines = state_taxes(rules_for("ME", 2026), "ME", inp)
    return next(line["cents"] for line in lines if line["code"] == "sit")


def test_example_1_no_tax_below_deductions() -> None:
    lines = withhold("ME", 2026, wages_cents=30_000, periods=52, cert={"status": "single", "allowances": 2})
    assert lines["sit"] == 0


def test_example_2_single_weekly() -> None:
    # 52,000 - 10,600 - 12,850 = 28,550; 1,589 + 1,150 x 6.75% = 1,667 / 52 = 32.06 -> $32
    lines = withhold("ME", 2026, wages_cents=100_000, periods=52, cert={"status": "single", "allowances": 2})
    assert lines["sit"] == 3200


def test_example_3_married_weekly_in_phase_out() -> None:
    # 234,000; deduction 28,550 x 0.8037 = 22,945.64; 234,000 - 10,600 - 22,945.64 = 200,454.36;
    # 8,237 + 70,704.36 x 7.15% = 13,292.36 / 52 = 255.62 -> $256
    lines = withhold("ME", 2026, wages_cents=450_000, periods=52, cert={"status": "married", "allowances": 2})
    assert lines["sit"] == 25600


def test_no_w4me_is_single_with_no_allowances() -> None:
    # 52,000 - 12,850 = 39,150; 1,589 + 11,750 x 6.75% = 2,382.13 / 52 = 45.81 -> $46
    assert withhold("ME", 2026, wages_cents=100_000, periods=52) == {"sit": 4600, "pfml": 500}
    assert withhold("ME", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "married"})["sit"] == 4600


def test_married_at_higher_single_rate_uses_single_figures() -> None:
    lines = withhold("ME", 2026, wages_cents=100_000, periods=52, cert={"status": "higherSingle", "allowances": 2})
    assert lines["sit"] == 3200


def test_surcharge_over_one_million() -> None:
    # $25,000 weekly single: 1,300,000, no standard deduction (over $177,250);
    # 4,117 + 1,235,150 x 7.15% = 92,430.23, plus 2% x 300,000 = 6,000; 98,430.23 / 52 = 1,892.89 -> $1,893
    lines = withhold("ME", 2026, wages_cents=2_500_000, periods=52, cert={"status": "single"})
    assert lines["sit"] == 189_300


def test_pfml_below_and_across_the_wage_base() -> None:
    # 0.5% of $1,000
    assert withhold("ME", 2026, wages_cents=100_000, periods=52)["pfml"] == 500
    # $182,000 paid earlier: only $2,500 of this $5,000 is under the $184,500 base -> $12.50
    assert withhold("ME", 2026, wages_cents=500_000, periods=52, prior_ytd_wages_cents=18_200_000)["pfml"] == 1250
    # Past the base: nothing.
    assert withhold("ME", 2026, wages_cents=500_000, periods=52, prior_ytd_wages_cents=18_450_000)["pfml"] == 0


def test_january_booklet_figures_before_the_august_revision() -> None:
    # January booklet example 2: 52,000 - 10,600 - 12,450 = 28,950; 1,589 + 1,550 x 6.75% = 1,694 / 52 = 32.58 -> $33
    assert _sit_on("2026-03-15", 100_000, {"status": "single", "allowances": 2}) == 3300
    # January booklet example 3: deduction 27,750 x 0.8037 = 22,302.68; 201,097.33 -> 8,237 + 71,347.33 x 7.15%
    # = 13,338.33 / 52 = 256.51 -> $257
    assert _sit_on("2026-03-15", 450_000, {"status": "married", "allowances": 2}) == 25700
    # No surcharge in the January booklet: $25,000 weekly single, 92,430.23 / 52 = 1,777.50 -> $1,778
    assert _sit_on("2026-03-15", 2_500_000, {"status": "single"}) == 177_800


def test_revised_figures_from_the_august_tax_alert() -> None:
    assert _sit_on("2026-08-16", 100_000, {"status": "single", "allowances": 2}) == 3300
    assert _sit_on("2026-08-17", 100_000, {"status": "single", "allowances": 2}) == 3200
    assert _sit_on("2026-08-17", 2_500_000, {"status": "single"}) == 189_300
