#!/usr/bin/env python3
"""Serve the repo so scripts/test-dom.html can be opened in a browser.

Reclaims the listen port if a previous run left a process bound (common when
the parent shell is killed but the Python child keeps listening).

Usage:
  python3 scripts/serve-dom-tests.py          # 127.0.0.1:8765
  python3 scripts/serve-dom-tests.py 9000     # custom port
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PORT = 8765


def pids_listening_on(port: int) -> list[int]:
    try:
        out = subprocess.check_output(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    pids = []
    for line in out.splitlines():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def reclaim_port(port: int) -> None:
    me = os.getpid()
    for pid in pids_listening_on(port):
        if pid == me:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.time() + 2.0
    while time.time() < deadline and pids_listening_on(port):
        time.sleep(0.05)
    for pid in pids_listening_on(port):
        if pid == me:
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def main() -> int:
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"usage: {sys.argv[0]} [port]", file=sys.stderr)
            return 2

    os.chdir(ROOT)
    if not port_free(port):
        print(f"port {port} in use; reclaiming…", flush=True)
        reclaim_port(port)
        if not port_free(port):
            print(f"could not free port {port}", file=sys.stderr)
            return 1

    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/scripts/test-dom.html"
    print(f"serving {ROOT} at http://127.0.0.1:{port}/", flush=True)
    print(f"DOM tests: {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
