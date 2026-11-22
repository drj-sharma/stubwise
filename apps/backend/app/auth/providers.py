"""Verifies Google and Apple ID tokens against each provider's published keys.

What is checked, and where it comes from:

Google - "Authenticate with a backend server"
(https://developers.google.com/identity/sign-in/ios/backend-auth) and
https://accounts.google.com/.well-known/openid-configuration, read 2026-11-22:
signed by a key from https://www.googleapis.com/oauth2/v3/certs (RS256); `aud`
is one of our client IDs; `iss` is accounts.google.com or
https://accounts.google.com; `exp` has not passed. We additionally require
`email_verified` when an email is present.

Apple - "Verifying a user"
(https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
and https://appleid.apple.com/.well-known/openid-configuration, read
2026-11-22: signed by a key from https://appleid.apple.com/auth/keys; `iss` is
https://appleid.apple.com; `aud` is our client_id (the app's bundle ID for a
native app); `exp` has not passed; the `nonce` matches.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import jwt

from ..errors import ApiError

log = logging.getLogger(__name__)

Provider = Literal["google", "apple"]

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
APPLE_ISSUERS = ("https://appleid.apple.com",)
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

# UNVERIFIED: Apple's "Verifying a user" page says to verify "the JWS E256
# signature", which reads like ES256, while Apple's own OpenID configuration
# lists only RS256 under id_token_signing_alg_values_supported and its published
# keys are RSA. Only RS256 is accepted here, for both providers.
_ALGORITHMS = ["RS256"]

_MIN_KEY_TTL, _DEFAULT_KEY_TTL, _MAX_KEY_TTL = 300, 3600, 86_400
# An unknown `kid` triggers a refetch (keys rotate), but not more often than
# this, so a stream of forged tokens cannot make us hammer the provider.
_REFETCH_INTERVAL = 60


@dataclass(frozen=True, slots=True)
class VerifiedIdentity:
    provider: Provider
    subject: str
    email: str | None
    name: str | None


class JwksCache:
    """A provider's signing keys, cached for as long as its Cache-Control header allows."""

    def __init__(self, url: str, http: httpx.Client, clock: Callable[[], float] = time.monotonic) -> None:
        self._url = url
        self._http = http
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None
        self._ttl = 0.0

    def key(self, kid: str) -> Any | None:
        with self._lock:
            now = self._clock()
            age = None if self._fetched_at is None else now - self._fetched_at
            stale = age is None or age >= self._ttl
            unknown_and_refetchable = kid not in self._keys and (age is None or age >= _REFETCH_INTERVAL)
            if stale or unknown_and_refetchable:
                self._fetch(now)
            return self._keys.get(kid)

    def _fetch(self, now: float) -> None:
        try:
            response = self._http.get(self._url)
            response.raise_for_status()
            keys = response.json()["keys"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            log.warning("could not fetch signing keys from %s: %s", self._url, type(error).__name__)
            if self._keys:
                return  # keep serving the keys we have; they usually outlive their cache lifetime
            raise ApiError(
                503, "identity_provider_unavailable", "Sign-in is temporarily unavailable. Try again shortly."
            ) from None
        parsed = {}
        for entry in keys:
            try:
                parsed[entry["kid"]] = jwt.PyJWK(entry).key
            except (jwt.PyJWTError, KeyError, TypeError):
                continue  # a key type we do not use
        self._keys = parsed
        self._fetched_at = now
        max_age = re.search(r"max-age=(\d+)", response.headers.get("cache-control", ""))
        self._ttl = min(max(int(max_age[1]) if max_age else _DEFAULT_KEY_TTL, _MIN_KEY_TTL), _MAX_KEY_TTL)


class IdentityVerifier:
    def __init__(self, *, google_client_ids: tuple[str, ...], apple_client_ids: tuple[str, ...], http: httpx.Client):
        self._audiences: dict[Provider, tuple[str, ...]] = {"google": google_client_ids, "apple": apple_client_ids}
        self._issuers: dict[Provider, tuple[str, ...]] = {"google": GOOGLE_ISSUERS, "apple": APPLE_ISSUERS}
        self._keys: dict[Provider, JwksCache] = {
            "google": JwksCache(GOOGLE_JWKS_URL, http),
            "apple": JwksCache(APPLE_JWKS_URL, http),
        }

    def enabled(self, provider: Provider) -> bool:
        return bool(self._audiences[provider])

    def verify(self, provider: Provider, token: str, *, nonce: str | None = None) -> VerifiedIdentity:
        """Returns who the token is about, or raises a 401 that says nothing about why.

        The reason is logged (never the token) so a misconfigured client ID can be diagnosed.
        """
        if not self.enabled(provider):
            raise ApiError(503, "provider_not_configured", f"Sign in with {provider.title()} is not set up.")
        try:
            claims = self._decode(provider, token)
            _check_nonce(claims, nonce)
            return _identity(provider, claims)
        except (jwt.PyJWTError, _Rejected) as error:
            log.info("rejected %s identity token: %s", provider, type(error).__name__)
            raise ApiError(401, "invalid_identity_token", "That sign-in could not be verified.") from None

    def _decode(self, provider: Provider, token: str) -> dict[str, Any]:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if header.get("alg") not in _ALGORITHMS or not isinstance(kid, str):
            raise _Rejected("unsupported header")
        key = self._keys[provider].key(kid)
        if key is None:
            raise _Rejected("unknown key")
        return jwt.decode(
            token,
            key,
            algorithms=_ALGORITHMS,
            audience=list(self._audiences[provider]),
            issuer=list(self._issuers[provider]),
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=30,  # clock difference between the provider and us
        )


class _Rejected(Exception):
    pass


def _check_nonce(claims: dict[str, Any], nonce: str | None) -> None:
    # A token minted with a nonce is bound to one sign-in attempt; it is only
    # accepted together with that nonce. A token without one carries no such
    # protection, and the caller cannot claim it does.
    claimed = claims.get("nonce")
    if (claimed is not None or nonce is not None) and claimed != nonce:
        raise _Rejected("nonce mismatch")


def _identity(provider: Provider, claims: dict[str, Any]) -> VerifiedIdentity:
    subject = claims["sub"]
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise _Rejected("bad subject")
    email = claims.get("email")
    if not isinstance(email, str) or not email or len(email) > 320:
        email = None
    # Apple sends "true"/"false" as strings in some tokens and booleans in others.
    verified = claims.get("email_verified") in (True, "true")
    if provider == "google" and email is not None and not verified:
        raise _Rejected("email not verified")
    if provider == "apple" and not verified:
        email = None  # never store an address the provider does not vouch for
    name = claims.get("name") if provider == "google" else None  # Apple never puts the name in the token
    return VerifiedIdentity(
        provider=provider,
        subject=subject,
        email=email,
        name=name.strip()[:120] if isinstance(name, str) and name.strip() else None,
    )
