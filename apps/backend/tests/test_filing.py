from __future__ import annotations

import copy
import json
import logging
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app import filing

from .conftest import CREDENTIALS, FakeIdentityProviders, FakeTaxBandits, Outbound, make_client, new_user

EIN = "62-1847305"
MARCUS_SSN = "412-55-7890"
DANA_SSN = "523-66-1234"
TYRONE_SSN = "301-44-9876"
SUPPLIER_EIN = "47-2233445"
SECRETS = [EIN, MARCUS_SSN, DANA_SSN, TYRONE_SSN, SUPPLIER_EIN]

ADDRESS = {"line1": "418 Dodson Ave", "city": "Chattanooga", "state": "TN", "zip": "37406"}
EMPLOYER = {
    "ein": EIN,
    "name": "Ridgeline Auto Repair",
    "address": {
        "line1": "2140 Alder St",
        "line2": "Unit B",
        "city": "Chattanooga",
        "state": "TN",
        "zip": "37404",
    },
    "contact": {"firstName": "Renee", "lastName": "Okafor", "phone": "4235550142"},
}


def w2_request() -> dict[str, Any]:
    return {
        "formType": "W2",
        "taxYear": 2026,
        "employer": copy.deepcopy(EMPLOYER),
        "recipients": [
            {
                "ref": "w-marcus",
                "ssn": MARCUS_SSN,
                "firstName": "Marcus",
                "lastName": "Bell",
                "address": ADDRESS,
                "wagesCents": 5_241_657,
                "federalTaxWithheldCents": 498_200,
                "socialSecurityWagesCents": 5_241_657,
                "socialSecurityTaxWithheldCents": 324_983,
                "medicareWagesCents": 5_241_657,
                "medicareTaxWithheldCents": 76_004,
            },
            {
                "ref": "w-dana",
                "ssn": DANA_SSN.replace("-", ""),
                "firstName": "Dana",
                "middleName": "L",
                "lastName": "Reyes",
                "suffix": "Jr",
                "address": ADDRESS,
                "wagesCents": 1_800_000,
            },
        ],
    }


def nec_request() -> dict[str, Any]:
    return {
        "formType": "1099NEC",
        "taxYear": 2026,
        "employer": copy.deepcopy(EMPLOYER),
        "recipients": [
            {
                "ref": "w-tyrone",
                "tinType": "SSN",
                "tin": TYRONE_SSN,
                "firstName": "Tyrone",
                "lastName": "Whitaker",
                "address": ADDRESS,
                "nonemployeeCompensationCents": 1_260_050,
            },
            {
                "ref": "w-parts",
                "tinType": "EIN",
                "tin": SUPPLIER_EIN,
                "businessName": "Lookout Mobile Detailing LLC",
                "address": ADDRESS,
                "nonemployeeCompensationCents": 480_000,
                "federalTaxWithheldCents": 115_200,
            },
        ],
    }


@pytest.fixture
def client(outbound: Outbound) -> Iterator[TestClient]:
    """Filing is parked by default; these tests switch it on, with credentials for the fake TaxBandits."""
    with make_client(outbound, filing_enabled=True, taxbandits=CREDENTIALS) as test_client:
        yield test_client


def consent(client: TestClient, auth: dict[str, str]) -> None:
    response = client.post("/v1/filing/consent", headers=auth, json={"consentVersion": filing.CONSENT_VERSION})
    assert response.status_code == 200, response.text


@pytest.fixture
def consented(client: TestClient, auth: dict[str, str]) -> dict[str, str]:
    consent(client, auth)
    return auth


@pytest.fixture
def always_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(filing, "STATUS_REFRESH_INTERVAL", timedelta(0))


def assert_no_secrets(haystack: str) -> None:
    for secret in SECRETS:
        assert secret not in haystack
        assert secret.replace("-", "") not in haystack


# ---- Availability and consent -------------------------------------------------


