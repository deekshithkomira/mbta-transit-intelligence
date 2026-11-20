PY ?= .venv/bin/python

.PHONY: setup ingest build analyze all test lint serve

setup:
	python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"

ingest:   ; $(PY) -m mbta_ti.cli ingest
build:    ; $(PY) -m mbta_ti.cli build
analyze:  ; $(PY) -m mbta_ti.cli analyze
all:      ; $(PY) -m mbta_ti.cli all
test:     ; $(PY) -m pytest -q
lint:     ; $(PY) -m ruff check src tests
serve:    ; python3 -m http.server 8000 -d site
