"""Turns a validated filing request into a TaxBandits v2.0.0 Create request body.

Field names follow the "Create" pages for Form W-2 and Form 1099-NEC. Federal
e-filing only: state filing and recipient-copy distribution are switched off.
"""

from __future__ import annotations

from typing import Any

from .filing_schemas import Employer, NecFilingRequest, UsAddress, W2Employer, W2FilingRequest


def _dollars(cents: int) -> float:
    """TaxBandits takes dollar amounts with up to two decimals as JSON numbers."""
    return round(cents / 100, 2)


def _ssn(digits: str) -> str:
    return f"{digits[:3]}-{digits[3:5]}-{digits[5:]}"


def _ein(digits: str) -> str:
    return f"{digits[:2]}-{digits[2:]}"


def _without_none(node: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in node.items() if value is not None}


def _address(address: UsAddress) -> dict[str, Any]:
    return _without_none(
        {
            "Address1": address.line1,
            "Address2": address.line2,
            "City": address.city,
            "ProvinceOrState": address.state,
            "ZipCd": address.zip,
            "Country": "US",
        }
    )


def _manifest(tax_year: int) -> dict[str, Any]:
    return {
        "TaxYear": str(tax_year),
        "IsFederal": True,
        "IsState": False,
        "IsDistribution": False,
        "IsScheduleFiling": False,
    }


_RETURN_MANIFEST = {"IsFederal": True, "IsState": False, "IsDistribution": False}


def _business(employer: Employer) -> dict[str, Any]:
    # UNVERIFIED: "NameCtrl" (the IRS name control) is not marked optional in the
    # docs' field table. It is left out because it cannot be derived reliably from
    # the business name; the sandbox will show whether TaxBandits insists on it.
    business: dict[str, Any] = {
        "TINDetails": {"Format": "PLAIN_TIN", "TINType": "EIN", "TIN": _ein(employer.ein)},
        "BusinessNm": employer.name,
        "Address": _address(employer.address),
        # The field table types ContactDetails as object[]; every sample sends one object, as here.
        "ContactDetails": _without_none(
            {
                "FirstNm": employer.contact.firstName,
                "LastNm": employer.contact.lastName,
                "Phone": employer.contact.phone,
            }
        ),
    }
    if isinstance(employer, W2Employer):
        business["W2Specific"] = {
            "KindOfEmployer": employer.kindOfEmployer,
            "KindOfPayer": employer.kindOfPayer,
        }
    return business


def build_w2(request: W2FilingRequest) -> dict[str, Any]:
    returns = []
    for sequence, employee in enumerate(request.recipients, start=1):
        # UNVERIFIED: for tax year 2026 the docs do not mark "TTOC1" (tipped
        # occupation code) optional on Form W-2. It is not sent; CrewStub has no
        # tip reporting.
        form = _without_none(
            {
                "Wages": _dollars(employee.wagesCents),
                "FedTaxWH": _maybe_dollars(employee.federalTaxWithheldCents),
                "SocSecWages": _maybe_dollars(employee.socialSecurityWagesCents),
                "SocSecTaxWH": _maybe_dollars(employee.socialSecurityTaxWithheldCents),
                "MediWages": _maybe_dollars(employee.medicareWagesCents),
                "MediTaxWH": _maybe_dollars(employee.medicareTaxWithheldCents),
            }
        )
        returns.append(
            {
                "SequenceId": str(sequence),
                "ReturnManifest": _RETURN_MANIFEST,
                "Employee": {
                    "TINDetails": {"Format": "PLAIN_TIN", "TINType": "SSN", "TIN": _ssn(employee.ssn)},
                    "IndividualNm": _without_none(
                        {
                            "FirstNm": employee.firstName,
                            "MiddleNm": employee.middleName,
                            "LastNm": employee.lastName,
                            "Suffix": employee.suffix,
                        }
                    ),
                    "Address": _address(employee.address),
                },
                "W2FormData": form,
            }
        )
    return {
        "SubmissionManifest": _manifest(request.taxYear),
        "ReturnHeader": {"Business": _business(request.employer)},
        "ReturnData": returns,
    }


def build_1099nec(request: NecFilingRequest) -> dict[str, Any]:
    returns = []
    for sequence, payee in enumerate(request.recipients, start=1):
        recipient: dict[str, Any] = {
            "TINDetails": {
                "Format": "PLAIN_TIN",
                "TINType": payee.tinType,
                "TIN": _ein(payee.tin) if payee.tinType == "EIN" else _ssn(payee.tin),
            },
            "Address": _address(payee.address),
        }
        if payee.tinType == "EIN":
            recipient["BusinessNm"] = payee.businessName
        else:
            recipient["IndividualNm"] = _without_none(
                {
                    "FirstNm": payee.firstName,
                    "MiddleNm": payee.middleName,
                    "LastNm": payee.lastName,
                    "Suffix": payee.suffix,
                }
            )
        returns.append(
            {
                "SequenceId": str(sequence),
                # IsForced stays false so TaxBandits refuses an accidental duplicate return.
                "ReturnManifest": {**_RETURN_MANIFEST, "IsForced": False},
                "Recipient": recipient,
                "NECFormData": _without_none(
                    {
                        "NEC": _dollars(payee.nonemployeeCompensationCents),
                        "FedTaxWH": _maybe_dollars(payee.federalTaxWithheldCents),
                    }
                ),
            }
        )
    return {
        "SubmissionManifest": _manifest(request.taxYear),
        "ReturnHeader": {"Business": _business(request.employer)},
        "ReturnData": returns,
    }


def _maybe_dollars(cents: int | None) -> float | None:
    return None if cents is None else _dollars(cents)
