"""Request and response shapes for records, shared field types included.

Field names are the app's own camelCase (apps/mobile/src/db/types.ts and
packages/domain), so a record needs no renaming between the phone and here.
Every limit is also a guard against oversized or hostile input. Models are
strict (no "5" for 5, no 10.5 for an integer) and drop unknown keys.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .domain.pay_types import PayType
from .domain.phone import US_PHONE_EXAMPLE, normalize_us_phone
from .domain.tax.types import DEFAULT_STATE_W4, DEFAULT_TAX_PROFILE, DEFAULT_W4
from .domain.us_states import is_us_state_code

TEMPLATES = [
    {"id": "classic", "name": "Classic", "description": "Black on white, full page, boxed net pay.",
     "usesAccent": False},
    {"id": "modern", "name": "Modern", "description": "Coloured header band and tinted net pay panel.",
     "usesAccent": True},
    {"id": "compact", "name": "Compact",
     "description": "Top third of the page; print above a check or cut as a slip.", "usesAccent": False},
    {"id": "ledger", "name": "Ledger", "description": "Fully ruled grid, like a payroll register.",
     "usesAccent": False},
]  # fmt: skip
"""Mirror of TEMPLATES in packages/templates/src/registry.ts; keep the two in step."""

MAX_LOGO_CHARS = 400_000
"""About 300 KB of image once base64-decoded: a logo, not a photo."""

MAX_SAFE_INTEGER = 9_007_199_254_740_991
"""The largest integer the app's JavaScript represents exactly."""

_ISO_DATETIME = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$")
_LOGO = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$")


def _real_date(value: str) -> str:
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("must be a real date in YYYY-MM-DD form") from None
    return value


def _utc_datetime(value: str) -> str:
    match = _ISO_DATETIME.fullmatch(value)
    try:
        if not match:
            raise ValueError
        datetime.fromisoformat(f"{match[1]}T{match[2]}:{match[3]}:{match[4] or '00'}")
    except ValueError:
        raise ValueError("must be a UTC date-time like 2026-11-26T10:00:00.000Z") from None
    return value


def _us_state(value: str) -> str:
    if not is_us_state_code(value):
        raise ValueError("must be a two-letter USPS state code")
    return value


def _logo(value: str) -> str:
    if len(value) > MAX_LOGO_CHARS or not _LOGO.fullmatch(value):
        raise ValueError(f"must be a PNG, JPEG or WebP data: URI of at most {MAX_LOGO_CHARS} characters")
    return value


def _text(max_length: int, *, required: bool = False) -> StringConstraints:
    """A trimmed string of at most ``max_length`` characters; ``required`` forbids the empty string."""
    return StringConstraints(strip_whitespace=True, max_length=max_length, min_length=1 if required else 0)


Id = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
Label = Annotated[str, _text(60, required=True)]
Name = Annotated[str, _text(120, required=True)]
Address = Annotated[str, _text(240)]
Phone = Annotated[str, _text(40)]


def _email(value: str) -> str:
    """Empty, or something@something.tld: the phone's mail app does the real checking."""
    if value and not re.fullmatch(r"[^@\s]+@[^@\s.]+(\.[^@\s.]+)+", value):
        raise ValueError("must be an email address like name@example.com")
    return value.lower()


Email = Annotated[str, _text(254), AfterValidator(_email)]


def _us_phone(value: str) -> str:
    normalized = normalize_us_phone(value)
    if normalized is None:
        raise ValueError(f"must be a US phone number with area code, for example {US_PHONE_EXAMPLE}")
    return normalized


