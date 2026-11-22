"""Maryland, 2026: Maryland Employer Withholding Guide (revised December 2025), percentage method,
with county rates from the Comptroller's 2026 State and Local Income Tax Withholding memo.

Taxable = wages x periods - $3,400 - $3,200 per MW507 exemption; state rate (4.75% up to
$100,000 single / $150,000 joint, then 5% ... 6.5%) plus the county rate on the same amount.
The guide prints these as tables per local rate; each result below matches that table.
"""

from __future__ import annotations

from .helpers import withhold


def test_montgomery_single_one_exemption_biweekly() -> None:
    # 3.20% table, bi-weekly: 2,000 - 130.76 - 123.08 = 1,746.16 x 7.95% = $138.82
    # (annual: 52,000 - 3,400 - 3,200 = 45,400 x 7.95% = 3,609.30 / 26 = 138.82)
    cert = {"status": "S", "allowances": 1, "localities": ["MONTGOMERY"]}
    assert withhold("MD", 2026, wages_cents=200_000, periods=26, cert=cert) == {"sit": 13882}


def test_worcester_married_two_exemptions_monthly() -> None:
    # 2.25% table, monthly, joint: 5,000 - 283.33 - 533.34 = 4,183.33 x 7.00% = $292.83
    cert = {"status": "M", "allowances": 2, "localities": ["WORCESTER"]}
    assert withhold("MD", 2026, wages_cents=500_000, periods=12, cert=cert) == {"sit": 29283}


def test_anne_arundel_graduated_local_rate() -> None:
    # $4,500 bi-weekly, single, 0 exemptions: 117,000 - 3,400 = 113,600.
    # State: 100,000 x 4.75% + 13,600 x 5% = 5,430. Local: 50,000 x 2.70% + 63,600 x 2.94% = 3,219.84.
    # (5,430 + 3,219.84) / 26 = $332.69
    cert = {"status": "S", "localities": ["ANNE-ARUNDEL"]}
    assert withhold("MD", 2026, wages_cents=450_000, periods=26, cert=cert) == {"sit": 33269}


def test_nonresident_special_rate() -> None:
    # Nonresident: state + special 2.25% = 7.00%: 45,400 x 7% = 3,178 / 52 = $61.12
    cert = {"status": "S", "allowances": 1, "localities": ["NONRESIDENT"]}
    assert withhold("MD", 2026, wages_cents=100_000, periods=52, cert=cert) == {"sit": 6112}


def test_no_mw507_one_exemption_and_highest_local_rate() -> None:
    # No MW507: one exemption, single (federal W-4 default), no county: 3.30% local.
    # 45,400 x 8.05% = 3,654.70 / 52 = $70.28
    assert withhold("MD", 2026, wages_cents=100_000, periods=52) == {"sit": 7028}


def test_below_the_minimum_nothing_is_withheld() -> None:
    # "Do not withhold on gross wages less than $96.00" (weekly).
    assert withhold("MD", 2026, wages_cents=9_500, periods=52, cert={"localities": ["MONTGOMERY"]}) == {"sit": 0}
