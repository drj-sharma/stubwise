"""Virginia, 2026: Employer Withholding Instructions (Rev. 10/26), formula for wages paid after July 1, 2025.

T = wages x periods - ($8,750 + $930 per personal exemption + $800 per age/blind exemption);
W from 2% / 3% / 5% / 5.75% brackets; W / periods. The guide's example rounds W to the dollar.
"""

from __future__ import annotations

from .helpers import withhold


def test_guide_example_semi_monthly_five_exemptions() -> None:
    # Guide p. 22: $2,649 semi-monthly, 5 exemptions: T = 63,576 - 13,400 = 50,176;
    # W = 720 + 5.75% x 33,176 = $2,628; / 24 = $109.50
    assert withhold("VA", 2026, wages_cents=264_900, periods=24, cert={"allowances": 5}) == {"sit": 10950}


def test_no_va4_withholds_as_if_no_exemptions() -> None:
    # $1,000 a week: T = 52,000 - 8,750 = 43,250; W = 720 + 5.75% x 26,250 = 2,229.38 -> $2,229;
    # / 52 = $42.87
    assert withhold("VA", 2026, wages_cents=100_000, periods=52) == {"sit": 4287}


def test_age_and_blindness_exemption() -> None:
    # $1,500 bi-weekly, 1 personal + 1 age exemption: T = 39,000 - 8,750 - 930 - 800 = 28,520;
    # W = 720 + 5.75% x 11,520 = 1,382.40 -> $1,382; / 26 = $53.15
    cert = {"allowances": 1, "additionalAllowances": 1}
    assert withhold("VA", 2026, wages_cents=150_000, periods=26, cert=cert) == {"sit": 5315}