# What the business's phone can be set to: empty, or a US number, stored as "(423) 555-0142".
# Backups keep the older, freer Phone so records saved before this rule still restore.
UsPhone = Annotated[str, _text(40), AfterValidator(_us_phone)]
EmployerId = Annotated[str, _text(20)]
Cents = Annotated[int, Field(ge=0, le=1_000_000_000)]
Minutes = Annotated[int, Field(ge=0, le=100_000)]
QuantityMilli = Annotated[int, Field(ge=0, le=10_000_000)]
"""Units of work in thousandths of a unit: at most 10,000 miles, loads, days or pieces on one line."""
Unit = Annotated[str, _text(12, required=True)]
Count = Annotated[int, Field(ge=0, le=99)]
IsoDate = Annotated[str, AfterValidator(_real_date)]
IsoDateTime = Annotated[str, AfterValidator(_utc_datetime)]
Accent = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
UsState = Annotated[str, AfterValidator(_us_state)]
Logo = Annotated[str, AfterValidator(_logo)]
OvertimePct = Annotated[int, Field(ge=100, le=400)]
LineKind = Literal["earning", "deduction"]
LineSource = Literal["manual", "calculated"]
TaxCode = Annotated[
    str, StringConstraints(pattern=r"^(fit|ss|medicare|sit|sdi|fli|pfml|ui|ltc|transit|local(:[A-Za-z0-9-]{1,14})?)$")
]
PaySchedule = Literal["weekly", "biweekly", "semimonthly", "monthly"]
TemplateId = Literal["classic", "modern", "compact", "ledger"]
Appearance = Literal["automatic", "light", "dark"]


class Model(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class Out(BaseModel):
    """Base for response shapes, which document the API and are not re-validated strictly."""


# ---- Stub lines ---------------------------------------------------------------


class StubLine(Model):
    kind: LineKind
    label: Label
    minutes: Minutes | None
    rateCents: Cents | None
    amountCents: Cents
    source: LineSource
    taxCode: TaxCode | None = None
    quantityMilli: QuantityMilli | None = None
    unit: Unit | None = None
    supplemental: bool | None = None

    @model_validator(mode="after")
    def _hourly_per_unit_or_flat(self) -> StubLine:
        if self.quantityMilli is None:
            if (self.minutes is None) != (self.rateCents is None):
                raise ValueError("minutes and rateCents must both be set (hourly line) or both be null (flat amount)")
            if self.unit is not None:
                raise ValueError("unit goes with quantityMilli")
        else:
            if self.minutes is not None or self.rateCents is None or self.unit is None:
                raise ValueError("a per-unit line has quantityMilli, rateCents and unit, and no minutes")
            if self.quantityMilli * self.rateCents > MAX_SAFE_INTEGER:
                raise ValueError("quantity times rate is too large")
        if self.kind == "deduction" and (self.minutes is not None or self.quantityMilli is not None):
            raise ValueError("deductions are flat amounts and cannot carry hours or units")
        if self.kind == "deduction" and self.supplemental is not None:
            raise ValueError("only earnings can be supplemental pay")
        return self

    def as_domain(self) -> dict[str, Any]:
        """The dict form the calculations take. ``taxCode`` is left out when not given, as in the app."""
        return self.model_dump(exclude_unset=True)


Lines = Annotated[list[StubLine], Field(min_length=1, max_length=40)]


class Period(Model):
    start: IsoDate
    end: IsoDate

    @model_validator(mode="after")
    def _in_order(self) -> Period:
        if self.end < self.start:
            raise ValueError("period ends before it starts")
        return self


# ---- Tax profile ----------------------------------------------------------------


class W4(Model):
    legacy: bool = False
    allowances: Count = 0
    filingStatus: Literal["single", "married", "head"] = "single"
    multipleJobs: bool = False
    dependentsCents: Cents = 0
    otherIncomeCents: Cents = 0
    deductionsCents: Cents = 0
    extraWithholdingCents: Cents = 0
    exempt: bool = False


TaxCodeText = Annotated[str, StringConstraints(min_length=1, max_length=20)]
OptionValue = Annotated[str, StringConstraints(max_length=30)] | int | bool


class StateW4(Model):
    """Answers from the work state's own withholding certificate, where it has one.

    Which of these a state asks for, and what it calls them, is in that state's
    rule (GET /v1/meta/tax-coverage, ``certificate``).
    """

    allowances: Count = 0
    additionalAllowances: Count = 0
    dependents: Count = 0
    status: TaxCodeText | None = None
    localities: Annotated[list[TaxCodeText], Field(max_length=4)] = []
    options: Annotated[dict[Annotated[str, StringConstraints(max_length=30)], OptionValue], Field(max_length=12)] = {}
    extraWithholdingCents: Cents = 0
    exempt: bool = False


class TaxProfile(Model):
    calculate: bool = True
    w4: W4 = W4(**DEFAULT_W4)
    state: UsState | None = None
    # Absent in profiles saved before state certificates existed; defaults to "no certificate on file".
    stateW4: StateW4 = StateW4(**DEFAULT_STATE_W4)


class YtdLine(Model):
    kind: LineKind
    label: Label
    amountCents: Cents


class StartingYtd(Model):
    year: Annotated[int, Field(ge=2000, le=2100)]
    lines: Annotated[list[YtdLine], Field(max_length=40)]


class DefaultDeduction(Model):
    label: Label
    amountCents: Cents


class PtoStart(Model):
    """Paid time off a worker had available before their first stub here."""

    sickMinutes: Minutes = 0
    vacationMinutes: Minutes = 0


class PtoUse(Model):
    accruedMinutes: Minutes = 0
    usedMinutes: Minutes = 0


class StubPto(Model):
    """Time off earned and used on one stub."""

    sick: PtoUse = PtoUse()
    vacation: PtoUse = PtoUse()


class EmployerTax(Model):
    """A tax the employer pays on top of the wages (FUTA, SUTA, ...). Never deducted from net pay."""

    label: Label
    amountCents: Cents


EmployerTaxes = Annotated[list[EmployerTax], Field(max_length=10)]


# ---- Business -------------------------------------------------------------------

_BUSINESS_EXAMPLE = {
    "name": "Ridgeline Auto Repair",
    "address": "2140 Alder St, Chattanooga, TN 37404",
    "phone": "(423) 555-0142",
    "state": "TN",
    "employerId": None,
    "paySchedule": "biweekly",
    "templateId": "classic",
    "accent": "#3F3D9E",
    "overtimePct": 150,
}


class BusinessCreate(Model):
    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [_BUSINESS_EXAMPLE]})

    name: Name
    address: Address = ""
    phone: UsPhone = ""
    state: UsState | None = None
    employerId: EmployerId | None = None
    logoDataUri: Logo | None = None
    paySchedule: PaySchedule
    firstPayDate: IsoDate | None = None
    showEmployerId: bool = True
    templateId: TemplateId = "classic"
    accent: Accent = "#3F3D9E"
    overtimePct: OvertimePct = 150
    appearance: Appearance = "light"
    showPto: bool = False
    showEmployerTaxes: bool = False
    showDepositSlip: bool = False


