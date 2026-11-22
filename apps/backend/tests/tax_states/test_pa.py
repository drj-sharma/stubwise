"""Pennsylvania, 2026.

- Income tax: a flat 3.07% of compensation, no exemptions (PA Department of Revenue,
  Employer Withholding).
- Worker unemployment compensation withholding: 0.07% of all gross wages, no cap
  ("70 cents per $1,000 gross wages", PA L&I UC Tax, Yearly Tax Highlights, calendar year 2026).
- Philadelphia Wage Tax: 3.74% residents, 3.43% non-residents from July 1, 2025 (pay dated
  January to June 2026); 3.735% and 3.425% from July 1, 2026 (City of Philadelphia, Wage Tax
  for employers, rate table).
- Pittsburgh earned income tax: residents 3% (city 1% + school district 2%); non-Pennsylvania
  residents working in the city 1% (City of Pittsburgh, Taxes, updated 03/05/2026).
"""

from __future__ import annotations

from app.domain.tax.state import state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_W4

from .helpers import rules_for, withhold


def test_flat_rate_and_uc_withholding() -> None:
    # $1,000 a week: 3.07% = $30.70; UC 0.07% = $0.70 (70 cents per $1,000).
    assert withhold("PA", 2026, wages_cents=100_000, periods=52) == {"sit": 3070, "ui": 70}


def test_uc_withholding_has_no_wage_cap() -> None:
    # $5,000 biweekly with $200,000 already paid this year: still 0.07% = $3.50.
    lines = withhold("PA", 2026, wages_cents=500_000, periods=26, prior_ytd_wages_cents=20_000_000)
    assert lines["ui"] == 350
    assert lines["sit"] == 15350


def test_uc_rounding() -> None:
    # $1,234.56 x 0.07% = $0.864192 -> $0.86; x 3.07% = $37.900992 -> $37.90.
    assert withhold("PA", 2026, wages_cents=123_456, periods=26) == {"sit": 3790, "ui": 86}


def test_certificate_allowances_do_not_reduce_pa_tax() -> None:
    assert withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"allowances": 3})["sit"] == 3070


def test_philadelphia_wage_tax() -> None:
    assert withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"localities": ["PHL-R"]}) == {
        "sit": 3070,
        "ui": 70,
        "local:PHL-R": 3735,
    }
    assert withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"localities": ["PHL-N"]})["local:PHL-N"] == 3425


def test_pittsburgh_eit() -> None:
    assert withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"localities": ["PIT-R"]})["local:PIT-R"] == 3000
    assert withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"localities": ["PIT-N"]})["local:PIT-N"] == 1000


def test_exempt_from_income_tax_still_pays_uc_and_local() -> None:
    lines = withhold("PA", 2026, wages_cents=100_000, periods=52, cert={"exempt": True, "localities": ["PHL-R"]})
    assert lines == {"sit": 0, "ui": 70, "local:PHL-R": 3735}


def test_philadelphia_rate_follows_the_pay_date() -> None:
    def local(code: str, pay_date: str) -> int:
        inp = StateInput(
            year=2026,
            wages_cents=100_000,
            periods_per_year=52,
            w4=DEFAULT_W4,
            cert={**DEFAULT_STATE_W4, "localities": [code]},
            pay_date=pay_date,
        )
        return next(
            line["cents"] for line in state_taxes(rules_for("PA", 2026), "PA", inp) if line["code"] == f"local:{code}"
        )

    # Rates from July 1, 2025 apply to pay dated up to June 30, 2026.
    assert local("PHL-R", "2026-03-15") == 3740
    assert local("PHL-N", "2026-03-15") == 3430
    assert local("PHL-R", "2026-06-30") == 3740
    # From July 1, 2026.
    assert local("PHL-R", "2026-07-01") == 3735
    assert local("PHL-N", "2026-07-01") == 3425
    # Pittsburgh did not change.
    assert local("PIT-R", "2026-03-15") == 3000
