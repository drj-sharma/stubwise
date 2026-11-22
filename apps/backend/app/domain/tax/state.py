"""State taxes on wages, worked out from the rules in the tax_rules table.

Every state (and DC) has an ``income`` rule; most also have worker-paid
contributions or local taxes. Which of them apply, and their figures, come
from the rules passed in (``rules``: the state's rows for the pay date's
year); nothing here is a tax figure.

Each tax becomes one stub line with its own tax code:

- ``sit``: state income tax
- ``sdi``, ``fli``, ``pfml``, ``ui``, ``ltc``, ``transit``: contributions
- ``local:<place>``: a county or city tax

A rule with method ``manual`` becomes a line with no amount for the employer
to type, so the stub still shows the tax.
"""

from __future__ import annotations

import importlib
from collections.abc import Sequence
from functools import cache
from typing import Any, Literal, TypedDict

from ..money import Cents
from ..us_states import us_state_name
from .contributions import capped_rate, local_rate
from .states._common import StateInput, Withheld


class TaxLine(TypedDict):
    code: str
    label: str
    cents: Cents
    typed: bool
    """True when the employer types the figure (the server does not calculate this tax yet)."""


Support = Literal["none", "manual", "calculated"]

DEFAULT_LABELS = {
    "income": "{state} income tax",
    "sdi": "{state} disability insurance",
    "fli": "{state} family leave insurance",
    "pfml": "{state} paid leave",
    "ui": "{state} unemployment",
    "ltc": "{state} long-term care",
    "transit": "{state} transit tax",
    "local": "Local income tax",
}
TAX_CODE = {"income": "sit", "sdi": "sdi", "fli": "fli", "pfml": "pfml", "ui": "ui", "ltc": "ltc", "transit": "transit"}


@cache
def _formula(state: str) -> Any:
    """The state's own formula module (app/domain/tax/states/<state>.py)."""
    return importlib.import_module(f"{__package__}.states.{state.lower()}").withhold


def in_force(params: dict[str, Any], pay_date: str | None) -> dict[str, Any]:
    """A rule's figures as they stood on the pay date.

    A rule's ``params`` hold the latest figures. When a state changed them
    during the year, ``params["earlier"]`` lists the figures that applied
    before: ``[{"until": "2026-05-10", "params": {...}}]``, each covering pay
    dates up to and including ``until``. The earliest entry that still covers
    the pay date is laid over the latest figures (key by key, so it need only
    name what changed). With no pay date the latest figures apply.
    """
    earlier = params.get("earlier") or []
    if not pay_date or not earlier:
        return params
    for entry in sorted(earlier, key=lambda item: item["until"]):
        if pay_date <= entry["until"]:
            merged = {**params, **entry["params"]}
            merged.pop("earlier", None)
            return merged
    return params


def _label(rule: dict[str, Any], state: str) -> str:
    template = rule["params"].get("label") or DEFAULT_LABELS[rule["tax"]]
    return template.replace("{state}", us_state_name(state))


def state_taxes(rules: Sequence[dict[str, Any]], state: str, inp: StateInput) -> list[TaxLine]:
    """Every state and local tax line for one pay period, income tax first."""
    if not rules:
        # A year whose rules have not been loaded: leave the state tax for the employer to type.
        return [
            {
                "code": "sit",
                "label": DEFAULT_LABELS["income"].replace("{state}", us_state_name(state)),
                "cents": 0,
                "typed": True,
            }
        ]
    lines: list[TaxLine] = []
    ordered = sorted(rules, key=lambda rule: (rule["tax"] != "income", rule["tax"]))
    for rule in ordered:
        method, tax = rule["method"], rule["tax"]
        params = in_force(rule["params"], inp.pay_date)
        rule = {**rule, "params": params}
        if method == "none":
            continue
        if method == "manual":
            code = TAX_CODE.get(tax, "local")
            lines.append({"code": code, "label": _label(rule, state), "cents": 0, "typed": True})
            continue
        if tax == "income":
            lines.extend(_income(rule, state, inp))
        elif method == "capped_rate":
            found = capped_rate({"code": TAX_CODE.get(tax, tax), "label": _label(rule, state), **params}, inp)
            if found:
                lines.append({"code": found[0], "label": found[1], "cents": found[2], "typed": False})
        elif method == "local_rate":
            for code, label, cents in local_rate(params, inp):
                lines.append({"code": code, "label": label, "cents": cents, "typed": False})
        else:
            raise ValueError(f"{state} {tax}: method {method!r} cannot be applied")
    return lines


def _income(rule: dict[str, Any], state: str, inp: StateInput) -> list[TaxLine]:
    label = _label(rule, state)
    if rule["method"] != "state":
        raise ValueError(f"{state} income: method {rule['method']!r} cannot be applied")
    if inp.cert.get("exempt"):
        return [{"code": "sit", "label": label, "cents": 0, "typed": False}]
    if inp.wages_cents <= 0:
        # Nothing is withheld on a pay period with no pay, extra amount included.
        withheld = Withheld(0)
    else:
        withheld = _formula(state)(rule["params"], inp)
        withheld = Withheld(max(0, withheld.cents) + inp.cert.get("extraWithholdingCents", 0), withheld.extra_lines)
    lines: list[TaxLine] = [{"code": "sit", "label": label, "cents": withheld.cents, "typed": False}]
    lines.extend(
        {"code": code, "label": text, "cents": cents, "typed": False} for code, text, cents in withheld.extra_lines
    )
    return lines


def state_tax_support(rules: Sequence[dict[str, Any]]) -> Support:
    """How a state's income tax is handled: no tax, typed by the employer, or calculated."""
    income = next((rule for rule in rules if rule["tax"] == "income"), None)
    if income is None:
        return "manual"
    return {"none": "none", "manual": "manual"}.get(income["method"], "calculated")  # type: ignore[return-value]


def calculated_codes(rules: Sequence[dict[str, Any]]) -> set[str]:
    """Tax codes the server works out for this state (so a typed figure for one is an override)."""
    codes: set[str] = set()
    for rule in rules:
        if rule["method"] in ("none", "manual"):
            continue
        if rule["tax"] == "local":
            codes.update(f"local:{key}"[:20] for key in rule["params"].get("localities", {}))
            codes.update(rule["params"].get("extraCodes", []))
        else:
            codes.add(TAX_CODE.get(rule["tax"], rule["tax"]))
        if rule["tax"] == "income":
            codes.update(rule["params"].get("extraCodes", []))
    return codes
