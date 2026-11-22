"""West Virginia, 2026: IT-100.2A Tables for Percentage Method of Withholding (March 2026), annual tables.

Annual wages less $2,000 per exemption; two-earner table unless the employee checked line 5
of the IT-104 (one earner); the result per pay period rounded to the nearest dollar.
"""

from __future__ import annotations

from .helpers import withhold


def test_two_earner_biweekly_one_exemption() -> None:
    # $2,000 bi-weekly: 52,000 - 2,000 = 50,000; 1,462.88 + 4.58% x 5,000 = 1,691.88 / 26 = 65.07 -> $65
    # (bi-weekly table: 56.27 + 4.58% x (1,923.08 - 1,731) = 65.07)
    assert withhold("WV", 2026, wages_cents=200_000, periods=26, cert={"allowances": 1}) == {"sit": 6500}


def test_one_earner_biweekly_one_exemption() -> None:
    # One-earner: 50,000 -> 1,106.50 + 4.22% x 10,000 = 1,528.50 / 26 = 58.79 -> $59
    cert = {"status": "one", "allowances": 1}
    assert withhold("WV", 2026, wages_cents=200_000, periods=26, cert=cert) == {"sit": 5900}


def test_no_certificate_uses_two_earner_table_and_no_exemptions() -> None:
    # $500 a week: 26,000 -> 474.38 + 3.16% x 7,250 = 703.48 / 52 = 13.53 -> $14
    assert withhold("WV", 2026, wages_cents=50_000, periods=52) == {"sit": 1400}
