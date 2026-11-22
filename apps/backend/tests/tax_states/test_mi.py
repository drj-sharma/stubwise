"""Michigan, 2026: withholding rate 4.25%, personal exemption $5,900 per MI-W4 exemption
(Michigan Treasury, "Withholding Tax Information by Calendar Year"; Form 446).

Withholding = (annual wages - exemptions x $5,900) x 4.25% / pay periods. No MI-W4 on file:
no exemptions (Mich. Admin. Code R 206.24). City taxes are the city's rate on the period's wages.
No published worked example was available; the cases below are worked by hand.
"""

from __future__ import annotations

from .helpers import withhold


def test_no_mi_w4_withholds_without_exemptions() -> None:
    # $1,000 a week, no MI-W4: 52,000 x 4.25% / 52 = $42.50.
    assert withhold("MI", 2026, wages_cents=100_000, periods=52) == {"sit": 4250}


def test_biweekly_two_exemptions() -> None:
    # $2,000 every two weeks, 2 exemptions: (52,000 - 11,800) x 4.25% = 1,708.50; / 26 = 65.7115 -> $65.71.
    assert withhold("MI", 2026, wages_cents=200_000, periods=26, cert={"allowances": 2}) == {"sit": 6571}


def test_detroit_resident() -> None:
    # $1,000 a week, Detroit resident: 2.4% x 1,000 = $24.00.
    lines = withhold("MI", 2026, wages_cents=100_000, periods=52, cert={"localities": ["DETROIT-R"]})
    assert lines == {"sit": 4250, "local:DETROIT-R": 2400}


def test_grand_rapids_nonresident() -> None:
    # $1,000 a week, works in Grand Rapids, lives elsewhere: 0.75% x 1,000 = $7.50.
    lines = withhold("MI", 2026, wages_cents=100_000, periods=52, cert={"localities": ["GRANDRAPIDS-N"]})
    assert lines["local:GRANDRAPIDS-N"] == 750


def test_detroit_nonresident_and_unknown_city() -> None:
    # Detroit nonresident: 1.2% x 1,000 = $12.00; a code that is not in the rules gives no line.
    lines = withhold("MI", 2026, wages_cents=100_000, periods=52, cert={"localities": ["DETROIT-N", "NOWHERE-R"]})
    assert lines == {"sit": 4250, "local:DETROIT-N": 1200}
