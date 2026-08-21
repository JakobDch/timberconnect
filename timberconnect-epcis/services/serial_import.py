"""
Wrapper around the EECC-supplied timber-event script (formerly serial-import.sh).

The script derives GS1 identifiers directly from a raw document and prints an
EPCIS 2.0 JSON-LD event to stdout. Since the 2026-08-10 release it ships five
format drivers covering the whole demonstrator chain (see FORMAT_FOR_TYPE):

  seed     Stammzertifikat (PDF->JSON)  ObjectEvent, creating_class_instance
  hpr      StanForD Harvester log       ObjectEvent, commissioning
  eldat    KWF transport log            ObjectEvent, commissioning
  sawdecl  Leistungserklaerung          transformationEvent
  module   ERP-Auszug BSP               transformationEvent

NOTE: we do NOT rely on parsing the script's JSON -- it is not valid JSON (the
comma after the "@context" array is missing, verified 2026-08-10). Instead we
extract the identifiers (which are emitted reliably) with regular expressions,
and rebuild a clean EPCIS document ourselves in epcis_builder.py. This keeps
the EECC identifier logic authoritative while producing output the EPCAT
repository accepts.

For transformation formats the input/output split matters, so we parse the
script's *list blocks* (inputEpcList vs outputEpcList) rather than scraping
bare identifiers out of the whole document.

The document hash and transaction ID are obtained from the script's dedicated
--hash / --tractid modes rather than by scraping the generated event, because
the transaction ID is not necessarily a hash: eldat defines an idpattern of
"%n_%.%s", and the JSON drivers use a document number from the file itself
(seed: fields.zertifikatNr, sawdecl: fields.nr, module: product.auftrag).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


def _to_bash_path(path: str) -> str:
    """Normalise a filesystem path for bash.

    On Linux/Docker this just swaps backslashes (a no-op for native paths). On
    Windows the bundled bash (Git Bash / MSYS) expects POSIX paths, so a drive
    path like ``C:/x`` must become ``/c/x``.
    """
    path = os.path.abspath(path).replace("\\", "/")
    if sys.platform.startswith("win") and len(path) > 1 and path[1] == ":":
        path = "/" + path[0].lower() + path[2:]
    return path

# Any EPC URN the script may emit. The JSON drivers pass through identities that
# are already present in the document, so both the id: (instance) and class:
# (lot) forms occur -- and for sgtin as well as lgtin.
_EPC_RE = re.compile(r"urn:epc:(?:id|class):(?:sgtin|lgtin|sscc):[^\s\"']+")
# urn:epc:id:sgtin:<gcp>.<itemref>.<serial>
_SGTIN_RE = re.compile(r"urn:epc:id:sgtin:[^\s\"']+")
# LGTIN in either form: the eldat driver builds "urn:epc:id:lgtin:", while the
# JSON drivers pass through whatever the document declares -- which per GS1 TDS
# is the class-level "urn:epc:class:lgtin:".
_LGTIN_RE = re.compile(r"urn:epc:(?:id|class):lgtin:[^\s\"']+")


def _normalize_lgtin(urn: str) -> str:
    # timber-event emits "urn:epc:id:lgtin:..." but GS1 TDS defines LGTIN
    # only as a class-level identifier; OpenEPCIS rejects the id: form.
    return urn.replace("urn:epc:id:lgtin:", "urn:epc:class:lgtin:", 1)


# SHA-1 of the empty input. The script's hash__* canonicalisers pipe through
# xmllint (.hpr) / jq (.eldat) and silently swallow their errors, so a missing
# tool yields this constant for *every* document instead of failing loudly.
_EMPTY_SHA1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709"
# quantityElement triples in the (malformed) quantityList block
_QUANT_RE = re.compile(
    r'"epcClass":\s*"(urn:epc:(?:id|class):lgtin:[^"]+)"'
    r'(?:.*?"quantity":\s*([0-9.]+))?'
    r'(?:.*?"uom":\s*"([^"]+)")?',
    re.DOTALL,
)
_BIZTX_RE = re.compile(r'"bizTransaction":\s*"([^"]+)"')

SCRIPT_NAME = "timber-event"


class SerialImportError(Exception):
    pass


# data_type -> timber-event format driver (subdirectory holding the .shar).
#
# We always pass --form explicitly instead of relying on the script's suffix
# detection: since the 2026-08-10 release three drivers (seed, sawdecl, module)
# all consume ".json", so the extension alone no longer identifies the format.
FORMAT_FOR_TYPE = {
    "forst": "hpr",
    "saegewerk": "eldat",
    "herstellung": "module",  # ERP-Auszug BSP (Excel -> JSON)
    "stammzertifikat": "seed",
    "leistungserklaerung": "sawdecl",
    # VLEX/BSPWerk has no dedicated driver; its ERP export goes through "module".
    "bspwerk": "module",
}

# Formats whose driver produces a GS1 TransformationEvent (input -> output).
TRANSFORMATION_FORMATS = {"sawdecl", "module"}

# File suffix per format. The script still derives the temp file name from it and
# xmllint/jq canonicalisation depends on the real content type.
EXTENSION_FOR_FORMAT = {
    "hpr": ".hpr",
    "eldat": ".eldat",
    "seed": ".json",
    "sawdecl": ".json",
    "module": ".json",
}

# Formats whose document identity is a *number taken from the document* rather
# than a SHA-1 of the canonicalised content. For these the empty-hash guard
# below does not apply (there is no hash to be empty).
DOCUMENT_NUMBER_FORMATS = {"seed", "sawdecl", "module"}


@dataclass
class QuantityIdent:
    epc_class: str
    quantity: Optional[float] = None
    uom: Optional[str] = None


@dataclass
class SerialImportResult:
    data_type: str
    gcp: str
    item_ref: str
    doc_base_url: str
    # SGTIN list for serialized single items (hpr)
    sgtins: list[str] = field(default_factory=list)
    # LGTIN + quantity list for lot-based items (eldat, seed)
    quantities: list[QuantityIdent] = field(default_factory=list)
    # Format driver that produced this result ("hpr", "seed", "module", ...).
    format: str = ""
    # Raw material consumed by a TransformationEvent (sawdecl, module). Empty for
    # the ObjectEvent formats. `sgtins`/`quantities` then hold the *output* side.
    input_epcs: list[str] = field(default_factory=list)
    input_quantities: list[QuantityIdent] = field(default_factory=list)
    biz_transaction_url: Optional[str] = None
    # SHA1 of the canonicalised source document, as reported by the script's
    # --hash mode (hash__* functions). This is the bare hash -- NOT the last
    # segment of the bizTransaction URL, which for eldat is "<name>_<hash>.eldat".
    #
    # CAVEAT (verified 2026-07-30): the hash is only reproducible across hosts
    # that use the same xmllint build. For a CRLF .hpr file, libxml2 2.9.14
    # (debian bookworm / this image) strips CR from its --c14n output while
    # 2.12.10 (Strawberry Perl on Windows) passes it through -- neither escapes
    # it as &#xD; per the C14N spec. Same document, two different hashes, so
    # always derive identity inside the container, never on a dev host.
    doc_hash: Optional[str] = None
    raw_stdout: str = ""

    @property
    def all_epcs(self) -> list[str]:
        """Every EPC the document touches, inputs included.

        Used for the "did we get anything at all" check and for RDF injection,
        where the distinction between consumed and produced material does not
        matter. `is_transformation` consumers must not use this.
        """
        return (
            list(self.sgtins)
            + [q.epc_class for q in self.quantities]
            + list(self.input_epcs)
            + [q.epc_class for q in self.input_quantities]
        )

    @property
    def is_transformation(self) -> bool:
        return self.format in TRANSFORMATION_FORMATS


def _format_for(data_type: str, filename: str) -> str:
    """Resolve the timber-event format driver for a data_type.

    Falls back to the uploaded file's suffix so an unmapped type still has a
    chance of matching a driver directory by name (e.g. ".hpr" -> "hpr").
    """
    fmt = FORMAT_FOR_TYPE.get(data_type)
    if fmt:
        return fmt
    suffix = os.path.splitext(filename)[1].lstrip(".").lower()
    return suffix or "hpr"


def _extension_for_format(fmt: str, filename: str) -> str:
    ext = EXTENSION_FOR_FORMAT.get(fmt)
    if ext:
        return ext
    _, suffix = os.path.splitext(filename)
    return suffix or ".hpr"


def _safe_stem(filename: str) -> str:
    """A filesystem- and URL-safe stem for the temp document.

    The eldat handler's idpattern ("%n_%.%s") embeds the file name in the
    transaction ID, so the real stem has to survive the trip through the temp
    directory -- otherwise every eldat document would be identified as
    "document_<hash>.eldat". Restricted to characters that are safe in both a
    path and a URL segment.
    """
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", stem).strip("._-")
    return stem[:80] or "document"


def _clean_identity(value: str) -> str:
    """Strip the JSON quoting the script leaves in --hash / --tractid output.

    The JSON drivers take the document identity from a field in the document
    (module: product.auftrag). They read it without unquoting, so a string value
    arrives with its JSON double quotes still attached -- ``"VA-2026-0806-114"``
    instead of ``VA-2026-0806-114``. Embedded in the bizTransaction that yields

        https://<pod>/uploads/"VA-2026-0806-114"_EN_16351

    which is not a valid URI. EPCAT still answers the capture with 202, but the
    event is silently dropped in its pipeline and never becomes queryable
    (verified 2026-08-20: identical document with the quotes removed persists).

    Quotes cannot occur legitimately in a document number or a URL, so removing
    them is safe for every driver.
    """
    return value.strip().replace('"', "")


def _run_script(
    *,
    script_path: str,
    scripts_dir: str,
    doc_path: str,
    args: list[str],
    timeout: float,
) -> str:
    """Invoke timber-event and return stdout, raising on failure."""
    bash_exe = os.getenv("TC_EPCIS_BASH", "bash")
    cmd = [bash_exe, script_path, *args, doc_path]
    logger.info("Running %s: %s <doc>", SCRIPT_NAME, " ".join(cmd[:-1]))
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, cwd=scripts_dir
        )
    except subprocess.TimeoutExpired as exc:
        raise SerialImportError(
            f"{SCRIPT_NAME} timed out after {timeout}s"
        ) from exc

    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        raise SerialImportError(
            f"{SCRIPT_NAME} failed (exit {proc.returncode}): {stderr[:500]}"
        )
    if stderr.strip():
        # uuidgen-not-found and similar are non-fatal; the identifiers are
        # what we consume. Log so it is visible but don't fail.
        logger.warning("%s stderr: %s", SCRIPT_NAME, stderr.strip()[:500])
    return stdout


def run_serial_import(
    *,
    content: bytes,
    filename: str,
    data_type: str,
    gcp: str,
    item_ref: str,
    doc_base_url: str,
    scripts_dir: str,
    timeout: float,
    doc_id: Optional[str] = None,
) -> SerialImportResult:
    """Run timber-event on `content` and extract the generated identifiers."""
    fmt = _format_for(data_type, filename)
    ext = _extension_for_format(fmt, filename)
    script_path = os.path.join(scripts_dir, SCRIPT_NAME)
    if not os.path.isfile(script_path):
        raise SerialImportError(f"{SCRIPT_NAME} not found at {script_path}")
    if not os.path.isfile(os.path.join(scripts_dir, fmt, f"{SCRIPT_NAME}.shar")):
        raise SerialImportError(
            f"{SCRIPT_NAME}: no format driver '{fmt}' for data_type '{data_type}' "
            f"(expected {fmt}/{SCRIPT_NAME}.shar in {scripts_dir})"
        )
    # Hand bash a POSIX path (drive-letter rewrite on Windows hosts).
    script_path = _to_bash_path(script_path)

    # --form pins the driver explicitly. Three drivers share the ".json" suffix,
    # so the script's own suffix detection cannot tell them apart.
    form_arg = f"--form={fmt}"

    with tempfile.TemporaryDirectory() as tmp:
        # The stem is preserved because eldat's idpattern embeds it in the
        # transaction ID; the suffix still drives canonicalisation.
        doc_path = os.path.join(tmp, f"{_safe_stem(filename)}{ext}")
        with open(doc_path, "wb") as fh:
            fh.write(content)
        doc_path = _to_bash_path(doc_path)

        event_args = [
            form_arg,
            f"--gcp={gcp}",
            f"--item={item_ref}",
            f"--url={doc_base_url}",
        ]
        if doc_id:
            event_args.append(f"--doc={doc_id}")

        stdout = _run_script(
            script_path=script_path,
            scripts_dir=scripts_dir,
            doc_path=doc_path,
            args=event_args,
            timeout=timeout,
        )

        # Ask the script directly for the canonical hash and the transaction ID
        # instead of scraping them back out of the generated event.
        doc_hash = _clean_identity(
            _run_script(
                script_path=script_path,
                scripts_dir=scripts_dir,
                doc_path=doc_path,
                args=[form_arg, "--hash"],
                timeout=timeout,
            )
        ) or None
        biz_transaction_url = _clean_identity(
            _run_script(
                script_path=script_path,
                scripts_dir=scripts_dir,
                doc_path=doc_path,
                args=[form_arg, "--tractid", f"--url={doc_base_url}"],
                timeout=timeout,
            )
        ) or None

    if doc_hash == _EMPTY_SHA1 and fmt not in DOCUMENT_NUMBER_FORMATS:
        # Canonicalisation produced no bytes -- almost always a missing xmllint
        # (.hpr) or jq (.eldat) in the image. Every document would collide on
        # this one hash, so fail loudly rather than emit a bogus identity.
        # The JSON drivers take their identity from a document number instead,
        # so this guard does not apply to them.
        raise SerialImportError(
            f"{SCRIPT_NAME} returned the empty-input hash ({_EMPTY_SHA1}) for "
            f"{data_type}; the canonicalisation tool (xmllint for .hpr, jq for "
            ".eldat) is likely missing from the image"
        )
    if not doc_hash and fmt in DOCUMENT_NUMBER_FORMATS:
        # seed/sawdecl/module derive their identity from a field in the document
        # (zertifikatNr / nr / auftrag). An empty result means that field is
        # missing -- the document would land in the pod without an identity.
        raise SerialImportError(
            f"{SCRIPT_NAME}: format '{fmt}' produced no document identity; the "
            "identifying field is missing from the document "
            "(seed: fields.zertifikatNr, sawdecl: fields.nr, module: product.auftrag)"
        )

    return _parse_output(
        stdout=stdout,
        data_type=data_type,
        gcp=gcp,
        item_ref=item_ref,
        doc_base_url=doc_base_url,
        doc_hash=doc_hash,
        biz_transaction_url=biz_transaction_url,
        fmt=fmt,
    )


def _list_block(stdout: str, name: str) -> str:
    """Return the text of the JSON array belonging to `name`.

    The script's output is not valid JSON, so we slice the block textually:
    from `"<name>": [` to the matching `]`. Returns "" when absent.
    """
    start = stdout.find(f'"{name}"')
    if start < 0:
        return ""
    open_bracket = stdout.find("[", start)
    if open_bracket < 0:
        return ""
    depth = 0
    for i in range(open_bracket, len(stdout)):
        ch = stdout[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return stdout[open_bracket : i + 1]
    return stdout[open_bracket:]


def _epcs_in(block: str) -> list[str]:
    """EPC URNs in a block, de-duplicated, order preserved."""
    seen: set[str] = set()
    out: list[str] = []
    for epc in _EPC_RE.findall(block):
        if epc not in seen:
            seen.add(epc)
            out.append(epc)
    return out


def _quants_in(block: str) -> list[QuantityIdent]:
    """quantityElement triples in a block, de-duplicated by epcClass."""
    seen: set[str] = set()
    out: list[QuantityIdent] = []
    for match in _QUANT_RE.finditer(block):
        epc_class = match.group(1)
        if epc_class in seen:
            continue
        seen.add(epc_class)
        quantity = float(match.group(2)) if match.group(2) else None
        out.append(QuantityIdent(_normalize_lgtin(epc_class), quantity, match.group(3)))
    # Fallback: bare LGTINs the structured regex missed.
    for lgtin in _LGTIN_RE.findall(block):
        if lgtin not in seen:
            seen.add(lgtin)
            out.append(QuantityIdent(_normalize_lgtin(lgtin)))
    return out


def _parse_transformation(result: SerialImportResult, stdout: str) -> None:
    """Split a transformationEvent into its consumed and produced sides.

    Parsed per list block rather than over the whole document: inputs and
    outputs are both plain EPC URNs, so a document-wide scan would merge the
    raw material into the product list and destroy the traceability link.
    """
    result.input_epcs = _epcs_in(_list_block(stdout, "inputEpcList"))
    result.input_quantities = _quants_in(_list_block(stdout, "inputQuantityList"))

    out_block = _list_block(stdout, "outputEpcList")
    out_quant_block = _list_block(stdout, "outputQuantityList")
    # Output EPCs keep their instance/class form as the document declared them;
    # only the quantity list is LGTIN-normalised for OpenEPCIS.
    result.sgtins = _epcs_in(out_block)
    result.quantities = _quants_in(out_quant_block)


def _parse_output(
    *,
    stdout: str,
    data_type: str,
    gcp: str,
    item_ref: str,
    doc_base_url: str,
    doc_hash: Optional[str] = None,
    biz_transaction_url: Optional[str] = None,
    fmt: str = "",
) -> SerialImportResult:
    result = SerialImportResult(
        data_type=data_type,
        gcp=gcp,
        item_ref=item_ref,
        doc_base_url=doc_base_url,
        raw_stdout=stdout,
        doc_hash=doc_hash,
        biz_transaction_url=biz_transaction_url,
        format=fmt,
    )

    if fmt in TRANSFORMATION_FORMATS:
        _parse_transformation(result, stdout)
    elif "quantityList" in stdout or "lgtin" in stdout:
        seen: set[str] = set()
        for match in _QUANT_RE.finditer(stdout):
            epc_class = match.group(1)
            if epc_class in seen:
                continue
            seen.add(epc_class)
            quantity = float(match.group(2)) if match.group(2) else None
            uom = match.group(3)
            result.quantities.append(
                QuantityIdent(_normalize_lgtin(epc_class), quantity, uom)
            )
        # Fallback: if the structured regex missed some, grab bare LGTINs.
        for lgtin in _LGTIN_RE.findall(stdout):
            if lgtin not in seen:
                seen.add(lgtin)
                result.quantities.append(QuantityIdent(_normalize_lgtin(lgtin)))
    else:
        # SGTIN list (hpr) — de-duplicate while preserving order.
        seen_s: set[str] = set()
        for sgtin in _SGTIN_RE.findall(stdout):
            if sgtin not in seen_s:
                seen_s.add(sgtin)
                result.sgtins.append(sgtin)

    # --hash / --tractid are authoritative; only fall back to scraping the
    # event when they were not supplied (e.g. by a direct _parse_output call).
    if not result.biz_transaction_url:
        biz = _BIZTX_RE.search(stdout)
        if biz:
            result.biz_transaction_url = biz.group(1)

    if not result.all_epcs:
        raise SerialImportError(
            f"{SCRIPT_NAME} produced no identifiers; "
            "check that the document matches its type/extension"
        )
    if result.is_transformation and not (result.input_epcs or result.input_quantities):
        # A transformation without raw material breaks the chain: the product
        # would appear from nowhere and its origin becomes unqueryable.
        raise SerialImportError(
            f"{SCRIPT_NAME}: format '{fmt}' produced a transformation event "
            "without input EPCs; the document is missing its raw-material "
            "identities (sawdecl: fields.sawings[].materialInputEpc, "
            "module: identification.identityInput)"
        )

    logger.info(
        "%s[%s] extracted %d output EPC(s), %d quantity/-ies, %d input EPC(s), id=%s",
        SCRIPT_NAME,
        fmt or "auto",
        len(result.sgtins),
        len(result.quantities),
        len(result.input_epcs) + len(result.input_quantities),
        result.doc_hash,
    )
    return result
