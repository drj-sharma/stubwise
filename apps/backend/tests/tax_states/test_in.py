"""Indiana, 2026: state and county income tax are typed by the employer for now.

Departmental Notice #1 (the state rate, exemption amounts and the county rate chart) could
not be read from the Indiana Department of Revenue's site, so neither tax is calculated.
"""

from __future__ import annotations

from .helpers import withhold


def test_state_and_county_tax_are_typed() -> None:
    assert withhold("IN", 2026, wages_cents=100_000, periods=52) == {"sit": "typed", "local": "typed"}