def test_filing_routes_do_not_exist_unless_switched_on_with_credentials(
    outbound: Outbound, identity: FakeIdentityProviders, taxbandits: FakeTaxBandits
) -> None:
    # Off by default; credentials alone are not enough.
    for overrides in ({}, {"taxbandits": CREDENTIALS}):
        with make_client(outbound, **overrides) as client:
            auth = new_user(client, identity, "user-1")
            assert client.get("/health").status_code == 200
            assert client.get("/v1/meta").json()["filing"]["available"] is False
            assert client.get("/v1/business", headers=auth).status_code == 404
            for method, path in (
                ("POST", "/v1/filing/consent"),
                ("GET", "/v1/filing/consent"),
                ("POST", "/v1/filings"),
                ("GET", "/v1/filings"),
                ("GET", "/v1/filings/abc"),
                ("POST", "/v1/filings/abc/transmit"),
            ):
                response = client.request(method, path, headers=auth, json=w2_request() if method == "POST" else None)
                assert response.status_code == 404, (method, path)
                assert response.json() == {"error": {"code": "not_found", "message": "No such endpoint."}}
            assert not any("filing" in path for path in client.get("/openapi.json").json()["paths"])
    assert taxbandits.calls == []
    assert taxbandits.token_requests == []


def test_filing_is_available_when_switched_on(client: TestClient) -> None:
    assert client.get("/v1/meta").json()["filing"]["available"] is True
    assert "/v1/filings" in client.get("/openapi.json").json()["paths"]


def test_filing_needs_consent(client: TestClient, auth: dict[str, str], taxbandits: FakeTaxBandits) -> None:
    assert client.get("/v1/filing/consent", headers=auth).json()["consented"] is False
    for method, path in (
        ("POST", "/v1/filings"),
        ("GET", "/v1/filings"),
        ("GET", "/v1/filings/abc"),
        ("POST", "/v1/filings/abc/transmit"),
    ):
        response = client.request(method, path, headers=auth, json=w2_request() if method == "POST" else None)
        assert response.status_code == 403, (method, path)
        assert response.json()["error"]["code"] == "consent_required"
    assert taxbandits.calls == []
    assert taxbandits.token_requests == []


def test_consent_is_recorded_with_time_and_version_and_can_be_withdrawn(
    client: TestClient, auth: dict[str, str], other: dict[str, str]
) -> None:
    stale = client.post("/v1/filing/consent", headers=auth, json={"consentVersion": "1999-01-01"})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "consent_version_mismatch"
    assert client.post("/v1/filing/consent", headers=auth, json={}).status_code == 400

    given = client.post("/v1/filing/consent", headers=auth, json={"consentVersion": filing.CONSENT_VERSION})
    assert given.status_code == 200
    state = given.json()
    assert state["consented"] is True
    assert state["consentVersion"] == filing.CONSENT_VERSION
    assert state["consentedAt"].endswith("Z")
    assert client.get("/v1/filing/consent", headers=auth).json() == state
    assert client.get("/v1/filings", headers=auth).json() == {"filings": []}

    # One user's consent does not cover another.
    assert client.get("/v1/filings", headers=other).status_code == 403

    assert client.delete("/v1/filing/consent", headers=auth).status_code == 204
    assert client.get("/v1/filing/consent", headers=auth).json()["consentedAt"] is None
    assert client.get("/v1/filings", headers=auth).status_code == 403


