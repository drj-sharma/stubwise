"""Request shapes for tax form filing.

These models carry SSNs and EINs in memory for the length of one request.
Every such field is ``repr=False`` and the models hide inputs in validation
errors, so neither a stray log line nor an error message can print one.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

from .schemas import Id

SUPPORTED_TAX_YEARS = (2025, 2026)
"""Tax years TaxBandits API v2.0.0 accepts for W-2 and 1099-NEC (its docs, read 2026-11-22)."""

MAX_RECIPIENTS = 25
"""Far above the 1-5 workers the app is built for, far below TaxBandits' 250 per submission."""

US_STATES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC "
    "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS FM GU MH MP PW PR VI AA AE AP".split()
)
"""States, territories and military post codes, as TaxBandits lists them for US addresses."""

_SSN = re.compile(r"\d{3}-\d{2}-\d{4}|\d{9}")
_EIN = re.compile(r"\d{2}-\d{7}|\d{9}")


def _digits(value: str) -> str:
    return value.replace("-", "")


def parse_ssn(value: str) -> str:
    """Nine digits of a plausible SSN. The messages never repeat the value."""
    if not _SSN.fullmatch(value):
        raise ValueError("must be an SSN like 123-45-6789")
    digits = _digits(value)
    area, group, serial = digits[:3], digits[3:5], digits[5:]
    if area in ("000", "666") or area[0] == "9" or group == "00" or serial == "0000":
        raise ValueError("is not a valid SSN")
    return digits


def parse_itin(value: str) -> str:
    if not _SSN.fullmatch(value):
        raise ValueError("must be an ITIN like 9XX-XX-XXXX")
    digits = _digits(value)
    if digits[0] != "9":
        raise ValueError("is not a valid ITIN")
    return digits


def parse_ein(value: str) -> str:
    if not _EIN.fullmatch(value):
        raise ValueError("must be an EIN like 12-3456789")
    digits = _digits(value)
    if digits[:2] == "00":
        raise ValueError("is not a valid EIN")
    return digits


def _state(value: str) -> str:
    if value not in US_STATES:
        raise ValueError("must be a two-letter US state or territory code")
    return value


def _text(max_length: int) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


# Lengths are TaxBandits' field sizes, so a request that passes here is not refused there for length.
PersonName = Annotated[str, _text(20)]
BusinessName = Annotated[str, _text(75)]
Street = Annotated[str, _text(46)]
City = Annotated[str, _text(50)]
Suffix = Literal["Jr", "Sr", "I", "II", "III", "IV", "V", "VI", "VII"]
FormCents = Annotated[int, Field(ge=0, le=99_999_999_999)]
"""Whole cents, up to TaxBandits' 999,999,999.99 limit."""


def _supported_year(year: int) -> int:
    if year not in SUPPORTED_TAX_YEARS:
        raise ValueError(f"must be one of {', '.join(str(y) for y in SUPPORTED_TAX_YEARS)}")
    return year


TaxYear = Annotated[int, AfterValidator(_supported_year)]


class FilingModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore", hide_input_in_errors=True)


class UsAddress(FilingModel):
    line1: Street
    line2: Street | None = None
    city: City
    state: Annotated[str, AfterValidator(_state)]
    zip: Annotated[str, StringConstraints(pattern=r"^\d{5}(-\d{4})?$")]


class Contact(FilingModel):
    """The person the IRS or SSA may contact about the filing."""

    firstName: PersonName
    lastName: PersonName
    phone: Annotated[str, StringConstraints(pattern=r"^\d{10}$")] | None = None


class Employer(FilingModel):
    ein: Annotated[str, AfterValidator(parse_ein)] = Field(repr=False)
    name: BusinessName
    address: UsAddress
    contact: Contact


class W2Employer(Employer):
    kindOfEmployer: Literal["FEDERALGOVT", "STATEORLOCAL501C", "NONGOVT501C", "STATEORLOCALNON501C", "NONEAPPLY"] = (
        "NONEAPPLY"
    )
    kindOfPayer: Literal[
        "REGULAR941", "REGULAR944", "AGRICULTURAL943", "HOUSEHOLD", "MILITARY", "MEDICAREQUALGOVEM",
        "RAILROADFORMCT1",
    ] = "REGULAR941"  # fmt: skip


class W2Recipient(FilingModel):
    ref: Id
    ssn: Annotated[str, AfterValidator(parse_ssn)] = Field(repr=False)
    firstName: PersonName
    middleName: PersonName | None = None
    lastName: PersonName
    suffix: Suffix | None = None
    address: UsAddress
    wagesCents: FormCents
    federalTaxWithheldCents: FormCents | None = None
    socialSecurityWagesCents: FormCents | None = None
    socialSecurityTaxWithheldCents: FormCents | None = None
    medicareWagesCents: FormCents | None = None
    medicareTaxWithheldCents: FormCents | None = None

    @property
    def display_name(self) -> str:
        return f"{self.firstName} {self.lastName}"


class NecRecipient(FilingModel):
    ref: Id
    tinType: Literal["SSN", "ITIN", "EIN"]
    tin: str = Field(repr=False)
    # A person (SSN, ITIN) is named by first and last name, a business (EIN) by businessName.
    firstName: PersonName | None = None
    middleName: PersonName | None = None
    lastName: PersonName | None = None
    suffix: Suffix | None = None
    businessName: BusinessName | None = None
    address: UsAddress
    nonemployeeCompensationCents: Annotated[int, Field(ge=1, le=99_999_999_999)]
    federalTaxWithheldCents: FormCents | None = None

    @model_validator(mode="after")
    def _tin_and_name_agree(self) -> NecRecipient:
        parse = {"SSN": parse_ssn, "ITIN": parse_itin, "EIN": parse_ein}[self.tinType]
        try:
            self.tin = parse(self.tin)
        except ValueError as error:
            raise ValueError(f"tin {error}") from None
        if self.tinType == "EIN":
            if not self.businessName:
                raise ValueError("businessName is required when tinType is EIN")
        elif not (self.firstName and self.lastName):
            raise ValueError("firstName and lastName are required when tinType is SSN or ITIN")
        return self

    @property
    def display_name(self) -> str:
        return self.businessName or f"{self.firstName} {self.lastName}"


def _unique_refs(recipients: list) -> list:
    refs = [recipient.ref for recipient in recipients]
    if len(set(refs)) != len(refs):
        raise ValueError("each recipient needs a different ref")
    return recipients


_RecipientCount = Field(min_length=1, max_length=MAX_RECIPIENTS)


class W2FilingRequest(FilingModel):
    formType: Literal["W2"]
    taxYear: TaxYear
    employer: W2Employer
    recipients: Annotated[list[W2Recipient], _RecipientCount, AfterValidator(_unique_refs)]


class NecFilingRequest(FilingModel):
    formType: Literal["1099NEC"]
    taxYear: TaxYear
    employer: Employer
    recipients: Annotated[list[NecRecipient], _RecipientCount, AfterValidator(_unique_refs)]


FilingRequest = Annotated[W2FilingRequest | NecFilingRequest, Field(discriminator="formType")]


class ConsentRequest(FilingModel):
    consentVersion: Annotated[str, _text(40)]