class BusinessPatch(Model):
    """Send only the fields to change."""

    model_config = ConfigDict(
        strict=True, extra="ignore", json_schema_extra={"examples": [{"state": "PA", "overtimePct": 200}]}
    )

    name: Name | None = None
    address: Address | None = None
    phone: UsPhone | None = None
    state: UsState | None = None
    employerId: EmployerId | None = None
    logoDataUri: Logo | None = None
    paySchedule: PaySchedule | None = None
    firstPayDate: IsoDate | None = None
    showEmployerId: bool | None = None
    templateId: TemplateId | None = None
    accent: Accent | None = None
    overtimePct: OvertimePct | None = None
    appearance: Appearance | None = None
    showPto: bool | None = None
    showEmployerTaxes: bool | None = None
    showDepositSlip: bool | None = None


class BusinessOut(Out):
    id: str
    name: str
    address: str
    phone: str
    state: str | None
    employerId: str | None
    logoDataUri: str | None
    paySchedule: PaySchedule
    firstPayDate: str | None
    showEmployerId: bool
    templateId: str
    accent: str
    overtimePct: int
    appearance: str
    showPto: bool
    showEmployerTaxes: bool
    showDepositSlip: bool
    version: int
    createdAt: str
    updatedAt: str


# ---- Workers --------------------------------------------------------------------