def test_consent_to_an_older_text_no_longer_counts(
    client: TestClient, consented: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(filing, "CONSENT_VERSION", "2027-01-01")
    assert client.get("/v1/filings", headers=consented).status_code == 403


# ---- Create -------------------------------------------------------------------


def test_creates_a_w2_filing(client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits) -> None:
    response = client.post("/v1/filings", headers=consented, json=w2_request())
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["formType"] == "W2"
    assert created["taxYear"] == 2026
    assert created["status"] == "created"
    assert created["transmittedAt"] is None
    assert created["employer"] == {"name": "Ridgeline Auto Repair", "einLast4": "7305"}
    assert created["recipients"] == [
        {
            "ref": "w-marcus",
            "name": "Marcus Bell",
            "tinType": "SSN",
            "tinLast4": "7890",
            "amountCents": 5_241_657,
            "status": "created",
            "statusMessage": None,
        },
        {
            "ref": "w-dana",
            "name": "Dana Reyes",
            "tinType": "SSN",
            "tinLast4": "1234",
            "amountCents": 1_800_000,
            "status": "created",
            "statusMessage": None,
        },
    ]

    # Nothing has gone to the SSA: only the Create call was made.
    assert taxbandits.paths() == ["POST formw2/create"]
    (sent,) = taxbandits.bodies("formw2/create")
    assert sent["SubmissionManifest"] == {
        "TaxYear": "2026",
        "IsFederal": True,
        "IsState": False,
        "IsDistribution": False,
        "IsScheduleFiling": False,
    }
    assert sent["ReturnHeader"]["Business"] == {
        "TINDetails": {"Format": "PLAIN_TIN", "TINType": "EIN", "TIN": EIN},
        "BusinessNm": "Ridgeline Auto Repair",
        "Address": {
            "Address1": "2140 Alder St",
            "Address2": "Unit B",
            "City": "Chattanooga",
            "ProvinceOrState": "TN",
            "ZipCd": "37404",
            "Country": "US",
        },
        "ContactDetails": {"FirstNm": "Renee", "LastNm": "Okafor", "Phone": "4235550142"},
        "W2Specific": {"KindOfEmployer": "NONEAPPLY", "KindOfPayer": "REGULAR941"},
    }
    marcus, dana = sent["ReturnData"]
    assert marcus["SequenceId"] == "1"
    assert marcus["ReturnManifest"] == {"IsFederal": True, "IsState": False, "IsDistribution": False}
    assert marcus["Employee"]["TINDetails"] == {"Format": "PLAIN_TIN", "TINType": "SSN", "TIN": MARCUS_SSN}
    assert marcus["Employee"]["IndividualNm"] == {"FirstNm": "Marcus", "LastNm": "Bell"}
    assert marcus["W2FormData"] == {
        "Wages": 52416.57,
        "FedTaxWH": 4982.0,
        "SocSecWages": 52416.57,
        "SocSecTaxWH": 3249.83,
        "MediWages": 52416.57,
        "MediTaxWH": 760.04,
    }
    # An SSN typed without dashes is sent in the same dashed form.
    assert dana["Employee"]["TINDetails"]["TIN"] == DANA_SSN
    assert dana["Employee"]["IndividualNm"] == {
        "FirstNm": "Dana",
        "MiddleNm": "L",
        "LastNm": "Reyes",
        "Suffix": "Jr",
    }
    assert dana["W2FormData"] == {"Wages": 18000.0}


def test_creates_a_1099nec_filing(client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits) -> None:
    response = client.post("/v1/filings", headers=consented, json=nec_request())
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["formType"] == "1099NEC"
    assert [(r["name"], r["tinType"], r["tinLast4"], r["amountCents"]) for r in created["recipients"]] == [
        ("Tyrone Whitaker", "SSN", "9876", 1_260_050),
        ("Lookout Mobile Detailing LLC", "EIN", "3445", 480_000),
    ]

    assert taxbandits.paths() == ["POST form1099nec/create"]
    (sent,) = taxbandits.bodies("form1099nec/create")
    assert "W2Specific" not in sent["ReturnHeader"]["Business"]
    person, business = sent["ReturnData"]
    assert person["ReturnManifest"] == {
        "IsFederal": True,
        "IsState": False,
        "IsDistribution": False,
        "IsForced": False,
    }
    assert person["Recipient"]["TINDetails"] == {"Format": "PLAIN_TIN", "TINType": "SSN", "TIN": TYRONE_SSN}
    assert person["Recipient"]["IndividualNm"] == {"FirstNm": "Tyrone", "LastNm": "Whitaker"}
    assert person["NECFormData"] == {"NEC": 12600.5}
    assert business["Recipient"]["TINDetails"] == {
        "Format": "PLAIN_TIN",
        "TINType": "EIN",
        "TIN": SUPPLIER_EIN,
    }
    assert business["Recipient"]["BusinessNm"] == "Lookout Mobile Detailing LLC"
    assert "IndividualNm" not in business["Recipient"]
    assert business["NECFormData"] == {"NEC": 4800.0, "FedTaxWH": 1152.0}


def test_authenticates_to_taxbandits_with_a_signed_jws_and_reuses_the_token(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    client.post("/v1/filings", headers=consented, json=w2_request())
    client.post("/v1/filings", headers=consented, json=nec_request())
    assert len(taxbandits.calls) == 2
    (token_request,) = taxbandits.token_requests
    assert token_request.url == "https://testoauth.expressauth.net/v2/token"
    assert token_request.headers["Authentication"].count(".") == 2
    assert "authorization" not in token_request.headers


@pytest.mark.parametrize(
    ("change", "path"),
    [
        (lambda r: r["recipients"][0].update(ssn="412-55-789"), "W2.recipients.0.ssn"),
        (lambda r: r["recipients"][0].update(ssn="000-12-3456"), "W2.recipients.0.ssn"),
        (lambda r: r["recipients"][0].update(ssn="912-34-5678"), "W2.recipients.0.ssn"),
        (lambda r: r["recipients"][0].update(ssn=412557890), "W2.recipients.0.ssn"),
        (lambda r: r["employer"].update(ein="6-21847305"), "W2.employer.ein"),
        (lambda r: r["employer"].update(ein="00-1234567"), "W2.employer.ein"),
        (lambda r: r["employer"]["address"].update(state="Tennessee"), "W2.employer.address.state"),
        (lambda r: r["employer"]["address"].update(zip="3740"), "W2.employer.address.zip"),
        (lambda r: r["employer"].pop("contact"), "W2.employer.contact"),
        (lambda r: r.update(taxYear=2019), "W2.taxYear"),
        (lambda r: r["recipients"][0].update(wagesCents=-1), "W2.recipients.0.wagesCents"),
        (lambda r: r["recipients"][0].update(wagesCents=1.5), "W2.recipients.0.wagesCents"),
        (lambda r: r["recipients"][1].update(ref="w-marcus"), "W2.recipients"),
        (lambda r: r.update(recipients=[]), "W2.recipients"),
        (lambda r: r.update(recipients=r["recipients"] * 13), "W2.recipients"),
        (lambda r: r.update(formType="1099MISC"), "body"),
    ],
)
def test_rejects_invalid_w2_requests_before_anything_leaves_the_server(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits, change: Any, path: str
) -> None:
    request = w2_request()
    change(request)
    response = client.post("/v1/filings", headers=consented, json=request)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert path in [detail["path"] for detail in error["details"]]
    # The error says which field is wrong without repeating what was typed.
    assert_no_secrets(response.text)
    assert "412-55-789" not in response.text
    assert taxbandits.calls == []


def test_rejects_invalid_1099nec_recipients(client: TestClient, consented: dict[str, str]) -> None:
    def post(**changes: Any) -> httpx.Response:
        request = nec_request()
        request["recipients"][0].update(changes)
        return client.post("/v1/filings", headers=consented, json=request)

    assert post(tinType="EIN").status_code == 400  # an SSN is not shaped like an EIN
    assert post(tinType="EIN", tin=SUPPLIER_EIN).status_code == 400  # a business needs businessName
    assert post(firstName=None).status_code == 400
    assert post(tinType="ITIN").status_code == 400  # ITINs start with 9
    assert post(tinType="ITIN", tin="912-70-1234").status_code == 201
    assert post(nonemployeeCompensationCents=0).status_code == 400


def test_a_partly_refused_submission_is_rolled_back(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    taxbandits.reject_sequence_ids = {"2"}
    response = client.post("/v1/filings", headers=consented, json=w2_request())
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "filing_rejected"
    assert error["details"] == [
        {
            "code": "F00-100145",
            "field": "TIN",
            "message": "TIN [redacted] is invalid",
            "recipientRef": "w-dana",
        }
    ]
    # The return TaxBandits did create is deleted again, and nothing is stored here.
    assert taxbandits.paths() == ["POST formw2/create", "DELETE formw2/delete"]
    assert len(taxbandits.deleted) == 1
    assert client.get("/v1/filings", headers=consented).json() == {"filings": []}


def test_a_fully_refused_submission_reports_why(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    taxbandits.reject_sequence_ids = {"1", "2"}
    response = client.post("/v1/filings", headers=consented, json=nec_request())
    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert [detail["recipientRef"] for detail in details] == ["w-tyrone", "w-parts"]
    assert_no_secrets(response.text)
    assert taxbandits.deleted == []


def test_taxbandits_being_down_is_a_502_and_stores_nothing(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    taxbandits.failing = {"create"}
    response = client.post("/v1/filings", headers=consented, json=w2_request())
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "filing_provider_unavailable"
    assert client.get("/v1/filings", headers=consented).json() == {"filings": []}


def test_a_revoked_access_token_is_replaced_once(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    assert client.post("/v1/filings", headers=consented, json=w2_request()).status_code == 201
    taxbandits.expire_tokens_once = True
    assert client.post("/v1/filings", headers=consented, json=nec_request()).status_code == 201
    assert len(taxbandits.token_requests) == 2


# ---- Transmit and status ------------------------------------------------------


def test_transmit_is_a_separate_step_and_happens_once(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    created = client.post("/v1/filings", headers=consented, json=w2_request()).json()
    assert taxbandits.transmitted == set()

    response = client.post(f"/v1/filings/{created['id']}/transmit", headers=consented)
    assert response.status_code == 200, response.text
    sent = response.json()
    assert sent["status"] == "transmitted"
    assert sent["transmittedAt"] is not None
    assert [recipient["status"] for recipient in sent["recipients"]] == ["transmitted", "transmitted"]

    (body,) = taxbandits.bodies("formw2/transmit")
    assert len(body["RecordIds"]) == 2
    assert taxbandits.transmitted == set(body["RecordIds"])

    again = client.post(f"/v1/filings/{created['id']}/transmit", headers=consented)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_transmitted"
    assert len(taxbandits.bodies("formw2/transmit")) == 1


def test_status_is_refreshed_from_taxbandits(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits, always_refresh: None
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=nec_request()).json()["id"]

    # Before transmission there is nothing to ask TaxBandits about.
    assert client.get(f"/v1/filings/{filing_id}", headers=consented).json()["status"] == "created"
    assert not any("status" in path for path in taxbandits.paths())

    client.post(f"/v1/filings/{filing_id}/transmit", headers=consented)
    taxbandits.federal_status = "SENT_TO_AGENCY"
    pending = client.get(f"/v1/filings/{filing_id}", headers=consented).json()
    assert pending["status"] == "sent_to_agency"
    assert pending["statusCheckedAt"] is not None

    taxbandits.federal_status = "ACCEPTED"
    listed = client.get("/v1/filings", headers=consented).json()["filings"]
    assert [(item["id"], item["status"]) for item in listed] == [(filing_id, "accepted")]

    # Accepted is final: no further status calls are made for it.
    calls_before = len(taxbandits.calls)
    assert client.get(f"/v1/filings/{filing_id}", headers=consented).json()["status"] == "accepted"
    assert len(taxbandits.calls) == calls_before


def test_a_rejection_carries_the_reason_with_numbers_scrubbed(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits, always_refresh: None
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    client.post(f"/v1/filings/{filing_id}/transmit", headers=consented)
    taxbandits.federal_status = "REJECTED"
    taxbandits.status_message = f"Name does not match SSN {MARCUS_SSN}"

    rejected = client.get(f"/v1/filings/{filing_id}", headers=consented).json()
    assert rejected["status"] == "rejected"
    assert rejected["recipients"][0]["statusMessage"] == "Name does not match SSN [redacted]"


def test_status_checks_are_spaced_out(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    client.post(f"/v1/filings/{filing_id}/transmit", headers=consented)
    for _ in range(3):
        client.get(f"/v1/filings/{filing_id}", headers=consented)
    assert not any("status" in path for path in taxbandits.paths())


def test_a_failed_refresh_returns_the_last_known_status(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits, always_refresh: None
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    client.post(f"/v1/filings/{filing_id}/transmit", headers=consented)
    taxbandits.failing = {"status"}
    response = client.get(f"/v1/filings/{filing_id}", headers=consented)
    assert response.status_code == 200
    assert response.json()["status"] == "transmitted"


def test_a_transmit_that_times_out_is_checked_before_it_can_be_repeated(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    url = f"/v1/filings/{filing_id}/transmit"

    taxbandits.failing = {"transmit", "status"}
    lost = client.post(url, headers=consented)
    assert lost.status_code == 502
    assert "may or may not have been sent" in lost.json()["error"]["message"]

    # While TaxBandits cannot say what happened, a second attempt is not sent.
    assert client.post(url, headers=consented).status_code == 502
    assert len(taxbandits.bodies("formw2/transmit")) == 1

    # TaxBandits is back and reports the returns untouched: sending again is safe.
    taxbandits.failing = set()
    assert client.post(url, headers=consented).status_code == 200
    assert len(taxbandits.bodies("formw2/transmit")) == 2


def test_a_timed_out_transmit_that_did_go_through_is_not_sent_twice(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    created = client.post("/v1/filings", headers=consented, json=w2_request()).json()
    url = f"/v1/filings/{created['id']}/transmit"
    taxbandits.failing = {"transmit"}
    assert client.post(url, headers=consented).status_code == 502

    # The request reached TaxBandits even though the reply was lost.
    taxbandits.failing = set()
    taxbandits.transmitted = {body for call in taxbandits.bodies("formw2/transmit") for body in call["RecordIds"]}
    assert client.post(url, headers=consented).status_code == 409
    assert len(taxbandits.bodies("formw2/transmit")) == 1
    assert client.get(f"/v1/filings/{created['id']}", headers=consented).json()["transmittedAt"] is not None


def test_a_refused_transmit_can_be_retried(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits, monkeypatch: pytest.MonkeyPatch
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    refusal = httpx.Response(400, json={"Errors": [{"Id": "F00-1", "Name": "Balance", "Message": "No credits"}]})
    monkeypatch.setattr(taxbandits, "_transmit", lambda form, body: refusal)
    response = client.post(f"/v1/filings/{filing_id}/transmit", headers=consented)
    assert response.status_code == 422
    assert response.json()["error"]["details"] == [{"code": "F00-1", "field": "Balance", "message": "No credits"}]
    monkeypatch.undo()
    assert client.post(f"/v1/filings/{filing_id}/transmit", headers=consented).status_code == 200


def test_filings_belong_to_the_user_who_made_them(
    client: TestClient, consented: dict[str, str], other: dict[str, str]
) -> None:
    filing_id = client.post("/v1/filings", headers=consented, json=w2_request()).json()["id"]
    consent(client, other)
    assert client.get("/v1/filings", headers=other).json() == {"filings": []}
    for response in (
        client.get(f"/v1/filings/{filing_id}", headers=other),
        client.post(f"/v1/filings/{filing_id}/transmit", headers=other),
    ):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "filing_not_found"


def test_deleting_the_account_removes_its_consent_and_filing_records(
    client: TestClient, consented: dict[str, str]
) -> None:
    client.post("/v1/filings", headers=consented, json=w2_request())
    exported = client.get("/v1/me/export", headers=consented).json()
    assert [filing["employer"]["einLast4"] for filing in exported["filings"]] == ["7305"]
    assert client.delete("/v1/me", headers=consented).status_code == 204
    with client.app.state.sessions() as session:
        for table in ("users", "filing_consents", "filings", "filing_recipients"):
            assert session.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0, table


# ---- Limits -------------------------------------------------------------------


def test_filing_routes_are_rate_limited_per_user(outbound: Outbound, identity: FakeIdentityProviders) -> None:
    limits = {"filing_enabled": True, "taxbandits": CREDENTIALS, "filing_rate_limit_per_minute": 3}
    with make_client(outbound, **limits) as client:
        first, second = new_user(client, identity, "u1"), new_user(client, identity, "u2")
        consent(client, first)  # the first of three allowed calls
        assert [client.get("/v1/filings", headers=first).status_code for _ in range(3)] == [200, 200, 429]
        limited = client.post("/v1/filings", headers=first, json=w2_request())
        assert limited.json()["error"]["code"] == "rate_limited"
        # Another user, and routes that are not about filing, are unaffected.
        assert client.get("/v1/filing/consent", headers=second).status_code == 200
        assert client.get("/v1/backup", headers=first).status_code == 404


def test_filing_requests_have_a_small_size_limit(
    client: TestClient, consented: dict[str, str], taxbandits: FakeTaxBandits
) -> None:
    request = w2_request()
    request["padding"] = "x" * (64 * 1024)
    response = client.post("/v1/filings", headers=consented, json=request)
    assert response.status_code == 413
    assert taxbandits.calls == []


# ---- Sensitive data -----------------------------------------------------------


def run_full_flow(client: TestClient, auth: dict[str, str], taxbandits: FakeTaxBandits) -> list[str]:
    """Every filing route, happy and unhappy paths. Returns every response body."""
    bodies = []
    for request in (w2_request(), nec_request()):
        created = client.post("/v1/filings", headers=auth, json=request)
        assert created.status_code == 201
        url = f"/v1/filings/{created.json()['id']}"
        bodies += [created.text, client.post(f"{url}/transmit", headers=auth).text]
        taxbandits.federal_status = "REJECTED"
        taxbandits.status_message = f"TIN {request['recipients'][0].get('ssn', TYRONE_SSN)} does not match"
        bodies += [client.get(url, headers=auth).text, client.get("/v1/filings", headers=auth).text]

    taxbandits.reject_sequence_ids = {"1"}
    bodies.append(client.post("/v1/filings", headers=auth, json=w2_request()).text)
    taxbandits.reject_sequence_ids = set()
    taxbandits.failing = {"create"}
    bodies.append(client.post("/v1/filings", headers=auth, json=nec_request()).text)
    invalid = w2_request()
    invalid["recipients"][0]["firstName"] = ""
    bodies.append(client.post("/v1/filings", headers=auth, json=invalid).text)
    return bodies


def test_full_numbers_reach_taxbandits_and_nowhere_else(
    client: TestClient,
    consented: dict[str, str],
    taxbandits: FakeTaxBandits,
    always_refresh: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    bodies = run_full_flow(client, consented, taxbandits)

    # The numbers did go out to TaxBandits, so the checks below are not vacuous.
    sent = json.dumps(taxbandits.bodies("/create"))
    for secret in SECRETS:
        assert secret in sent

    # Never in a response.
    assert len(bodies) == 11
    for body in bodies:
        assert_no_secrets(body)

    # Never in the database: every column of every row of every table.
    engine = client.app.state.sessions.kw["bind"]
    tables = inspect(engine).get_table_names()
    assert {"filings", "filing_recipients"} <= set(tables)
    with engine.connect() as connection:
        rows = [str(tuple(row)) for table in tables for row in connection.execute(text(f"SELECT * FROM {table}"))]
    assert len(rows) >= 8
    assert any("7890" in row for row in rows), "the last four digits should be stored"
    assert_no_secrets("\n".join(rows))

    # Never in a log line, at any level.
    assert len(caplog.records) > 10
    assert_no_secrets(caplog.text)
    assert_no_secrets("\n".join(str(record.__dict__) for record in caplog.records))


def test_an_unexpected_failure_is_logged_without_request_data(
    consented: dict[str, str],
    client: TestClient,
    taxbandits: FakeTaxBandits,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def explode(request: Any) -> Any:
        raise RuntimeError(f"cannot build payload for {request.recipients[0].ssn}")

    monkeypatch.setattr(filing, "build_w2", explode)
    caplog.set_level(logging.DEBUG)
    response = client.post("/v1/filings", headers=consented, json=w2_request())
    assert response.status_code == 500
    assert response.json() == {"error": {"code": "internal_error", "message": "Something went wrong on our side."}}
    assert "unhandled RuntimeError" in caplog.text
    assert_no_secrets(caplog.text)


def test_request_models_do_not_print_numbers() -> None:
    from pydantic import TypeAdapter

    from app.filing_schemas import FilingRequest

    for request in (w2_request(), nec_request()):
        model = TypeAdapter(FilingRequest).validate_python(request)
        assert_no_secrets(repr(model))
        assert_no_secrets(str(model))
