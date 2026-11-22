"""Iowa, 2026: Iowa Withholding Formula, effective January 1, 2026 (released November 2025).

T1 = wages - deduction for the status; T2 = T1 x 3.8%; T3 = T2 - IA W-4 line 7
total allowance dollars / pay periods. Worked annually here, which gives the
publication's figures to the cent. Examples 1-6 are the publication's own.
"""

from __future__ import annotations

from .helpers import withhold


def test_example_1_biweekly_other() -> None:
    # $2,100 biweekly, "Other", $40 allowances: (2,100 - 500) x 3.8% - 40/26 = $59.26
    assert withhold(
        "IA", 2026, wages_cents=210_000, periods=26, cert={"status": "other", "options": {"allowanceCents": 4_000}}
    ) == {"sit": 5926}


def test_example_2_biweekly_married_spouse_no_income() -> None:
    assert withhold(
        "IA", 2026, wages_cents=210_000, periods=26, cert={"status": "mfj", "options": {"allowanceCents": 8_000}}
    ) == {"sit": 3872}


def test_example_3_biweekly_head_of_household() -> None:
    assert withhold(
        "IA", 2026, wages_cents=210_000, periods=26, cert={"status": "head", "options": {"allowanceCents": 16_000}}
    ) == {"sit": 4515}


def test_examples_4_to_6_monthly() -> None:
    assert withhold(
        "IA", 2026, wages_cents=500_000, periods=12, cert={"status": "other", "options": {"allowanceCents": 4_000}}
    ) == {"sit": 14550}
    assert withhold(
        "IA", 2026, wages_cents=500_000, periods=12, cert={"status": "mfj", "options": {"allowanceCents": 8_000}}
    ) == {"sit": 10100}
    assert withhold(
        "IA", 2026, wages_cents=500_000, periods=12, cert={"status": "head", "options": {"allowanceCents": 16_000}}
    ) == {"sit": 11492}


def test_no_ia_w4_uses_column_a_and_no_allowance() -> None:
    # Status missing -> column (A) deduction, allowance $0: (54,600 - 13,000) x 3.8% / 26 = $60.80
    assert withhold("IA", 2026, wages_cents=210_000, periods=26) == {"sit": 6080}
    # The federal W-4 status does not change it.
    assert withhold("IA", 2026, wages_cents=210_000, periods=26, w4={"filingStatus": "married"}) == {"sit": 6080}
