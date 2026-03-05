"""
SSE Utilities for TimberConnect Chat Agent

Server-Sent Events formatting and parsing utilities.
"""

import json
from typing import Dict, Any, Optional


def format_sse_event(data: Dict[str, Any], event_type: str) -> str:
    """
    Format data as a Server-Sent Event string.

    Args:
        data: Dictionary to send as JSON
        event_type: Event type name (e.g., 'message_chunk', 'visualization')

    Returns:
        Formatted SSE string ready to send
    """
    json_data = json.dumps(data, ensure_ascii=False)
    return f"event: {event_type}\ndata: {json_data}\n\n"


def format_sse_comment(comment: str) -> str:
    """
    Format a comment in SSE format.
    Comments are used for keep-alive signals.

    Args:
        comment: Comment text

    Returns:
        Formatted SSE comment string
    """
    return f": {comment}\n\n"


def parse_sse_event(raw: str) -> Optional[Dict[str, Any]]:
    """
    Parse a raw SSE event string.

    Args:
        raw: Raw SSE string (e.g., 'event: message\ndata: {...}\n\n')

    Returns:
        Dictionary with 'event' and 'data' keys, or None if parsing fails
    """
    lines = raw.strip().split('\n')
    event_type = None
    data = None

    for line in lines:
        if line.startswith('event:'):
            event_type = line[6:].strip()
        elif line.startswith('data:'):
            data_str = line[5:].strip()
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                data = data_str

    if event_type or data:
        return {"event": event_type, "data": data}

    return None


def create_keepalive() -> str:
    """
    Create a keep-alive SSE comment.

    Returns:
        SSE comment string for keep-alive
    """
    return ": keepalive\n\n"
