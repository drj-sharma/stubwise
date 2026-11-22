"""Port of packages/domain/src/usStates.ts. The list itself comes from the generated tax data."""

from __future__ import annotations

from .tax.data import TAX_DATA

US_STATES: tuple[dict[str, str], ...] = tuple(TAX_DATA["usStates"])
"""The 50 states and the District of Columbia, as ``{"code", "name"}``, alphabetical by name."""

_NAMES = {state["code"]: state["name"] for state in US_STATES}
US_STATE_CODES: tuple[str, ...] = tuple(_NAMES)


def is_us_state_code(value: object) -> bool:
    return isinstance(value, str) and value in _NAMES


def us_state_name(code: str) -> str:
    return _NAMES.get(code, code)
