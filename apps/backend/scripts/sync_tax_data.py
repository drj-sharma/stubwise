"""Copies the generated tax figures from packages/domain into the backend.

    uv run python scripts/sync_tax_data.py          # copy
    uv run python scripts/sync_tax_data.py --check  # fail if the copy is stale

The figures are never typed into Python. packages/domain/parity/tax-data.json
is generated from the TypeScript data files; this script copies it byte for
byte, and tests/test_parity.py fails when the two files differ.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SOURCE = BACKEND.parents[1] / "packages" / "domain" / "parity" / "tax-data.json"
TARGET = BACKEND / "app" / "domain" / "data" / "tax-data.json"


def main() -> int:
    if not SOURCE.exists():
        print(f"missing {SOURCE}", file=sys.stderr)
        return 2
    if "--check" in sys.argv:
        if not TARGET.exists() or TARGET.read_bytes() != SOURCE.read_bytes():
            print("app/domain/data/tax-data.json is out of date; run scripts/sync_tax_data.py", file=sys.stderr)
            return 1
        return 0
    shutil.copyfile(SOURCE, TARGET)
    print(f"copied {SOURCE.relative_to(BACKEND.parents[1])} -> {TARGET.relative_to(BACKEND)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