_WORKER_EXAMPLE = {
    "name": "Marcus Bell",
    "address": "418 Dodson Ave, Chattanooga, TN 37406",
    "type": "employee",
    "payType": "hourly",
    "rateCents": 2400,
    "defaultDeductions": [{"label": "Health insurance", "amountCents": 8500}],
    "startingYtd": None,
    "taxProfile": DEFAULT_TAX_PROFILE,
}


class WorkerCreate(Model):
    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [_WORKER_EXAMPLE]})

    name: Name
    address: Address = ""
    email: Email = ""
    type: Literal["employee", "contractor"]
    payType: PayType
    rateCents: Cents
    defaultDeductions: Annotated[list[DefaultDeduction], Field(max_length=20)] = []
    startingYtd: StartingYtd | None = None
    taxProfile: TaxProfile = TaxProfile()
    ptoStart: PtoStart | None = None


class WorkerPatch(Model):
    """Send only the fields to change."""

    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [{"rateCents": 2550}]})

    name: Name | None = None
    address: Address | None = None
    email: Email | None = None
    type: Literal["employee", "contractor"] | None = None
    payType: PayType | None = None
    rateCents: Cents | None = None
    defaultDeductions: Annotated[list[DefaultDeduction], Field(max_length=20)] | None = None
    startingYtd: StartingYtd | None = None
    taxProfile: TaxProfile | None = None
    ptoStart: PtoStart | None = None


class WorkerOut(Out):
    id: str
    name: str
    address: str
    email: str
    type: str
    payType: str
    rateCents: int
    defaultDeductions: list[DefaultDeduction]
    startingYtd: StartingYtd | None
    taxProfile: TaxProfile
    ptoStart: PtoStart | None
    version: int
    createdAt: str
    updatedAt: str


class WorkerPage(Out):
    items: list[WorkerOut]
    nextCursor: str | None


# ---- Stubs ----------------------------------------------------------------------


class LinesReplace(Model):
    model_config = ConfigDict(
        strict=True,
        extra="ignore",
        json_schema_extra={
            "examples": [
                {
                    "lines": [
                        {"kind": "earning", "label": "Regular", "minutes": 4605, "rateCents": 2400,
                         "amountCents": 184200, "source": "manual"},
                        {"kind": "deduction", "label": "Health insurance", "minutes": None, "rateCents": None,
                         "amountCents": 8500, "source": "manual"},
                    ]
                }
            ]
        },
    )  # fmt: skip

    lines: Lines


class ExtrasReplace(Model):
    """Paid time off and employer-paid taxes for one stub. Both are replaced as sent."""

    model_config = ConfigDict(
        strict=True,
        extra="ignore",
        json_schema_extra={
            "examples": [
                {
                    "pto": {
                        "sick": {"accruedMinutes": 90, "usedMinutes": 0},
                        "vacation": {"accruedMinutes": 120, "usedMinutes": 480},
                    },
                    "employerTaxes": [{"label": "FUTA", "amountCents": 1104}, {"label": "SUTA", "amountCents": 5520}],
                }
            ]
        },
    )  # fmt: skip

    pto: StubPto | None = None
    employerTaxes: EmployerTaxes = []


class StubPatch(Model):
    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [{"payDate": "2026-12-04"}]})

    period: Period | None = None
    payDate: IsoDate | None = None


class Today(Model):
    """The calendar date where the user is.

    The server only knows UTC, which is already tomorrow for part of every US evening.
    """

    model_config = ConfigDict(strict=True, extra="ignore", json_schema_extra={"examples": [{"today": "2026-11-22"}]})

    today: IsoDate | None = None


