"""Behaviour of the calculation port that the generated vectors do not reach."""

from __future__ import annotations

import pytest

from app.domain import money
from app.domain.calc_stub import line_key
from app.domain.pay_period import is_iso_date, next_period
from app.domain.tax.state import state_tax_support, state_taxes
from app.domain.tax.states._common import StateInput
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_TAX_PROFILE, DEFAULT_W4, normalize_tax_profile
from app.domain.time import format_clock, format_duration, overtime_rate_cents, pay_for_minutes, to_minutes
from app.tax_rules.store import seed_files


def test_rounding_is_half_away_from_zero() -> None:
    assert money.div_round_half_up(5, 2) == 3
    assert money.div_round_half_up(-5, 2) == -3
    assert money.div_round_half_up(1, 3) == 0
    assert pay_for_minutes(76 * 60 + 45, 2400) == 184200
    assert pay_for_minutes(1, 1830) == 31  # 30.5 cents rounds up
    assert overtime_rate_cents(2401) == 3602  # 3601.5 rounds up
    for bad in ((1, 0), (1.5, 2), (True, 2), (1, -3)):
        with pytest.raises(ValueError):
            money.div_round_half_up(*bad)  # type: ignore[arg-type]


def test_money_and_time_formatting() -> None:
    assert money.format_cents(161571) == "$1,615.71"
    assert money.format_cents(-42729) == "-$427.29"
    assert money.parse_dollars("$1,842.5") == 184250
    assert money.parse_dollars("75") == 7500
    assert money.parse_dollars("1.234") is None
    assert money.parse_dollars("abc") is None
    assert to_minutes(7, 45) == 465
    assert (format_duration(4605), format_clock(4605)) == ("76 h 45 min", "76:45")
    with pytest.raises(ValueError):
        pay_for_minutes(-1, 100)
    with pytest.raises(ValueError):
        overtime_rate_cents(1000, 99)


def test_line_keys_ignore_case_and_spacing_the_way_javascript_does() -> None:
    assert line_key("earning", "  Health   Insurance ") == "earning:health insurance"
    # No-break space, ideographic space and the BOM are white space to JavaScript's trim() and regexes.
    assert line_key("earning", "\u00a0Regular\u3000pay\ufeff") == "earning:regular pay"
    # U+0085 and U+001F are white space to Python's strip() but not to JavaScript; they must be kept.
    assert line_key("earning", "\u0085Regular\u001f") == "earning:\u0085regular\u001f"


def test_dates() -> None:
    assert is_iso_date("2028-02-29")
    assert not is_iso_date("2027-02-29")
    assert not is_iso_date("2026-1-01")
    assert next_period({"start": "2026-01-31", "end": "2026-02-27"}, "monthly") == {
        "start": "2026-02-28",
        "end": "2026-03-27",
    }
    with pytest.raises(ValueError):
        next_period({"start": "2026-02-10", "end": "2026-02-01"}, "weekly")


def test_tax_profiles_are_normalised() -> None:
    assert normalize_tax_profile(None) == DEFAULT_TAX_PROFILE
    assert normalize_tax_profile("nonsense") == DEFAULT_TAX_PROFILE
    assert normalize_tax_profile({"calculate": False, "state": "ZZ", "w4": {"filingStatus": "widowed"}}) == {
        "calculate": False,
        "state": None,
        "w4": DEFAULT_W4,
        "stateW4": DEFAULT_STATE_W4,
    }
    messy = {"stateW4": {"allowances": 3, "additionalAllowances": 100, "extraWithholdingCents": -5, "exempt": 1}}
    assert normalize_tax_profile(messy)["stateW4"] == {**DEFAULT_STATE_W4, "allowances": 3}
    # The defaults handed out are copies: changing one must not change the next worker's.
    normalize_tax_profile(None)["w4"]["exempt"] = True
    assert DEFAULT_W4["exempt"] is False


def _seed(state: str, year: int = 2026) -> list[dict]:
    return [dict(rule) for rule in seed_files() if rule["jurisdiction"] == state and rule["year"] == year]


def _nc(wages_cents: int, cert: dict | None = None) -> list:
    inp = StateInput(
        year=2026,
        wages_cents=wages_cents,
        periods_per_year=26,
        w4=DEFAULT_W4,
        cert={**DEFAULT_STATE_W4, **(cert or {})},
    )
    return state_taxes(_seed("NC"), "NC", inp)


def test_state_rules_come_from_the_rules_table_seed() -> None:
    assert state_tax_support(_seed("TX")) == "none"
    assert state_tax_support(_seed("PA")) == "calculated"
    assert state_tax_support(_seed("PA", 2027)) == "manual"
    assert _seed("NC")[0]["params"]["round"] == "dollar"
    # North Carolina, NC-30 annualised method: whole dollars, extra withholding on top, nothing on a zero check.
    extra = {"allowances": 1, "extraWithholdingCents": 1000}
    assert _nc(200_000, extra)[0]["cents"] == 6800
    assert _nc(0, extra)[0]["cents"] == 0
    assert _nc(200_000, {**extra, "exempt": True})[0]["cents"] == 0
    assert _nc(200_000)[0]["cents"] == 6200  # no certificate on file


def test_a_rule_the_server_cannot_apply_raises_rather_than_withholding_nothing() -> None:
    rules = [{"tax": "income", "method": "brackets", "params": {}, "source": "", "revision": 1}]
    inp = StateInput(year=2026, wages_cents=100_000, periods_per_year=26, w4=DEFAULT_W4, cert=dict(DEFAULT_STATE_W4))
    with pytest.raises(ValueError, match="cannot be applied"):
        state_taxes(rules, "CA", inp)


def test_every_seed_file_is_valid_and_every_state_has_an_income_rule() -> None:
    rules = seed_files()
    states = {rule["jurisdiction"] for rule in rules if rule["tax"] == "income" and rule["year"] == 2026}
    assert len(states) == 51


def test_figures_changed_during_the_year_follow_the_pay_date() -> None:
    rules = [
        {
            "tax": "income",
            "method": "state",
            "source": "",
            "revision": 1,
            "params": {
                "ratePercent": "4.99",
                "earlier": [
                    {"until": "2026-05-10", "params": {"ratePercent": "5.19"}},
                    {"until": "2026-02-28", "params": {"ratePercent": "6"}},
                ],
            },
        }
    ]

    def withheld(pay_date: str | None) -> int:
        inp = StateInput(
            year=2026,
            wages_cents=100_000,
            periods_per_year=52,
            w4=DEFAULT_W4,
            cert=dict(DEFAULT_STATE_W4),
            pay_date=pay_date,
        )
        return state_taxes(rules, "PA", inp)[0]["cents"]  # PA's module is the plain annualized formula

    assert withheld("2026-02-27") == 6000
    assert withheld("2026-05-10") == 5190
    assert withheld("2026-05-11") == 4990
    assert withheld(None) == 4990
