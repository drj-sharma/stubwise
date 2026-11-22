"""Mississippi, 2026: Computer Payroll Accounting flowchart "For Periods In 2026" (revised 8/13/25).

TI = annual pay - (89-350 Line 6 exemption + standard deduction); tax = 4% of TI over $10,000;
per period = tax / periods, rounded to whole dollars. Standard deduction: single $2,300,
married $4,600, married with spouse employed $2,300, head of family $3,400.

The flowchart has no worked example, so these are worked by hand from it.
"""

from __future__ import annotations

from .helpers import withhold


def test_single_with_6000_exemption_biweekly() -> None:
    # $2,000 bi-weekly: 52,000 - (6,000 + 2,300) = 43,700; (43,700 - 10,000) x 4% = 1,348.00;
    # 1,348 / 26 = 51.85 -> $52
    cert = {"status": "S", "options": {"exemptionCents": 600_000}}
    assert withhold("MS", 2026, wages_cents=200_000, periods=26, cert=cert) == {"sit": 5200}


def test_no_certificate_is_single_with_no_exemption() -> None:
    # DOR: withhold as single with no exemptions. $2,000 bi-weekly: 52,000 - 2,300 = 49,700;
    # 39,700 x 4% = 1,588; / 26 = 61.08 -> $61
    assert withhold("MS", 2026, wages_cents=200_000, periods=26) == {"sit": 6100}


def test_married_spouse_not_employed_monthly() -> None:
    # $5,000 monthly, $12,000 + 2 dependents x $1,500 = $15,000 exemption:
    # 60,000 - (15,000 + 4,600) = 40,400; 30,400 x 4% = 1,216; / 12 = 101.33 -> $101
    cert = {"status": "M", "options": {"exemptionCents": 1_500_000}}
    assert withhold("MS", 2026, wages_cents=500_000, periods=12, cert=cert) == {"sit": 10100}


def test_married_spouse_employed_uses_half_deduction() -> None:
    # $1,000 weekly, $6,000 exemption: 52,000 - (6,000 + 2,300) = 43,700; 1,348 / 52 = 25.92 -> $26
    cert = {"status": "B", "options": {"exemptionCents": 600_000}}
    assert withhold("MS", 2026, wages_cents=100_000, periods=52, cert=cert) == {"sit": 2600}


def test_taxable_income_under_10000_withholds_nothing() -> None:
    # $1,500 monthly, single, $6,000: 18,000 - 8,300 = 9,700, under $10,000.
    cert = {"status": "S", "options": {"exemptionCents": 600_000}}
    assert withhold("MS", 2026, wages_cents=150_000, periods=12, cert=cert) == {"sit": 0}
