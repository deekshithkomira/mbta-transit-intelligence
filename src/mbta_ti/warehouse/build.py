"""Build the DuckDB warehouse: raw files -> staging tables -> marts, then run data tests."""
from __future__ import annotations

import logging
from pathlib import Path

import duckdb

from mbta_ti import config

log = logging.getLogger(__name__)
SQL_DIR = Path(__file__).parent / "sql"

# Data-quality assertions: each query must return zero rows.
DATA_TESTS = {
    "ridership has no negative values":
        "SELECT * FROM mart_ridership_monthly WHERE weekday_riders < 0",
    "ridership month x line is unique":
        "SELECT month, line FROM mart_ridership_monthly GROUP BY ALL HAVING count(*) > 1",
    "OTP is a valid proportion":
        "SELECT * FROM mart_bus_otp_monthly WHERE otp < 0 OR otp > 1",
    "restricted miles never exceed line track miles":
        "SELECT * FROM mart_slow_zones_daily WHERE restricted_miles > line_track_miles",
    "gated entries are non-negative":
        "SELECT * FROM stg_gated_entries WHERE entries < 0 LIMIT 5",
    "every slow zone has an open date":
        "SELECT * FROM mart_slow_zone_lifetimes WHERE opened IS NULL",
}


def connect(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(config.WAREHOUSE), read_only=read_only)


def run() -> None:
    con = connect()
    for sql_file in sorted(SQL_DIR.glob("*.sql")):
        log.info("running %s", sql_file.name)
        con.execute(sql_file.read_text().replace("{raw}", str(config.RAW)))
    failures = []
    for name, query in DATA_TESTS.items():
        n = len(con.execute(query).fetchall())
        log.info("data test %-50s %s", name, "PASS" if n == 0 else f"FAIL ({n})")
        if n:
            failures.append(name)
    for (table,) in con.execute(
            "SELECT table_name FROM information_schema.tables ORDER BY 1").fetchall():
        rows = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        log.info("%-32s %12s rows", table, f"{rows:,}")
    con.close()
    if failures:
        raise SystemExit(f"data tests failed: {failures}")
