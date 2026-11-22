"""Behaviour of the calculation port that the generated vectors do not reach."""

from __future__ import annotations

import pytest

from app.domain import money
from app.domain.calc_stub import line_key
from app.domain.pay_period import is_iso_date, next_period
from app.domain.tax import data
from app.domain.tax.state import state_income_tax, state_rule, state_tax_support
from app.domain.tax.types import DEFAULT_STATE_W4, DEFAULT_TAX_PROFILE, DEFAULT_W4, normalize_tax_profile
from app.domain.time import format_clock, format_duration, overtime_rate_cents, pay_for_minutes, to_minutes


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


def test_state_rules_come_from_the_data_file() -> None:
    assert state_tax_support("TX", 2026) == "none"
    assert state_tax_support("PA", 2026) == "calculated"
    assert state_tax_support("PA", 2027) == "manual"
    assert state_rule("NC", 2026)["round"] == "dollar"
    assert state_rule("CA", 2026) is None
    # North Carolina, NC-30 annualised method: whole dollars, extra withholding on top, nothing on a zero check.
    nc = {"state": "NC", "year": 2026, "periods_per_year": 26, "w4": DEFAULT_W4}
    extra = {**DEFAULT_STATE_W4, "allowances": 1, "extraWithholdingCents": 1000}
    assert state_income_tax(**nc, wages_cents=200_000, state_w4=extra) == {"kind": "amount", "cents": 6800}
    assert state_income_tax(**nc, wages_cents=0, state_w4=extra) == {"kind": "amount", "cents": 0}
    assert state_income_tax(**nc, wages_cents=200_000, state_w4={**extra, "exempt": True})["cents"] == 0
    assert state_income_tax(**nc, wages_cents=200_000)["cents"] == 6200  # no certificate on file


def test_an_unknown_kind_of_state_rule_stops_the_server(monkeypatch: pytest.MonkeyPatch) -> None:
    bracket_rule = {"kind": "brackets", "round": "cent", "rateBasisPoints": 100}
    monkeypatch.setitem(data.STATE_RULES[2026], "CA", bracket_rule)
    with pytest.raises(RuntimeError, match="CA 2026 has state rule kind 'brackets'"):
        data._check_state_rules()
    # And if one ever got past start-up, calculating with it raises rather than returning zero.
    with pytest.raises(ValueError, match="Unknown state rule kind"):
        state_income_tax(state="CA", year=2026, wages_cents=100_000, periods_per_year=26, w4=DEFAULT_W4)
