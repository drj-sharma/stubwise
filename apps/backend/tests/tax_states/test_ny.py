"""New York, 2026: NYS-50-T-NYS, NYS-50-T-NYC and NYS-50-T-Y (1/26), Method II exact
calculation examples; disability (DBL) and paid family leave contributions.

State examples: NYS-50-T-NYS pages 16 and 18 (single and married examples 1-3; the
daily example 4 is a frequency CrewStub does not pay). Single example 2 and married
example 2 print $258.51 and $248.11; the publication's own table rows give $258.50
($165.00 x 0.0753 = $12.4245) and $248.12 ($58.80 x 0.0707 = $4.15716), which is what
is asserted. The same two calculations multiplied by 16.75% match the Yonkers booklet
to the cent ($43.30 and $41.56).

City examples: NYS-50-T-NYC page 27 (single and married examples 1-3).
Yonkers resident examples: NYS-50-T-Y pages 16 and 18.
Yonkers nonresident examples: NYS-50-T-Y page 25 (Method VIII examples 1-3).
"""

from __future__ import annotations

from .helpers import withhold

# Every line on a New York stub: state tax, DBL, paid family leave (and the local lines asked for).
NY = "NY"


def sit(**kwargs: object) -> int:
    return withhold(NY, 2026, **kwargs)["sit"]  # type: ignore[arg-type]


def test_state_single_examples() -> None:
    # Example 1: weekly $400, single, 3 exemptions -> $8.01
    assert sit(wages_cents=40_000, periods=52, cert={"status": "single", "allowances": 3}) == 801
    # Example 2: semimonthly $5,000, single, 1 exemption -> $258.50 (see module docstring)
    assert sit(wages_cents=500_000, periods=24, cert={"status": "single", "allowances": 1}) == 25_850
    # Example 3: monthly $50,000, single, 3 exemptions -> $3,576.63
    assert sit(wages_cents=5_000_000, periods=12, cert={"status": "single", "allowances": 3}) == 357_663


def test_state_married_examples() -> None:
    # Example 1: weekly $400, married, 4 exemptions -> $6.69
    assert sit(wages_cents=40_000, periods=52, cert={"status": "married", "allowances": 4}) == 669
    # Example 2: semimonthly $5,000, married, 3 exemptions -> $248.12 (see module docstring)
    assert sit(wages_cents=500_000, periods=24, cert={"status": "married", "allowances": 3}) == 24_812
    # Example 3: monthly $50,000, married, 3 exemptions -> $3,622.09
    assert sit(wages_cents=5_000_000, periods=12, cert={"status": "married", "allowances": 3}) == 362_209


def test_no_certificate_is_single_with_zero_allowances() -> None:
    # Weekly $1,000, no IT-2104 (IT-2104-I: zero allowances; single status).
    # Net = $1,000 - $142.30 = $857.70; line 4: $11.27 + ($857.70 - $267) x 5.40% = $43.1678 -> $43.17
    assert withhold(NY, 2026, wages_cents=100_000, periods=52) == {"sit": 4317, "sdi": 60, "fli": 432}
    # A married federal W-4 does not change it.
    assert sit(wages_cents=100_000, periods=52, w4={"filingStatus": "married"}) == 4317


def test_method_three_top_rates() -> None:
    # Weekly $25,000, single, 0 allowances: net $24,857.70, annualized $1,292,600.40 >= $1,077,550,
    # so Method III: $24,857.70 x 10.45% = $2,597.62965 -> $2,597.63
    assert sit(wages_cents=2_500_000, periods=52, cert={"status": "single"}) == 259_763


def test_new_york_city_examples() -> None:
    def nyc(wages: int, periods: int, status: str, allowances: int) -> int:
        cert = {"status": status, "options": {"nycResident": True, "nycAllowances": allowances}}
        return withhold(NY, 2026, wages_cents=wages, periods=periods, cert=cert)["local:NYC"]

    assert nyc(40_000, 52, "single", 3) == 611  # $6.11
    assert nyc(500_000, 24, "single", 1) == 18_880  # $188.80
    assert nyc(5_000_000, 12, "single", 3) == 207_050  # $2,070.50
    assert nyc(40_000, 52, "married", 4) == 517  # $5.17
    assert nyc(500_000, 24, "married", 3) == 18_437  # $184.37
    assert nyc(5_000_000, 12, "married", 3) == 206_873  # $2,068.73


def test_city_uses_its_own_allowances_and_extra_amount() -> None:
    cert = {"status": "single", "allowances": 3, "options": {"nycResident": True, "nycExtraCents": 500}}
    lines = withhold(NY, 2026, wages_cents=40_000, periods=52, cert=cert)
    # NYC line 2 left blank: 0 city allowances. $400 - $96.15 = $303.85; $7.46 + $15.85 x 3.95% = $8.086 -> $8.09, + $5
    assert lines["sit"] == 801
    assert lines["local:NYC"] == 809 + 500
    # Not a resident: no city line.
    assert "local:NYC" not in withhold(NY, 2026, wages_cents=40_000, periods=52, cert={"status": "single"})


def test_yonkers_resident_examples() -> None:
    def yonkers(wages: int, periods: int, status: str, allowances: int) -> int:
        cert = {"status": status, "allowances": allowances, "options": {"yonkers": "resident"}}
        return withhold(NY, 2026, wages_cents=wages, periods=periods, cert=cert)["local:YONKERS-R"]

    assert yonkers(40_000, 52, "single", 3) == 134  # $1.34
    assert yonkers(500_000, 24, "single", 1) == 4_330  # $43.30
    assert yonkers(5_000_000, 12, "single", 3) == 59_908  # $599.08
    assert yonkers(40_000, 52, "married", 4) == 112  # $1.12
    assert yonkers(500_000, 24, "married", 3) == 4_156  # $41.56
    assert yonkers(5_000_000, 12, "married", 3) == 60_670  # $606.70


def test_yonkers_nonresident_examples() -> None:
    def yonkers(wages: int, periods: int) -> int:
        cert = {"options": {"yonkers": "nonresident"}}
        return withhold(NY, 2026, wages_cents=wages, periods=periods, cert=cert)["local:YONKERS-N"]

    assert yonkers(7_500, 52) == 0  # $3,900 a year: under $4,000, nothing withheld
    assert yonkers(20_000, 52) == 81  # ($10,400 - $2,000) x 0.50% / 52 = $0.81
    assert yonkers(40_000, 24) == 138  # ($9,600 - $3,000) x 0.50% / 24 = $1.375 -> $1.38


def test_disability_insurance_is_capped_at_sixty_cents_a_week() -> None:
    assert withhold(NY, 2026, wages_cents=10_000, periods=52)["sdi"] == 50  # 0.5% of $100
    assert withhold(NY, 2026, wages_cents=100_000, periods=52)["sdi"] == 60  # 0.5% of $1,000 = $5, capped
    assert withhold(NY, 2026, wages_cents=200_000, periods=26)["sdi"] == 120  # two weeks: $1.20


def test_paid_family_leave_below_and_across_the_annual_cap() -> None:
    assert withhold(NY, 2026, wages_cents=100_000, periods=52)["fli"] == 432  # 0.432% of $1,000
    # $95,000 paid already (0.432% = $410.40 of the $411.91 maximum): only $1.51 is left.
    lines = withhold(NY, 2026, wages_cents=100_000, periods=52, prior_ytd_wages_cents=9_500_000)
    assert lines["fli"] == 151
