"""US phone numbers for the business's contact line.

Any common way of writing a 10-digit North American number is accepted
("4235550142", "423-555-0142", "(423) 555-0142", "+1 423 555 0142",
"1.423.555.0142") and stored one way: "(423) 555-0142". The area code and
the exchange cannot start with 0 or 1, and neither can be an N11 service code
(411, 911). Mirrors packages/domain/src/phone.ts.
"""

from __future__ import annotations

import re

_ALLOWED = re.compile(r"^\+?[\d\s().\-]+$")
US_PHONE_EXAMPLE = "(423) 555-0142"


def normalize_us_phone(text: str) -> str | None:
    """The number in the stored form, "" for an empty entry, or None when it is not a US number."""
    text = text.strip()
    if not text:
        return ""
    if not _ALLOWED.match(text):
        return None
    digits = re.sub(r"\D", "", text)
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    elif text.startswith("+"):
        return None  # a + must be followed by the US country code, 1
    if len(digits) != 10:
        return None
    area, exchange = digits[:3], digits[3:6]
    if area[0] in "01" or exchange[0] in "01" or area[1:] == "11" or exchange[1:] == "11":
        return None
    return f"({area}) {exchange}-{digits[6:]}"
