"""Extract a DingTalk mini-program tar with its legacy GBK entry names."""

from __future__ import annotations

import sys
import tarfile
from pathlib import Path


archive = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
destination.mkdir(parents=True, exist_ok=True)

with tarfile.open(archive, encoding="gbk", errors="surrogateescape") as package:
    members = package.getmembers()
    for member in members:
        target = (destination / member.name).resolve()
        if target != destination and destination not in target.parents:
            raise ValueError(f"unsafe archive entry: {member.name!r}")
    package.extractall(destination)

print(f"members={len(members)} files={sum(member.isfile() for member in members)}")
