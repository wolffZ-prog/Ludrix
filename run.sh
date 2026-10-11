#!/usr/bin/env bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
PY="${PYTHON:-python3}"
if [ ! -x .venv/bin/python ]; then
  "$PY" -m venv .venv
  .venv/bin/python -m pip install -q -U pip
  grep -v -i pyinstaller requirements.txt > /tmp/ludrix-req.txt
  .venv/bin/python -m pip install -q -r /tmp/ludrix-req.txt "pywebview[qt]" python-xlib
  .venv/bin/python -m pip install -q libtorrent || true
fi
export QTWEBENGINE_DISABLE_SANDBOX=1
exec .venv/bin/python app/main.py "$@"
