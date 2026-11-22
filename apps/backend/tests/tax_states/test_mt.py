"""Montana, 2026: Montana Employer and Information Agent Guide (V4 November 2025),
Montana Withholding Tax Formula examples (pages 17-19).

W = A + B x (G - C), rounded to the nearest dollar (the examples round to nearest, not up).
No MW-4 on file means single (line 1a).
"""

from __future__ import annotations

from .helpers import withhold


def test_single_examples() -> None:
    # Example 1, box 1a, $1,375 semimonthly: 0.047 x (1,375 - 671) = $33.09 -> $33 (no MW-4: single)
    assert withhold("MT", 2026, wages_cents=137_500, periods=24) == {"sit": 3300}
    # Example 2, line 2 (both spouses working), $2,950 biweekly: 86 + 0.0565 x (2,950 - 2,446) = $114.48 -> $114
    assert withhold("MT", 2026, wages_cents=295_000, periods=26, cert={"status": "B"}) == {"sit": 11400}
    # Example 3, box 1a, $475 weekly: 0.047 x (475 - 310) = $7.76 -> $8
    assert withhold("MT", 2026, wages_cents=47_500, periods=52, cert={"status": "S"}) == {"sit": 800}


def test_no_mw4_is_single_even_when_the_federal_w4_is_married() -> None:
    assert withhold("MT", 2026, wages_cents=137_500, periods=24, w4={"filingStatus": "married"}) == {"sit": 3300}


def test_married_filing_jointly_examples() -> None:
    married = {"status": "M"}
    # Example 1: 0.047 x (1,375 - 1,342) = $1.55 -> $2
    assert withhold("MT", 2026, wages_cents=137_500, periods=24, cert=married) == {"sit": 200}
    # Example 2: 172 + 0.0565 x (5,950 - 4,892) = $231.78 -> $232
    assert withhold("MT", 2026, wages_cents=595_000, periods=26, cert=married) == {"sit": 23200}
    # Example 3: 0.047 x (725 - 619) = $4.98 -> $5
    assert withhold("MT", 2026, wages_cents=72_500, periods=52, cert=married) == {"sit": 500}


def test_head_of_household_examples() -> None:
    head = {"status": "H"}
    # Example 1: 0.047 x (1,375 - 1,006) = $17.34 -> $17
    assert withhold("MT", 2026, wages_cents=137_500, periods=24, cert=head) == {"sit": 1700}
    # Example 2: 129 + 0.0565 x (4,950 - 3,669) = $201.38 -> $201
    assert withhold("MT", 2026, wages_cents=495_000, periods=26, cert=head) == {"sit": 20100}
    # Example 3: 0.047 x (575 - 464) = $5.22 -> $5
    assert withhold("MT", 2026, wages_cents=57_500, periods=52, cert=head) == {"sit": 500}


def test_line_4_specified_withholding() -> None:
    cert = {"status": "S", "options": {"specifiedCents": 15_000}}
    assert withhold("MT", 2026, wages_cents=137_500, periods=24, cert=cert) == {"sit": 15_000}
