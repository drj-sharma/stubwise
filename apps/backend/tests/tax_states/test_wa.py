"""Washington, 2026: no income tax. Paid Family and Medical Leave: ESD Employer Toolkit v25.1 (June
2026), "Gross wages x 0.0113 x 0.7143 = Employee Share" up to the $184,500 Social Security cap.
WA Cares: 0.58% of all wages, not charged to workers with an approved exemption.
"""

from __future__ import annotations

from .helpers import withhold


def test_paid_leave_and_wa_cares() -> None:
    # $1,000 a week: 1,000 x 0.0113 x 0.7143 = 8.071590 -> $8.07; 1,000 x 0.0058 = $5.80.
    assert withhold("WA", 2026, wages_cents=100_000, periods=52) == {"pfml": 807, "ltc": 580}


def test_paid_leave_stops_at_social_security_cap() -> None:
    # $184,000 paid before: $500 of this $2,000 is under $184,500 -> 500 x 0.0113 x 0.7143 = $4.04.
    # WA Cares has no cap: 2,000 x 0.0058 = $11.60.
    lines = withhold("WA", 2026, wages_cents=200_000, periods=52, prior_ytd_wages_cents=18_400_000)
    assert lines == {"pfml": 404, "ltc": 1_160}
    lines = withhold("WA", 2026, wages_cents=200_000, periods=52, prior_ytd_wages_cents=18_450_000)
    assert lines == {"pfml": 0, "ltc": 1_160}


def test_wa_cares_exemption() -> None:
    lines = withhold("WA", 2026, wages_cents=100_000, periods=52, cert={"options": {"ltc": False}})
    assert lines == {"pfml": 807}
