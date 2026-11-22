"""Connecticut, 2026: TPG-211, 2026 Withholding Calculation Rules (Rev. 12/25); CT Paid Leave.

TPG-211 has no worked examples. The checks against the state's own figures use the
2026 Withholding Tables (Effective January 1, 2026), weekly payroll period, which DRS
computes with the same rules at the middle of each wage row: the $740-$750 row
($745) and the $1,000-$1,009 row ($1,004.50). The higher-wage cases are worked by hand
from the TPG-211 tables, with the steps in the comments.
"""

from __future__ import annotations

from .helpers import withhold

CT = "CT"


def sit(**kwargs: object) -> int:
    return withhold(CT, 2026, **kwargs)["sit"]  # type: ignore[arg-type]


def test_weekly_wage_table_rows() -> None:
    # Weekly $740-$750 row: A $25.85, B $8.72, C $3.69, D $28.72, F $21.17
    expected = {"A": 2585, "B": 872, "C": 369, "D": 2872, "F": 2117}
    assert {code: sit(wages_cents=74_500, periods=52, cert={"status": code}) for code in expected} == expected
    # Weekly $1,000-$1,009 row: A $40.89, B $30.64, D $41.31 (A includes the $25 add-back and a .01 credit)
    expected = {"A": 4089, "B": 3064, "D": 4131}
    assert {code: sit(wages_cents=100_450, periods=52, cert={"status": code}) for code in expected} == expected


def test_monthly_code_c() -> None:
    # $10,000 a month: salary $120,000, no exemption (over $71,000).
    # Table B (code C): $4,000 + 5.5% x $20,000 = $5,100; add-back ($115,500-$120,500) $200;
    # no recapture (up to $210,000); no credit (over $100,500): $5,300 / 12 = $441.666 -> $441.67
    assert sit(wages_cents=1_000_000, periods=12, cert={"status": "C"}) == 44_167


def test_recapture_for_high_earners() -> None:
    # Code A, $20,000 a month: salary $240,000, no exemption.
    # Table B: $10,750 + 6.5% x $40,000 = $13,350; add-back $250; recapture ($235,000-$240,000) $970;
    # no credit: $14,570 / 12 = $1,214.1666 -> $1,214.17
    assert sit(wages_cents=2_000_000, periods=12, cert={"status": "A"}) == 121_417


def test_biweekly_code_f_with_partial_exemption() -> None:
    # $1,500 every two weeks: salary $39,000; Table A (F) $38,000-$39,000: $6,000 exemption -> $33,000;
    # $200 + 4.5% x $23,000 = $1,235; no add-back or recapture; credit (F, $33,300-$60,000) .10:
    # $1,235 x .90 = $1,111.50 / 26 = $42.75
    assert sit(wages_cents=150_000, periods=26, cert={"status": "F"}) == 4275


def test_no_certificate_withholds_the_top_rate_on_all_wages() -> None:
    # No CT-W4: 6.99% of $1,000, no exemption.
    assert withhold(CT, 2026, wages_cents=100_000, periods=52) == {"sit": 6990, "pfml": 500}


def test_code_e_and_reduced_withholding() -> None:
    assert sit(wages_cents=100_000, periods=52, cert={"status": "E"}) == 0
    # Code A $1,004.50 a week is $40.89; CT-W4 line 3 reduces it by $10.
    assert sit(wages_cents=100_450, periods=52, cert={"status": "A", "options": {"reducedCents": 1000}}) == 3089
    assert sit(wages_cents=100_450, periods=52, cert={"status": "A", "options": {"reducedCents": 9000}}) == 0


def test_paid_leave_below_and_across_the_wage_base() -> None:
    assert withhold(CT, 2026, wages_cents=100_000, periods=52)["pfml"] == 500  # 0.5% of $1,000
    # $184,000 paid already: $500 left under the $184,500 Social Security wage base -> $2.50
    assert withhold(CT, 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=18_400_000)["pfml"] == 250
