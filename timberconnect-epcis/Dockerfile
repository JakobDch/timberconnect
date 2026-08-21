FROM python:3.11-slim

# timber-event runtime dependencies:
#   bash               - the script itself
#   libxml2-utils      - xmllint (StanForD/hpr canonicalisation)
#   jq                 - ELDAT/eldat JSON canonicalisation
#   uuid-runtime       - uuidgen (eventID generation)
#   coreutils          - sha1sum/sha256sum
#   libdigest-sha-perl - shasum (used for bizTransaction hashing; not in slim)
# NOTE: xmllint and jq are load-bearing for document identity, not optional
# niceties -- the script's hash__* functions discard their stderr, so a missing
# tool silently yields the empty-input hash for every document. The wrapper
# guards against that (see _EMPTY_SHA1) but the tools must be present.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        bash libxml2-utils jq uuid-runtime coreutils libdigest-sha-perl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code. scripts/ holds timber-event plus one subdirectory per
# format driver: hpr/, eldat/, seed/, sawdecl/, module/.
COPY . .

# Ensure the import script and the bundled uuidgen fallback are executable.
# timber-event locates its type-specific shar via its own program name, so the
# script and the driver archives must keep matching names.
RUN chmod +x /app/scripts/timber-event /app/scripts/uuidgen

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
