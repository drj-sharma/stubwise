"""Plans and what each one allows. There is no billing yet: everyone is on ``free``.

When a paid plan arrives, add it here and set ``users.plan``; the rest of the
code asks ``entitlements(user.plan)`` and never compares plan names.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True, slots=True)
class Entitlements:
    max_businesses: int
    max_workers: int


PLANS = {
    # 50 workers is the ceiling the backup format has always had, not a pricing decision.
    "free": Entitlements(max_businesses=1, max_workers=50),
}


def entitlements(plan: str) -> Entitlements:
    """Unknown plans get the free allowance rather than an error, so a bad row cannot lock a user out."""
    return PLANS.get(plan, PLANS["free"])


def entitlements_json(plan: str) -> dict[str, int]:
    values = asdict(entitlements(plan))
    return {"maxBusinesses": values["max_businesses"], "maxWorkers": values["max_workers"]}
