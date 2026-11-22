"""Louisiana, 2026: R-1306 (1/26), Computer Formula Method.

W = (S - (standard deduction / N)) x .0309; standard deduction $12,875 (L-4 Block A "1")
or $25,750 ("2"); none for "0" or when no L-4 is on file.
"""

from __future__ import annotations

from .helpers import withhold


def test_example_1_weekly_claiming_1() -> None:
    # R-1306 Example 1: $700 weekly, "1": (700 - 12,875/52) x .0309 = $13.98
    assert withhold("LA", 2026, wages_cents=70_000, periods=52, cert={"status": "1"}) == {"sit": 1398}


def test_example_2_biweekly_claiming_2() -> None:
    # R-1306 Example 2: $4,600 bi-weekly, "2": (4,600 - 25,750/26) x .0309 = $111.54
    assert withhold("LA", 2026, wages_cents=460_000, periods=26, cert={"status": "2"}) == {"sit": 11154}


def test_no_l4_withholds_without_standard_deduction() -> None:
    # L-4: with no certificate, withhold "without any standard deduction": 700 x .0309 = $21.63
    assert withhold("LA", 2026, wages_cents=70_000, periods=52) == {"sit": 2163}
    # A married federal W-4 does not change that.
    assert withhold("LA", 2026, wages_cents=70_000, periods=52, w4={"filingStatus": "married"}) == {"sit": 2163}


def test_wages_below_the_deduction_withhold_nothing() -> None:
    # $200 weekly, "1": 200 - 247.60 is negative, so it counts as zero.
    assert withhold("LA", 2026, wages_cents=20_000, periods=52, cert={"status": "1"}) == {"sit": 0}
