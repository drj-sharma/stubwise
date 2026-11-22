"""The business phone: any common US format in, "(423) 555-0142" stored; anything else refused."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.domain.phone import normalize_us_phone

from .test_records import BUSINESS


@pytest.mark.parametrize(
    "typed",
    [
        "4235550142",
        "423-555-0142",
        "(423) 555-0142",
        "423.555.0142",
        "+1 423 555 0142",
        "1 (423) 555-0142",
        " 423 555 0142 ",
    ],
)
def test_common_us_formats_are_stored_one_way(typed: str) -> None:
    assert normalize_us_phone(typed) == "(423) 555-0142"


@pytest.mark.parametrize(
    "typed",
    [
        "555-0142",  # no area code
        "42355501420",  # 11 digits not starting with 1
        "+44 20 7946 0958",  # not a US number
        "+4235550142",  # a + not followed by the country code 1
        "023-555-0142",  # area code starting with 0
        "123-555-0142",  # area code starting with 1
        "423-155-0142",  # exchange starting with 1
        "911-555-0142",  # N11 area code
        "423-411-0142",  # N11 exchange
        "423-555-01x2",  # letters
        "call me",
    ],
)
def test_anything_else_is_refused(typed: str) -> None:
    assert normalize_us_phone(typed) is None


def test_empty_stays_empty() -> None:
    assert normalize_us_phone("") == ""
    assert normalize_us_phone("   ") == ""


def test_the_business_phone_is_checked_and_stored_in_one_form(client: TestClient, auth: dict[str, str]) -> None:
    bad = client.post("/v1/business", headers=auth, json={**BUSINESS, "phone": "555-0142"})
    assert bad.status_code == 400
    assert bad.json()["error"]["details"][0]["path"] == "phone"
    assert "US phone number" in bad.json()["error"]["details"][0]["message"]

    created = client.post("/v1/business", headers=auth, json={**BUSINESS, "phone": "+1 423.555.0142"})
    assert created.status_code == 201, created.text
    assert created.json()["phone"] == "(423) 555-0142"

    patched = client.patch("/v1/business", headers=auth, json={"phone": "6155550199"})
    assert patched.json()["phone"] == "(615) 555-0199"
    assert client.patch("/v1/business", headers=auth, json={"phone": "12345"}).status_code == 400
    assert client.patch("/v1/business", headers=auth, json={"phone": ""}).json()["phone"] == ""
