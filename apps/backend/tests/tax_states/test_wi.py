"""Wisconsin, 2026: Publication W-166 (1/26), Alternate Method of Withholding Wisconsin Income Tax.

The first three tests are the guide's own Examples 1-3. No WT-4 on file: zero exemptions
(W-166, section 3.C), single status.
"""

from __future__ import annotations

from .helpers import withhold


def test_example_1_single_weekly_one_exemption() -> None:
    # $350 weekly, single, 1 exemption: 18,200 - 6,651.60 - 400 = 11,148.40; x 3.54% = 394.65; / 52 = $7.59.
    assert withhold("WI", 2026, wages_cents=35_000, periods=52, cert={"status": "single", "allowances": 1}) == {
        "sit": 759
    }


def test_example_2_single_weekly_three_exemptions() -> None:
    # $500 weekly, single, 3 exemptions: net 19,084.40; 451.70 + 6,324.40 x 4.65% = 745.78; / 52 = $14.34.
    assert withhold("WI", 2026, wages_cents=50_000, periods=52, cert={"status": "single", "allowances": 3}) == {
        "sit": 1434
    }


def test_example_3_married_biweekly_three_exemptions() -> None:
    # $1,000 biweekly, married, 3 exemptions: 26,000 - 9,406.40 - 1,200 = 15,393.60;
    # 451.70 + 2,633.60 x 4.65% = 574.16; / 26 = $22.08.
    assert withhold("WI", 2026, wages_cents=100_000, periods=26, cert={"status": "married", "allowances": 3}) == {
        "sit": 2208
    }


def test_no_wt4_is_single_with_zero_exemptions() -> None:
    # $1,000 weekly, no WT-4: gross 52,000; deduction 6,702 - 12% x (52,000 - 17,780) = 2,595.60;
    # net 49,404.40; 1,045.04 + (49,404.40 - 25,520) x 5.30% = 1,045.04 + 1,265.873 = 2,310.913; / 52 = $44.44.
    assert withhold("WI", 2026, wages_cents=100_000, periods=52) == {"sit": 4444}


def test_married_withhold_at_single_rate_uses_single_figures() -> None:
    single = withhold("WI", 2026, wages_cents=100_000, periods=52, cert={"status": "single", "allowances": 2})
    higher = withhold("WI", 2026, wages_cents=100_000, periods=52, cert={"status": "marriedSingle", "allowances": 2})
    assert single == higher


def test_high_wage_no_deduction_top_band() -> None:
    # $30,000 monthly, single, 0 exemptions: gross 360,000 (deduction phased out to 0);
    # 14,582.83 + (360,000 - 280,950) x 7.65% = 14,582.83 + 6,047.325 = 20,630.155; / 12 = 1,719.1796 -> $1,719.18.
    assert withhold("WI", 2026, wages_cents=3_000_000, periods=12, cert={"status": "single"}) == {"sit": 171918}
