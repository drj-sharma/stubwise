"""California, 2026: EDD "2026 Withholding Schedules - Method B" (26methb.pdf, also in DE 44 Rev. 52),
worked on the annual tables, which EDD allows (notes to Examples E and F). SDI is 1.3% of all wages
(DE 44 Rev. 52: no SDI taxable wage limit since 2024).

Examples C and D in the publication use the monthly and weekly tables, whose figures are rounded per
period, so they come out 2 cents different on the annual tables; they are checked by hand below.
"""

from __future__ import annotations

from .helpers import withhold


def test_example_a_below_low_income_exemption() -> None:
    # Example A: $210 a week, single, 1 allowance. $10,920 a year <= $18,896: no income tax.
    assert withhold("CA", 2026, wages_cents=21_000, periods=52, cert={"status": "S", "allowances": 1}) == {
        "sit": 0,
        "sdi": 273,
    }


def test_example_b_estimated_deduction_allowance() -> None:
    # Example B: $1,600 biweekly, married, 2 regular + 1 estimated deduction allowance: $2.38.
    # Annual: 41,600 - 1,000 - 11,412 = 29,188; 243.74 + 2.2% x (29,188 - 22,158) = 398.40;
    # less 2 x 168.30 = 61.80; / 26 = 2.38.
    cert = {"status": "M", "allowances": 2, "additionalAllowances": 1}
    assert withhold("CA", 2026, wages_cents=160_000, periods=26, cert=cert) == {"sit": 238, "sdi": 2080}


def test_example_e_semi_monthly_annualized() -> None:
    # Example E: $2,400 semi-monthly, married, 4 allowances: (772.40 - 673.20) / 24 = $4.13.
    cert = {"status": "M", "allowances": 4}
    assert withhold("CA", 2026, wages_cents=240_000, periods=24, cert=cert) == {"sit": 413, "sdi": 3120}


def test_example_f_monthly_annualized() -> None:
    # Example F: $4,750 a month, married, 4 allowances: (759.20 - 673.20) / 12 = $7.17.
    cert = {"status": "M", "allowances": 4}
    assert withhold("CA", 2026, wages_cents=475_000, periods=12, cert=cert) == {"sit": 717, "sdi": 6175}


def test_example_c_and_d_on_annual_tables() -> None:
    # Example C ($5,100 monthly, married, 5 allowances; $0.82 on the monthly table):
    # 61,200 - 11,412 = 49,788; 243.74 + 2.2% x 27,630 = 851.60; - 5 x 168.30 = 10.10; / 12 = 0.84.
    assert withhold("CA", 2026, wages_cents=510_000, periods=12, cert={"status": "M", "allowances": 5})["sit"] == 84
    # Example D ($950 weekly, head of household, 3 allowances; $1.69 on the weekly table):
    # 49,400 - 11,412 = 37,988; 243.90 + 2.2% x 15,815 = 591.83; - 3 x 168.30 = 86.93; / 52 = 1.67.
    assert withhold("CA", 2026, wages_cents=95_000, periods=52, cert={"status": "H", "allowances": 3})["sit"] == 167


def test_no_de4_is_single_with_zero_allowances() -> None:
    # DE 44: no DE 4 on file -> Single with zero allowances, even with a married federal W-4.
    # $1,000 a week: 52,000 - 5,706 = 46,294; 1,124.21 + 6.6% x (46,294 - 41,452) = 1,443.782; / 52 = 27.77.
    expected = {"sit": 2777, "sdi": 1300}
    assert withhold("CA", 2026, wages_cents=100_000, periods=52) == expected
    assert withhold("CA", 2026, wages_cents=100_000, periods=52, w4={"filingStatus": "married"}) == expected


def test_married_with_one_allowance_uses_single_deduction() -> None:
    # $3,000 a month, married, 1 allowance: single exemption ($18,896) and deduction ($5,706), married rates.
    # 36,000 - 5,706 = 30,294; 243.74 + 2.2% x (30,294 - 22,158) = 422.732; - 168.30 = 254.432; / 12 = 21.20.
    assert withhold("CA", 2026, wages_cents=300_000, periods=12, cert={"status": "M", "allowances": 1})["sit"] == 2120


def test_top_bracket() -> None:
    # $1,200,000 a year paid monthly, single, 0 allowances: 1,200,000 - 5,706 = 1,194,294;
    # 114,220.27 + 14.63% x 194,294 = 142,645.4822; / 12 = 11,887.12.
    assert withhold("CA", 2026, wages_cents=10_000_000, periods=12, cert={"status": "S"})["sit"] == 1_188_712


def test_sdi_has_no_wage_base() -> None:
    lines = withhold("CA", 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=50_000_000)
    assert lines["sdi"] == 1300


def test_extra_withholding_and_exempt() -> None:
    assert withhold("CA", 2026, wages_cents=100_000, periods=52, cert={"extraWithholdingCents": 500})["sit"] == 3277
    assert withhold("CA", 2026, wages_cents=100_000, periods=52, cert={"exempt": True}) == {"sit": 0, "sdi": 1300}
