"""Save only static mini-program assets from an authorized mitmproxy run.

This intentionally excludes request metadata and API responses.  It writes a
small manifest containing only URL path, response content type, and byte size.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from mitmproxy import http


OUTPUT = Path(os.environ["DINGTALK_MINI_CAPTURE_DIR"]).resolve()
STATIC_TYPES = (
    "application/javascript",
    "text/javascript",
    "application/json",
    "text/css",
    "text/html",
    "application/wasm",
    "font/",
    "image/",
)
STATIC_SUFFIXES = {
    ".js", ".json", ".css", ".html", ".wasm", ".ttf", ".otf", ".woff",
    ".woff2", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".tar",
}


def _eligible(flow: http.HTTPFlow) -> bool:
    if flow.request.method != "GET" or flow.response is None:
        return False
    parsed = urlparse(flow.request.pretty_url)
    host = parsed.hostname or ""
    if not host.endswith(("dingtalkapps.com", "alicdn.com")):
        return False
    content_type = flow.response.headers.get("content-type", "").lower().split(";", 1)[0]
    suffix = Path(parsed.path).suffix.lower()
    return content_type.startswith(STATIC_TYPES) or suffix in STATIC_SUFFIXES


def response(flow: http.HTTPFlow) -> None:
    if not _eligible(flow):
        return
    parsed = urlparse(flow.request.pretty_url)
    raw_name = unquote(Path(parsed.path).name) or "index"
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)[:100]
    digest = hashlib.sha256(flow.response.content).hexdigest()[:16]
    relative = Path(parsed.hostname or "unknown") / f"{digest}-{safe_name}"
    target = OUTPUT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(flow.response.content)
        manifest = OUTPUT / "manifest.ndjson"
        entry = {
            "file": relative.as_posix(),
            "url": f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
            "content_type": flow.response.headers.get("content-type", "").split(";", 1)[0],
            "bytes": len(flow.response.content),
        }
        with manifest.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
