"""Tests that EPCIS identifier generation is mandatory (no silent fallback).

Run from the timberconnect-rml-converter directory:
    python -m pytest tests/ -v
or without pytest:
    python tests/test_epcis_mandatory.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.epcis_client import EPCISClient, EPCISClientError


async def _unreachable_raises():
    client = EPCISClient(service_url="http://127.0.0.1:1", enabled=True, timeout=2)
    try:
        await client.generate_and_capture(
            content=b"<Stem/>", filename="x.hpr", data_type="forst"
        )
    except EPCISClientError:
        return True
    return False


async def _disabled_returns_none():
    client = EPCISClient(service_url="http://127.0.0.1:1", enabled=False, timeout=2)
    result = await client.generate_and_capture(
        content=b"<Stem/>", filename="x.hpr", data_type="forst"
    )
    return result is None


async def _unsupported_type_raises():
    client = EPCISClient(service_url="http://127.0.0.1:1", enabled=True, timeout=2)
    try:
        await client.generate_and_capture(
            content=b"x", filename="x.txt", data_type="unknown"
        )
    except EPCISClientError:
        return True
    return False


def test_unreachable_service_raises():
    assert asyncio.run(_unreachable_raises()), "unreachable EPCIS must raise"


def test_disabled_returns_none():
    assert asyncio.run(_disabled_returns_none()), "EPCIS_ENABLED=false must return None"


def test_unsupported_type_raises():
    assert asyncio.run(_unsupported_type_raises()), "unsupported data_type must raise"


if __name__ == "__main__":
    checks = [
        ("unreachable service -> raises", _unreachable_raises),
        ("disabled -> returns None", _disabled_returns_none),
        ("unsupported type -> raises", _unsupported_type_raises),
    ]
    ok = True
    for name, fn in checks:
        passed = asyncio.run(fn())
        ok = ok and passed
        print(f"[{'PASS' if passed else 'FAIL'}] {name}")
    sys.exit(0 if ok else 1)
