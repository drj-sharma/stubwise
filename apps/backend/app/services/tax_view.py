"""Every tax figure the server uses, laid out for people to read.

The calculations read the rules as data; this turns the same data into
sections of labelled values and tables (brackets, county rates), so the app
can show exactly what is applied for federal tax or for any state without
knowing how each state's figures are arranged.

The seed convention decides units: a key ending in ``Cents`` holds amounts
(and so does everything inside it), a key ending in ``Percent`` holds rates,
and inside bracket rows an integer is an amount and a string is a rate.
"""

from __future__ import annotations

import re
from typing import Any

from ..domain.us_states import us_state_name

TAX_NAMES = {
    "income": "State income tax",
    "sdi": "Disability insurance",
    "fli": "Family leave insurance",
    "pfml": "Paid family and medical leave",
    "ui": "Unemployment (worker share)",
    "ltc": "Long-term care",
    "transit": "Transit tax",
    "local": "County and city taxes",
}

# Keys that steer the formula or the worker form rather than being figures.
_HIDDEN = {
    "certificate",
    "label",
    "round",
    "extraCodes",
    "statuses",
    "statusFromFederal",
    "defaultStatus",
    "localities",
    "source",
    "sources",
    "earlier",
    "optional",
    "choose",
    "code",
    "note",
    "phaseOutRatioDecimals",
    "marriedStatuses",
}
# Keys whose numbers are amounts although the name does not end in Cents.
_MONEY_KEYS = {"perField", "creditPerField", "byPeriods", "exclusions", "federalTaxCap"}

_STATUS_WORDS = {"single": "Single", "married": "Married", "head": "Head of household", "*": "All filers"}
_PERIODS = {
    "1": "Yearly",
    "2": "Twice a year",
    "4": "Quarterly",
    "12": "Monthly",
    "24": "Twice a month",
    "26": "Every two weeks",
    "52": "Weekly",
    "260": "Daily",
}
_LABELS = {
    "perField": "Amount per",
    "creditPerField": "Credit per",
    "byPeriods": "By pay period",
    "noCertificate": "No state form on file",
    "one": "Exemption when claiming 1",
    "per": "Per exemption claimed (more than 1)",
    "plus": "Plus (more than 1 claimed)",
    "hoh": "Head of household credit",
    "blind": "Blindness credit",
    "additional": "Additional allowance",
    "nyc": "New York City",
    "ficaCap": "Social Security and Medicare deducted, up to",
    "ficaRate": "Social Security and Medicare rate",
}


def money(cents: int | float) -> str:
    cents = round(cents)
    sign = "-" if cents < 0 else ""
    dollars, rest = divmod(abs(cents), 100)
    return f"{sign}${dollars:,}" + (f".{rest:02d}" if rest else "")


def percent(value: Any) -> str:
    return f"{value}%"


def humanize(key: str) -> str:
    """'standardDeductionCents' -> 'Standard deduction'."""
    key = re.sub(r"(Cents|Percent)$", "", key)
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key).replace("_", " ").strip()
    return words[:1].upper() + words[1:].lower() if words else key


class _Names:
    """What to call a key: status and form-field labels from the state's certificate, pay periods, known keys."""

    def __init__(self, params: dict[str, Any]) -> None:
        self.words: dict[str, str] = dict(_STATUS_WORDS)
        for field in (params.get("certificate") or {}).get("fields", []):
            key = str(field.get("key", "")).removeprefix("options.")
            if field.get("key") == "status":
                self.words.update({option["value"]: option["label"] for option in field.get("options", [])})
            elif key and field.get("label"):
                self.words[key] = field["label"]
        self.places = {
            option["code"]: option["name"]
            for option in (params.get("localities") or {}).get("options", [])
            if isinstance(option, dict) and "code" in option
        }

    def __call__(self, key: str) -> str:
        if key in self.words:
            return self.words[key]
        if key in _PERIODS:
            return _PERIODS[key]
        return _LABELS.get(key) or _LABELS.get(re.sub(r"(Cents|Percent)$", "", key)) or humanize(key)

    def place(self, code: str, item: dict[str, Any]) -> str:
        return item.get("name") or self.places.get(code) or code.replace("-", " ").title()


