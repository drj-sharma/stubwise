"""Kansas, 2026: KW-100 Withholding Tax Guide (Rev. 10-24, rates for wages paid on and
after July 1, 2024; Notice 25-06: no rate reduction for tax year 2026).

Wages less the withholding allowance amount, then the period's percentage table
for the K-4 allowance rate (Single or Joint).
"""

from __future__ import annotations

from .helpers import withhold


def test_kw100_sample_computation() -> None:
    # KW-100 "Sample withholding computations": $2,000 semi-monthly, Joint, 3 allowances:
    # 763.33 + 96.67 = 860; 2,000 - 860 = 1,140; (1,140 - 343) x 5.2% = $41.44
    assert withhold("KS", 2026, wages_cents=200_000, periods=24, cert={"status": "married", "allowances": 3}) == {
        "sit": 4144
    }


def test_no_k4_is_single_with_no_allowances() -> None:
    # $1,000 weekly, Table 1a: 23.00 + (1,000 - 512) x 5.58% = $50.23
    assert withhold("KS", 2026, wages_cents=100_000, periods=52) == {"sit": 5023}


def test_allowance_amounts_match_wage_bracket_tables() -> None:
    # Single, 2 allowances, $300 weekly: 300 - 176.15 - 44.62 = 79.23; (79.23 - 69) x 5.2% = $0.53
    # (wage-bracket table, single weekly $295-$305, 2 allowances: $1 after rounding)
    assert withhold("KS", 2026, wages_cents=30_000, periods=52, cert={"status": "single", "allowances": 2}) == {
        "sit": 53
    }
    # Joint, 1 allowance, $1,010 weekly: 1,010 - 176.15 = 833.85; (833.85 - 158) x 5.2% = $35.14
    # (wage-bracket table, married weekly $1,000-$1,020, 1 allowance: $35)
    assert withhold("KS", 2026, wages_cents=101_000, periods=52, cert={"status": "married", "allowances": 1}) == {
        "sit": 3514
    }
