"""New Mexico, 2026: FYI-104 (Rev. 11/2025), tables for the percentage method of withholding.

The status is the federal W-4's (New Mexico has no form of its own); no W-4 means single.
"""

from __future__ import annotations

from .helpers import withhold


def test_fyi_104_example() -> None:
    # FYI-104 page 2: married, $1,000 weekly, $20 additional.
    # Table 1(b): $12.77 + 4.3% x ($1,000 - $790) = $21.80; plus $20.00 = $41.80
    married = {"filingStatus": "married"}
    assert withhold("NM", 2026, wages_cents=100_000, periods=52, w4=married) == {"sit": 2180}
    assert withhold("NM", 2026, wages_cents=100_000, periods=52, w4=married, cert={"extraWithholdingCents": 2000}) == {
        "sit": 4180
    }


def test_no_w4_uses_the_single_table() -> None:
    # Table 2(a), $2,000 biweekly: $44.83 + 4.7% x ($2,000 - $1,598) = $63.724 -> $63.72
    assert withhold("NM", 2026, wages_cents=200_000, periods=26) == {"sit": 6372}
    # Table 3(a), $1,000 semimonthly: $12.77 + 3.2% x ($1,000 - $856) = $17.378 -> $17.38
    assert withhold("NM", 2026, wages_cents=100_000, periods=24) == {"sit": 1738}
    # Table 1(a): $150 a week is not over $155
    assert withhold("NM", 2026, wages_cents=15_000, periods=52) == {"sit": 0}


def test_head_of_household() -> None:
    # Table 4(c), $3,000 monthly: $31.33 + 3.2% x ($3,000 - $2,340) = $52.45
    assert withhold("NM", 2026, wages_cents=300_000, periods=12, w4={"filingStatus": "head"}) == {"sit": 5245}