def _unit(key: str, inherited: str | None) -> str | None:
    if key.endswith("Cents") or key in _MONEY_KEYS:
        return "money"
    if key.endswith("Percent") or key.lower().endswith("rate"):
        return "percent"
    return inherited


def _scalar(value: Any, unit: str | None) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if unit == "money" and isinstance(value, int | float):
        return money(value)
    if unit == "percent" and isinstance(value, str | int | float):
        return percent(value)
    return str(value)


def _is_rows(value: Any) -> bool:
    """A table of rows: brackets ``[[over, "rate", ...], ...]`` and similar."""
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(row, list) and len(row) >= 2 and isinstance(row[0], int | float) for row in value)
    )


def _rows_table(title: str, rows: list[list[Any]]) -> dict[str, Any]:
    width = max(len(row) for row in rows)
    sample = next(row for row in rows if len(row) == width)
    if width == 2 and isinstance(sample[1], str):
        columns = ["Wages over", "Rate"]
    elif width == 3 and isinstance(sample[1], str):
        columns = ["Wages over", "Rate", "Plus"]
    elif width == 3 and isinstance(sample[2], str):
        columns = ["Wages over", "Tax", "Plus %"]
    else:
        columns = ["Wages over"] + ["Rate" if isinstance(cell, str) else "Amount" for cell in sample[1:]]
    body = [
        [money(cell) if isinstance(cell, int | float) else percent(cell) for cell in row] + [""] * (width - len(row))
        for row in rows
    ]
    return {"type": "table", "title": title, "columns": columns, "rows": body}


def _is_place_rates(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and len(value) > 0
        and all(isinstance(item, dict) and ("ratePercent" in item or "brackets" in item) for item in value.values())
        and any("ratePercent" in item for item in value.values())
    )


def _place_rates(title: str, value: dict[str, Any], names: _Names) -> list[dict[str, Any]]:
    rows, extra = [], []
    for code, item in value.items():
        place = names.place(code, item)
        if "ratePercent" in item:
            rows.append([place, percent(item["ratePercent"])])
        else:
            rows.append([place, "Graduated, below"])
            extra.extend(_walk([place], "brackets", item["brackets"], names, None))
    return [{"type": "table", "title": title, "columns": ["Place", "Rate"], "rows": rows}, *extra]


def _walk(path: list[str], key: str, value: Any, names: _Names, unit: str | None) -> list[dict[str, Any]]:
    """Items for one parameter: a value, a table, or the items of what it holds."""
    if key in _HIDDEN or key.endswith("Source"):
        return []
    unit = _unit(key, unit)
    here = [*path, names(key)]
    title = " · ".join(here)
    if _is_rows(value):
        return [_rows_table(title, value)]
    if _is_place_rates(value):
        return _place_rates(title, value, names)
    if isinstance(value, dict):
        items: list[dict[str, Any]] = []
        for sub_key, sub_value in value.items():
            items.extend(_walk(here, sub_key, sub_value, names, unit))
        return items
    if isinstance(value, list):
        return [{"type": "value", "label": title, "value": ", ".join(_scalar(item, unit) for item in value)}]
    return [{"type": "value", "label": title, "value": _scalar(value, unit)}]


def _params_items(params: dict[str, Any], names: _Names) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for key, value in params.items():
        items.extend(_walk([], key, value, names, None))
    return items


