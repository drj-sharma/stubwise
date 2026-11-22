"""Arkansas, 2026: DFA "Withholding Tax Formula Method, Effective 01/01/2026", the version
revised for H.B. 1001 (top rate 3.7%, retroactive to January 1, 2026).
"""

from __future__ import annotations

from .helpers import withhold


def test_dfa_example_gary_monthly_2_exemptions() -> None:
    # DFA example: $2,127 monthly, 2 exemptions. 25,524 - 2,470 = 23,054 -> midrange 23,050;
    # 23,050 x 3.4% - 287.97 = 495.73 -> $496; 496 - 2 x 29 = 438; / 12 = $36.50
    assert withhold("AR", 2026, wages_cents=212_700, periods=12, cert={"allowances": 2}) == {"sit": 3650}


def test_no_ar4ec_is_zero_exemptions() -> None:
    # Same pay, no AR4EC: $496 / 12 = $41.33
    assert withhold("AR", 2026, wages_cents=212_700, periods=12) == {"sit": 4133}


def test_in_the_100_dollar_adjustment_bands() -> None:
    # $8,100 monthly: 97,200 - 2,470 = 94,730 -> midrange 94,750, row $94,701-$94,800:
    # 94,750 x 3.7% - 369.90 = 3,135.85 -> $3,136; / 12 = $261.33
    assert withhold("AR", 2026, wages_cents=810_000, periods=12) == {"sit": 26133}


def test_over_100000_uses_the_exact_dollar_figure() -> None:
    # $5,000 bi-weekly, 1 exemption: 130,000 - 2,470 = 127,530 (no midrange);
    # 127,530 x 3.7% - 79.90 = 4,638.71 -> $4,639; 4,639 - 29 = 4,610; / 26 = $177.31
    assert withhold("AR", 2026, wages_cents=500_000, periods=26, cert={"allowances": 1}) == {"sit": 17731}


def test_low_pay_withholds_nothing() -> None:
    # $150 weekly: 7,800 - 2,470 = 5,330 -> 5,350, in the 0% bracket.
    assert withhold("AR", 2026, wages_cents=15_000, periods=52) == {"sit": 0}
    # $250 weekly, 3 exemptions: 13,000 - 2,470 = 10,530 -> 10,550 x 2% - 111.98 = 99.02 -> $99;
    # credits 3 x 29 = 87; 12 / 52 = $0.23
    assert withhold("AR", 2026, wages_cents=25_000, periods=52, cert={"allowances": 3}) == {"sit": 23}
    # 4 exemptions: credits 116 exceed the $99 tax.
    assert withhold("AR", 2026, wages_cents=25_000, periods=52, cert={"allowances": 4}) == {"sit": 0}
