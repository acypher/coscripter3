#!/usr/bin/env python3
"""Bump CoScripter3 semver in manifest.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "manifest.json"


def parse_version(value: str) -> tuple[int, int, int]:
    parts = value.strip().split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise ValueError(f"invalid semver: {value!r}")
    return int(parts[0]), int(parts[1]), int(parts[2])


def format_version(parts: tuple[int, int, int]) -> str:
    return f"{parts[0]}.{parts[1]}.{parts[2]}"


def bump_minor(current: str) -> str:
    major, minor, _patch = parse_version(current)
    return format_version((major, minor + 1, 0))


def bump_patch(current: str) -> str:
    major, minor, patch = parse_version(current)
    return format_version((major, minor, patch + 1))


def bump_major(current: str) -> str:
    major, _minor, _patch = parse_version(current)
    return format_version((major + 1, 0, 0))


def read_current_version() -> str:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return str(data["version"])


def write_manifest_version(new_version: str) -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    data["version"] = new_version
    MANIFEST.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bump CoScripter3 version in manifest.json."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--major", action="store_true", help="Bump major (X.0.0).")
    group.add_argument("--patch", action="store_true", help="Bump patch (X.Y.Z+1).")
    group.add_argument("--version", metavar="X.Y.Z", help="Set an explicit version.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned bump without writing files.",
    )
    args = parser.parse_args()

    current = read_current_version()

    if args.version:
        new_version = args.version
        if parse_version(new_version) <= parse_version(current):
            print(
                f"error: new version {new_version} must be greater than current {current}",
                file=sys.stderr,
            )
            return 1
    elif args.major:
        new_version = bump_major(current)
    elif args.patch:
        new_version = bump_patch(current)
    else:
        new_version = bump_minor(current)

    print(f"current: {current}")
    print(f"next:    {new_version}")

    if args.dry_run:
        return 0

    write_manifest_version(new_version)
    print(f"updated {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