class StubLineOut(Out):
    id: str
    kind: LineKind
    label: str
    minutes: int | None
    rateCents: int | None
    amountCents: int
    source: LineSource
    taxCode: str | None
    quantityMilli: int | None = Field(
        None, description="Units of work for a per-mile, per-load, per-day or per-piece line, in thousandths."
    )
    unit: str | None = Field(None, description="What the quantity counts: mile, load, day or piece.")
    supplemental: bool = Field(
        False, description="True when federal income tax is withheld on the line at the flat supplemental rate."
    )
    taxOverride: bool = Field(description="True when the user typed over a figure that would otherwise be calculated.")


class Totals(Out):
    grossCents: int
    deductionsCents: int
    netCents: int
    totalMinutes: int


class Ytd(Out):
    grossCents: int
    deductionsCents: int
    netCents: int
    byLine: dict[str, int] = Field(description="Year-to-date per line, keyed by '<kind>:<label, lower-cased>'.")


class PtoBalanceOut(Out):
    accruedMinutes: int = Field(description="Earned on this stub.")
    usedMinutes: int = Field(description="Taken on this stub.")
    availableMinutes: int = Field(
        description="Balance after this stub: the worker's opening balance plus all earned, minus all used."
    )


class StubPtoOut(Out):
    sick: PtoBalanceOut
    vacation: PtoBalanceOut


class EmployerTaxOut(Out):
    label: str
    amountCents: int
    ytdCents: int


class StubOut(Out):
    id: str
    workerId: str
    period: Period
    payDate: str
    lines: list[StubLineOut]
    totals: Totals = Field(description="Computed from the lines on every read, never stored.")
    ytd: Ytd = Field(description="Computed from the worker's history on every read, never stored.")
    taxStatus: Literal["calculated", "off", "no-data-for-year"]
    taxNotes: list[str] = Field(
        [], description="Plain-language notes on how the taxes were worked out, such as bonus pay."
    )
    pto: StubPtoOut = Field(description="Paid time off for this stub; zeros when none was entered.")
    employerTaxes: list[EmployerTaxOut] = Field(description="Employer-paid taxes, not part of net pay.")
    version: int
    createdAt: str
    updatedAt: str


class StubPage(Out):
    items: list[StubOut]
    nextCursor: str | None


class BatchOut(Out):
    period: Period
    created: list[StubOut]


# ---- Backup (import/export) -------------------------------------------------------

BackupTaxCode = Annotated[str, _text(20)]


class BackupLine(StubLine):
    # Wider than TaxCode on purpose: a backup made by a newer app may carry a code this server does not know yet.
    taxCode: BackupTaxCode | None = None  # type: ignore[assignment]


class BackupWorker(Model):
    id: Id
    name: Name
    address: Address
    email: Email = ""
    type: Literal["employee", "contractor"]
    payType: PayType
    rateCents: Cents
    defaultDeductions: Annotated[list[DefaultDeduction], Field(max_length=20)]
    startingYtd: StartingYtd | None
    taxProfile: TaxProfile = TaxProfile()
    createdAt: IsoDateTime | None = None
    ptoStart: PtoStart | None = None


class BackupStub(Model):
    id: Id
    workerId: Id
    periodStart: IsoDate
    periodEnd: IsoDate
    payDate: IsoDate
    createdAt: IsoDateTime
    lines: Annotated[list[BackupLine], Field(min_length=1, max_length=40)]
    pto: StubPto | None = None
    employerTaxes: EmployerTaxes | None = None


class BackupBusiness(Model):
    id: Id
    name: Name
    address: Address
    phone: Phone
    state: UsState | None = None
    employerId: EmployerId | None
    logoDataUri: Logo | None = None
    paySchedule: PaySchedule
    firstPayDate: IsoDate | None = None
    showEmployerId: bool
    templateId: TemplateId
    accent: Accent
    overtimePct: OvertimePct = 150
    appearance: Appearance = "light"
    showPto: bool = False
    showEmployerTaxes: bool = False
    showDepositSlip: bool = False


class Snapshot(Model):
    business: BackupBusiness
    workers: Annotated[list[BackupWorker], Field(max_length=50)]
    stubs: Annotated[list[BackupStub], Field(max_length=5000)]
