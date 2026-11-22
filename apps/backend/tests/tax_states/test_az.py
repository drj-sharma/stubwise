"""Arizona, 2026: Form A-4 (2026) and its employer instructions.

Withholding = the percentage of gross taxable wages the employee checked in box 1, or 2.0%
when no A-4 is on file. The publication has no worked example; these are worked by hand.
"""

from __future__ import annotations

from .helpers import withhold


def test_no_a4_withholds_the_default_two_percent() -> None:
    # $1,000 a week, no A-4: 2.0% x $1,000 = $20.00
    assert withhold("AZ", 2026, wages_cents=100_000, periods=52) == {"sit": 2000}


def test_chosen_percentages() -> None:
    # $2,000 every two weeks at 3.5%: $70.00
    assert withhold("AZ", 2026, wages_cents=200_000, periods=26, cert={"options": {"rate": "3.5"}}) == {"sit": 7000}
    # $1,234.56 at 0.5%: $6.1728 -> $6.17
    assert withhold("AZ", 2026, wages_cents=123_456, periods=24, cert={"options": {"rate": "0.5"}}) == {"sit": 617}


def test_a_percentage_not_on_the_form_falls_back_to_the_default() -> None:
    assert withhold("AZ", 2026, wages_cents=100_000, periods=52, cert={"options": {"rate": "5"}}) == {"sit": 2000}


def test_extra_amount_and_zero_election() -> None:
    # 1.0% of $1,500 = $15.00, plus the $10 extra amount
    cert = {"options": {"rate": "1.0"}, "extraWithholdingCents": 1000}
    assert withhold("AZ", 2026, wages_cents=150_000, periods=12, cert=cert) == {"sit": 2500}
    # Box 2: an Arizona withholding percentage of zero
    assert withhold("AZ", 2026, wages_cents=150_000, periods=12, cert={"exempt": True}) == {"sit": 0}