def _section(rule: dict[str, Any]) -> dict[str, Any]:
    params, method = rule["params"] or {}, rule["method"]
    section: dict[str, Any] = {
        "title": TAX_NAMES.get(rule["tax"], humanize(rule["tax"])),
        "status": {"none": "none", "manual": "manual"}.get(method, "calculated"),
        "source": rule["source"] or None,
        "items": [],
    }
    if method == "none":
        section["items"].append({"type": "value", "label": "Withheld", "value": "None in this state"})
        return section
    if method == "manual":
        section["items"].append({"type": "value", "label": "Withheld", "value": "Typed on each pay stub"})
        if params.get("note"):
            section["items"].append({"type": "note", "label": params["note"]})
        return section
    names = _Names(params)
    if method == "local_rate":
        section["items"] = _place_rates(params.get("choose") or "Place", params.get("localities") or {}, names)
    else:
        section["items"] = _params_items(params, names)
    for earlier in sorted(params.get("earlier") or [], key=lambda entry: entry["until"]):
        section["items"].append({"type": "heading", "label": f"Pay dated up to {earlier['until']}"})
        before = earlier["params"]
        if method == "local_rate":
            section["items"].extend(
                _place_rates(params.get("choose") or "Place", before.get("localities") or {}, names)
            )
        else:
            section["items"].extend(_params_items(before, names))
    return section


def state_view(year: int, state: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
    order = list(TAX_NAMES)
    ordered = sorted(rules, key=lambda rule: order.index(rule["tax"]) if rule["tax"] in order else len(order))
    return {
        "jurisdiction": state,
        "name": us_state_name(state),
        "year": year,
        "sections": [_section(rule) for rule in ordered],
    }


def _federal_table(title: str, rows: list[list[int]]) -> dict[str, Any]:
    return {
        "type": "table",
        "title": title,
        "columns": ["Yearly wages over", "Tax", "Plus %"],
        "rows": [[money(row[0] * 100), money(row[1]), percent(row[2])] for row in rows],
    }


def _by_status(figures: dict[str, Any]) -> list[tuple[str, Any]]:
    order = list(_STATUS_WORDS)
    return sorted(figures.items(), key=lambda pair: order.index(pair[0]) if pair[0] in order else len(order))


def federal_view(year: int, data: dict[str, Any]) -> dict[str, Any]:
    ss, medicare = data["socialSecurity"], data["medicare"]
    income: list[dict[str, Any]] = [
        {"type": "value", "label": f"Standard adjustment · {_STATUS_WORDS[status]}", "value": money(cents)}
        for status, cents in _by_status(data["standardAdjustmentCents"])
    ]
    for status, rows in _by_status(data["standard"]):
        income.append(_federal_table(f"Brackets · {_STATUS_WORDS[status]}", rows))
    for status, rows in _by_status(data["step2Checkbox"]):
        income.append(_federal_table(f"Step 2 box checked · {_STATUS_WORDS[status]}", rows))
    return {
        "jurisdiction": "US",
        "name": "Federal",
        "year": year,
        "sections": [
            {
                "title": "Federal income tax",
                "status": "calculated",
                "source": "https://www.irs.gov/publications/p15t",
                "items": income,
            },
            {
                "title": "Social Security",
                "status": "calculated",
                "source": "https://www.ssa.gov/oact/cola/cbb.html",
                "items": [
                    {"type": "value", "label": "Rate", "value": f"{ss['rateBasisPoints'] / 100:g}%"},
                    {"type": "value", "label": "Wage base, yearly", "value": money(ss["wageBaseCents"])},
                ],
            },
            {
                "title": "Medicare",
                "status": "calculated",
                "source": "https://www.irs.gov/publications/p15",
                "items": [
                    {"type": "value", "label": "Rate", "value": f"{medicare['rateBasisPoints'] / 100:g}%"},
                    {
                        "type": "value",
                        "label": "Additional Medicare tax",
                        "value": f"{medicare['additionalRateBasisPoints'] / 100:g}%",
                    },
                    {
                        "type": "value",
                        "label": "Additional tax on yearly wages over",
                        "value": money(medicare["additionalThresholdCents"]),
                    },
                ],
            },
        ],
    }
