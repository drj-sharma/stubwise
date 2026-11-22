"""Oklahoma, 2026: Packet OW-2 (revised 11-2025, effective January 1, 2026), percentage
formula method: wages less allowances x the period's allowance amount, then the period's
Single or Married rate table, rounded to the nearest dollar.
"""

from __future__ import annotations

from .helpers import withhold


def test_ow2_sample_computation_semimonthly_married_2() -> None:
    # OW-2 sample: $1,825 semi-monthly, married, 2 allowances. 1,825 - 2 x 41.67 = 1,741.66;
    # 9.10 + 4.5% x (1,741.66 - 1,129) = 36.67 -> $37
    cert = {"status": "married", "allowances": 2}
    assert withhold("OK", 2026, wages_cents=182_500, periods=24, cert=cert) == {"sit": 3700}


def test_no_ok_w4_is_single_with_no_allowances() -> None:
    # $800 weekly, single table: 2.10 + 4.5% x (800 - 261) = 26.36 -> $26.
    # A married federal W-4 does not change it.
    assert withhold("OK", 2026, wages_cents=80_000, periods=52) == {"sit": 2600}
    assert withhold("OK", 2026, wages_cents=80_000, periods=52, w4={"filingStatus": "married"}) == {"sit": 2600}


def test_married_at_single_rate_uses_the_single_table() -> None:
    # $2,000 bi-weekly, 1 allowance: 2,000 - 38.46 = 1,961.54; single: 4.20 + 4.5% x 1,440.54 = 69.02 -> $69
    cert = {"status": "marriedSingleRate", "allowances": 1}
    assert withhold("OK", 2026, wages_cents=200_000, periods=26, cert=cert) == {"sit": 6900}


def test_monthly_married_3_allowances() -> None:
    # $5,000 monthly: 5,000 - 3 x 83.33 = 4,750.01; 18.21 + 4.5% x (4,750.01 - 2,258) = 130.35 -> $130
    cert = {"status": "married", "allowances": 3}
    assert withhold("OK", 2026, wages_cents=500_000, periods=12, cert=cert) == {"sit": 13000}


def test_low_wages_withhold_nothing() -> None:
    # $190 weekly is under the $194 single threshold.
    assert withhold("OK", 2026, wages_cents=19_000, periods=52) == {"sit": 0}
