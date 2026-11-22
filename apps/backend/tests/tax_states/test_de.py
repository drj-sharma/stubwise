"""Delaware, 2026: Employer's Guide, Section 17 (Computing Withholding Taxes), formula
(tax computation table effective January 1, 2025; no 2026 change), and the Wilmington wage tax.

Annual wages less the standard deduction ($3,250 single or married filing separately,
$6,500 married filing jointly); tax from the table; less $110 per exemption; / periods.
"""

from __future__ import annotations

from .helpers import withhold


def test_section_17_example_single_one_exemption() -> None:
    # Section 17 example: $25,000 a year, single, 1 exemption: 21,750 taxable; tax $832;
    # less $110 = $722; weekly $13.88, bi-weekly $27.77, semi-monthly $30.08, monthly $60.17.
    cert = {"allowances": 1}
    assert withhold("DE", 2026, wages_cents=2_500_000, periods=1, cert=cert) == {"sit": 72200}
    assert withhold("DE", 2026, wages_cents=48_077, periods=52, cert=cert) == {"sit": 1388}
    assert withhold("DE", 2026, wages_cents=96_154, periods=26, cert=cert) == {"sit": 2777}
    assert withhold("DE", 2026, wages_cents=104_167, periods=24, cert=cert) == {"sit": 3008}
    assert withhold("DE", 2026, wages_cents=208_333, periods=12, cert=cert) == {"sit": 6017}


def test_no_certificate_single_no_allowances() -> None:
    # $1,000 a week: 52,000 - 3,250 = 48,750; 1,001 + 5.55% x 23,750 = 2,319.13 / 52 = $44.60
    assert withhold("DE", 2026, wages_cents=100_000, periods=52) == {"sit": 4460}


def test_married_filing_jointly_two_exemptions() -> None:
    # $3,000 bi-weekly: 78,000 - 6,500 = 71,500; 2,943.50 + 6.6% x 11,500 = 3,702.50;
    # less 2 x $110 = 3,482.50 / 26 = $133.94
    cert = {"status": "married", "allowances": 2}
    assert withhold("DE", 2026, wages_cents=300_000, periods=26, cert=cert) == {"sit": 13394}


def test_wilmington_wage_tax() -> None:
    lines = withhold("DE", 2026, wages_cents=100_000, periods=52, cert={"localities": ["WILMINGTON"]})
    assert lines == {"sit": 4460, "local:WILMINGTON": 1250}
