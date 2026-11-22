"""Oregon, 2026: Withholding Tax Formulas 150-206-436 (Rev. 12-31-25), annual wages formula; statewide
transit tax 0.1% (DOR); Paid Leave Oregon worker share 60% of 1% = 0.6% up to $184,500 (OED).

Examples 1 and 2 are the publication's own. Its prose for Examples 1, 3 and 4 still carries some 2025
figures ($21,165, $256, $5,100) that disagree with its 2026 formula; the tests use the 2026 formula
and phase-out tables, worked by hand in the comments.
"""

from __future__ import annotations

from .helpers import withhold


def test_example_1_annual() -> None:
    # Single, $25,000 a year, 0 allowances, $1,000 federal tax:
    # BASE = 25,000 - 1,000 - 2,910 = 21,090; 941 + 8.75% x (21,090 - 11,400) = 1,788.875.
    cert = {"status": "single"}
    lines = withhold("OR", 2026, wages_cents=2_500_000, periods=1, cert=cert, federal_tax_cents=100_000)
    assert lines == {"sit": 178_888, "transit": 2_500, "pfml": 15_000}


def test_example_2_monthly() -> None:
    # Same worker paid monthly: 1,788.875 / 12 = $149.07 (the publication rounds it to $149).
    cert = {"status": "single"}
    lines = withhold("OR", 2026, wages_cents=208_333, periods=12, cert=cert, federal_tax_cents=8_333)
    assert lines == {"sit": 14_907, "transit": 208, "pfml": 1_250}


def test_example_3_single_federal_subtraction_phased_out() -> None:
    # Single, $132,000, 4 allowances, $21,098 federal tax. 2026 single phase-out at $130,000-$135,000: $5,250.
    # 3+ allowances -> married formula and $5,820 deduction; single over $100,000 -> allowances = 0.
    # BASE = 132,000 - 5,250 - 5,820 = 120,930; 1,357 + 8.75% x (120,930 - 22,800) = 9,943.375.
    cert = {"status": "single", "allowances": 4}
    lines = withhold("OR", 2026, wages_cents=13_200_000, periods=1, cert=cert, federal_tax_cents=2_109_800)
    assert lines["sit"] == 994_338


def test_example_4_married_at_single_rate() -> None:
    # Married at the single rate, $175,000, 4 allowances: single phase-out gives $0 federal subtraction
    # (>= $145,000) and no allowances (> $100,000). BASE = 175,000 - 5,820 = 169,180;
    # 1,357 + 8.75% x (169,180 - 22,800) = 14,165.25.
    cert = {"status": "single-rate", "allowances": 4}
    lines = withhold("OR", 2026, wages_cents=17_500_000, periods=1, cert=cert, federal_tax_cents=2_500_000)
    assert lines == {"sit": 1_416_525, "transit": 17_500, "pfml": 105_000}


def test_no_or_w4_withholds_eight_percent() -> None:
    assert withhold("OR", 2026, wages_cents=100_000, periods=52) == {"sit": 8_000, "transit": 100, "pfml": 600}


def test_married_biweekly_with_allowances() -> None:
    # $1,500 biweekly, $50 federal tax, married, 2 allowances: BASE = 39,000 - 1,300 - 5,820 = 31,880;
    # 1,620 + 8.75% x (31,880 - 22,800) = 2,414.50; - 2 x 263 = 1,888.50; / 26 = 72.63.
    cert = {"status": "married", "allowances": 2}
    lines = withhold("OR", 2026, wages_cents=150_000, periods=26, cert=cert, federal_tax_cents=5_000)
    assert lines == {"sit": 7_263, "transit": 150, "pfml": 900}


def test_federal_subtraction_capped() -> None:
    # $3,750 a month, $1,000 federal tax a month ($12,000 a year, capped at $8,750), single, 0 allowances:
    # BASE = 45,000 - 8,750 - 2,910 = 33,340; 941 + 8.75% x 21,940 = 2,860.75; / 12 = 238.40.
    cert = {"status": "single"}
    lines = withhold("OR", 2026, wages_cents=375_000, periods=12, cert=cert, federal_tax_cents=100_000)
    assert lines["sit"] == 23_840


def test_married_high_wages_keeps_allowances_under_200k() -> None:
    # Married, $150,000, 3 allowances, $20,000 federal tax (cap $8,750 under $250,000):
    # BASE = 150,000 - 8,750 - 5,820 = 135,430; 1,357 + 8.75% x 112,630 = 11,212.125; - 3 x 263 = 10,423.125.
    cert = {"status": "married", "allowances": 3}
    lines = withhold("OR", 2026, wages_cents=15_000_000, periods=1, cert=cert, federal_tax_cents=2_000_000)
    assert lines["sit"] == 1_042_313


def test_paid_leave_stops_at_wage_base() -> None:
    cert = {"status": "single"}
    below = withhold("OR", 2026, wages_cents=200_000, periods=52, cert=cert, prior_ytd_wages_cents=10_000_000)
    assert below["pfml"] == 1_200
    across = withhold("OR", 2026, wages_cents=200_000, periods=52, cert=cert, prior_ytd_wages_cents=18_400_000)
    assert across["pfml"] == 300  # only $500 left under $184,500
    over = withhold("OR", 2026, wages_cents=200_000, periods=52, cert=cert, prior_ytd_wages_cents=18_450_000)
    assert over["pfml"] == 0
    assert over["transit"] == 200  # the transit tax has no wage base
