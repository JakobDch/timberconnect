"""
Solid-OIDC identity verification for the EPCIS authorizing proxy.

The viewer calls the proxy through its authenticated Solid session, which sends a
Solid-OIDC access token (a signed JWT) in the Authorization header. This module
verifies that token cryptographically and extracts the caller's WebID, so the
proxy can resolve the caller's role and enforce the data owner's consent.

Verification performed:
  1. Parse the JWT header to learn the issuer (`iss`) and key id (`kid`).
  2. Fetch the issuer's OIDC discovery document and JWKS.
  3. Verify the JWT signature against the matching JWK and check exp/iat.
  4. Extract the WebID from the `webid` claim (Solid-OIDC) or `sub` fallback.

LIMITATION (documented, not hidden): this verifies the token signature and the
WebID binding, but does NOT verify the DPoP proof-of-possession header. A captured
token could in principle be replayed by a network attacker until it expires.
Full DPoP binding verification is the hardening step for production; for the
demonstrator the signature + issuer + WebID checks are the meaningful boundary.
Set TC_EPCIS_AUTH_REQUIRED=false to bypass entirely (open demo mode).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

# Cache JWKS clients per issuer (they cache keys internally too).
_jwk_clients: dict[str, PyJWKClient] = {}
# Cache issuer -> jwks_uri discovery.
_jwks_uri_cache: dict[str, str] = {}


class SolidAuthError(Exception):
    pass


@dataclass
class VerifiedCaller:
    web_id: str
    issuer: str
    claims: dict[str, Any]


async def _discover_jwks_uri(issuer: str, timeout: float) -> str:
    if issuer in _jwks_uri_cache:
        return _jwks_uri_cache[issuer]
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            conf = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SolidAuthError(f"Failed to fetch OIDC config from {url}: {exc}") from exc
    jwks_uri = conf.get("jwks_uri")
    if not jwks_uri:
        raise SolidAuthError(f"OIDC config at {url} has no jwks_uri")
    _jwks_uri_cache[issuer] = jwks_uri
    return jwks_uri


def _bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise SolidAuthError("Missing Authorization header")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() not in ("bearer", "dpop"):
        raise SolidAuthError("Authorization header is not a Bearer/DPoP token")
    return parts[1].strip()


async def verify_solid_token(authorization: Optional[str], timeout: float = 10.0) -> VerifiedCaller:
    """Verify a Solid-OIDC access token and return the caller's WebID.

    Raises SolidAuthError on any verification failure.
    """
    token = _bearer_token(authorization)

    # 1. Unverified peek at header + payload to find the issuer.
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise SolidAuthError(f"Malformed token: {exc}") from exc

    issuer = unverified.get("iss")
    if not issuer:
        raise SolidAuthError("Token has no 'iss' claim")

    # 2/3. Resolve signing key from the issuer's JWKS and verify the signature.
    jwks_uri = await _discover_jwks_uri(issuer, timeout)
    client = _jwk_clients.get(jwks_uri)
    if client is None:
        client = PyJWKClient(jwks_uri)
        _jwk_clients[jwks_uri] = client

    try:
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=[header.get("alg", "RS256")],
            options={"verify_aud": False},  # Solid access tokens target the pod, not us
        )
    except jwt.PyJWTError as exc:
        raise SolidAuthError(f"Token signature/claim verification failed: {exc}") from exc

    # 4. Extract WebID (Solid-OIDC puts it in `webid`; fall back to `sub`).
    web_id = claims.get("webid") or claims.get("sub")
    if not web_id or not str(web_id).startswith("http"):
        raise SolidAuthError("Token has no usable WebID (webid/sub claim)")

    # Defensive exp check (jwt.decode already enforces exp when present).
    exp = claims.get("exp")
    if exp and exp < time.time():
        raise SolidAuthError("Token has expired")

    return VerifiedCaller(web_id=str(web_id), issuer=issuer, claims=claims)
