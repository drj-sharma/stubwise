"""Vermont, 2026: Income Tax Withholding Instructions, Tables, and Charts (GB-1210-2026),
percentage method tables effective January 1, 2026.

Wages less W-4VT allowances x the allowance value for the period, then the
period's table for the status.
"""

from __future__ import annotations

from .helpers import withhold


def test_gb1210_example_weekly_married() -> None:
    # GB-1210 example: $1,800 weekly, married, 2 allowances: 1,800 - 207.70 = 1,592.30;
    # (1,592.30 - 226) x 3.35% = $45.77
    assert withhold("VT", 2026, wages_cents=180_000, periods=52, cert={"status": "married", "allowances": 2}) == {
        "sit": 4577
    }


def test_no_w4vt_uses_federal_status_and_30_percent_of_federal_extra() -> None:
    # Single federal W-4, $1,000 weekly: (1,000 - 75) x 3.35% = $30.99
    assert withhold("VT", 2026, wages_cents=100_000, periods=52) == {"sit": 3099}
    # Married federal W-4: (1,000 - 226) x 3.35% = $25.93
    assert withhold("VT", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "married"}) == {"sit": 2593}
    # $10 extra federal withholding: Vermont adds 30% of it, $3.00
    assert withhold("VT", 2026, wages_cents=100_000, periods=52, w4={"extraWithholdingCents": 1_000}) == {"sit": 3399}


def test_single_monthly_with_allowance() -> None:
    # $5,000 monthly - $450 = 4,550; (4,550 - 327) x 3.35% = $141.47
    assert withhold("VT", 2026, wages_cents=500_000, periods=12, cert={"status": "single", "allowances": 1}) == {
        "sit": 14147
    }
    # A W-4VT on file: extra federal withholding is not carried over.
    assert withhold(
        "VT",
        2026,
        wages_cents=500_000,
        periods=12,
        w4={"extraWithholdingCents": 1_000},
        cert={"status": "separate", "allowances": 1},
    ) == {"sit": 14147}
