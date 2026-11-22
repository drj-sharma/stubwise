"""Shared pieces for the state withholding formulas in this package.

Every state module exports ``withhold(params, inp) -> Withheld``: what to
withhold for one pay period, worked out from its own figures in ``params``
(the ``params`` of its ``income`` row in the tax_rules table). Nothing in a
state module is a tax figure: rates, brackets, deductions and allowance
amounts all come from ``params``.

Arithmetic is exact (``Fraction``) until the one rounding the state's guide
asks for. Rates in ``params`` are percent strings ("4.95"), amounts are
integer cents, so nothing passes through a float.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any

from ...money import Cents
from ..types import W4, StateW4


@dataclass(frozen=True)
class StateInput:
    """What a state formula can use for one pay period."""

    year: int
    wages_cents: Cents
    """Taxable wages this pay period."""
    periods_per_year: int
    w4: W4
    """The federal Form W-4."""
    cert: StateW4
    """The state's own certificate, as entered (defaults when none is on file)."""
    federal_tax_cents: Cents = 0
    """Federal income tax withheld this pay period (for states that let it be subtracted)."""
    prior_ytd_wages_cents: Cents = 0
    """Wages paid earlier this calendar year."""
    fica_cents: Cents = 0
    """Social Security and Medicare withheld this pay period."""
    pay_date: str | None = None
    """The stub's pay date (YYYY-MM-DD), which picks the figures in force when a state changed them mid-year."""

    @property
    def annual_wages(self) -> Fraction:
        return Fraction(max(0, self.wages_cents) * self.periods_per_year)


@dataclass
class Withheld:
    """One or more tax lines from a state formula. ``cents`` is the state income tax line."""

    cents: Cents
    extra_lines: list[tuple[str, str, Cents]] = field(default_factory=list)
    """Further lines the same formula produces: (tax code, label, cents), such as an Indiana county tax."""


def pct(value: str | int) -> Fraction:
    """A percent from the rules, exactly: "4.95" -> 99/2000."""
    return Fraction(str(value)) / 100


def status_of(params: Mapping[str, Any], inp: StateInput) -> str:
    """The status used to pick this state's figures.

    The state certificate's own status when the worker gave one; otherwise the
    federal W-4 status mapped through ``params["statusFromFederal"]``; otherwise
    ``params["defaultStatus"]``.
    """
    statuses = params.get("statuses")
    own = inp.cert.get("status")
    if own and (not statuses or own in statuses):
        return own
    mapping = params.get("statusFromFederal") or {}
    if inp.w4["filingStatus"] in mapping:
        return mapping[inp.w4["filingStatus"]]
    return params.get("defaultStatus", "single")


def by_status(table: Mapping[str, Any] | Any, status: str) -> Any:
    """``table[status]`` when the figure varies by status, the figure itself when it does not."""
    if isinstance(table, Mapping):
        if status in table:
            return table[status]
        if "*" in table:
            return table["*"]
        raise KeyError(f"no figure for status {status!r}")
    return table


def bracket_tax(taxable: Fraction, rows: Sequence[Sequence[Any]]) -> Fraction:
    """Graduated tax on an annual amount.

    ``rows`` are ``[over_cents, rate_percent]`` in ascending order: the rate
    applies to the part of ``taxable`` above ``over_cents`` and up to the next
    row's ``over_cents``.
    """
    if taxable <= 0:
        return Fraction(0)
    tax = Fraction(0)
    for index, (over, rate) in enumerate(rows):
        upper = rows[index + 1][0] if index + 1 < len(rows) else None
        if taxable <= over:
            break
        top = taxable if upper is None else min(taxable, Fraction(upper))
        tax += (top - over) * pct(rate)
    return tax


def round_half_up(value: Fraction) -> int:
    """To the nearest whole unit, halves away from zero (value is never negative here)."""
    return int((value * 2 + 1) // 2) if value >= 0 else -int((-value * 2 + 1) // 2)


def per_period(annual_tax: Fraction, inp: StateInput, rounding: str = "cent") -> Cents:
    """The annual figure divided back to one pay period.

    ``cent``: rounded to the cent. ``dollar``: rounded to the whole dollar (some
    states' guides round the period amount). ``annual-dollar``: the annual tax
    rounded to the dollar first, then divided and rounded to the cent.
    """
    annual_tax = max(Fraction(0), annual_tax)
    if rounding == "annual-dollar":
        annual_tax = Fraction(round_half_up(annual_tax / 100) * 100)
    amount = annual_tax / inp.periods_per_year
    if rounding == "dollar":
        return round_half_up(amount / 100) * 100
    return round_half_up(amount)


def count(inp: StateInput, field_name: str) -> int:
    """A number from the state certificate, 0 when absent."""
    value = inp.cert.get(field_name)
    if field_name in ("allowances", "additionalAllowances", "dependents"):
        return int(value or 0)
    options = inp.cert.get("options") or {}
    raw = options.get(field_name, 0)
    return int(raw) if isinstance(raw, int | str) and str(raw).lstrip("-").isdigit() else 0


def option(inp: StateInput, name: str, default: Any = None) -> Any:
    """A state-specific answer from the certificate (``cert["options"][name]``)."""
    return (inp.cert.get("options") or {}).get(name, default)


def annualized(params: Mapping[str, Any], inp: StateInput) -> Withheld:
    """The common shape of a state percentage method, driven entirely by ``params``:

    1. annual wages = wages x pay periods
    2. less ``standardDeductionCents`` (by status, or one figure)
    3. less, for each certificate field in ``perField`` (``allowances``,
       ``additionalAllowances``, ``dependents``, or an ``options`` key), that
       count x the amount (by status, or one figure)
    4. tax: ``ratePercent`` of what is left, or ``brackets`` (by status) on it
    5. less ``creditCents`` (by status, or one figure) and, for each field in
       ``creditPerField``, count x that credit
    6. divided by pay periods, rounded as ``round`` says (``cent`` by default)

    A state whose guide works this way needs only its figures; one that does
    something more writes its own steps, reusing the pieces above.
    """
    status = status_of(params, inp)
    taxable = inp.annual_wages - by_status(params.get("standardDeductionCents", 0), status)
    for field_name, amount in (params.get("perField") or {}).items():
        taxable -= count(inp, field_name) * by_status(amount, status)
    taxable = max(Fraction(0), taxable)
    if "ratePercent" in params:
        tax = taxable * pct(by_status(params["ratePercent"], status))
    else:
        tax = bracket_tax(taxable, by_status(params["brackets"], status))
    tax -= by_status(params.get("creditCents", 0), status)
    for field_name, amount in (params.get("creditPerField") or {}).items():
        tax -= count(inp, field_name) * by_status(amount, status)
    return Withheld(per_period(max(Fraction(0), tax), inp, params.get("round", "cent")))
