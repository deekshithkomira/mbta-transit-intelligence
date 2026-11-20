"""Shared helpers for analysis modules."""
from __future__ import annotations

import math
from datetime import date, datetime

import duckdb
import numpy as np
import pandas as pd

from mbta_ti import config


def con() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(config.WAREHOUSE), read_only=True)


def df(sql: str) -> pd.DataFrame:
    with con() as c:
        return c.execute(sql).df()


def records(frame: pd.DataFrame, round_to: int = 4) -> list[dict]:
    """JSON-safe list of dicts (dates -> ISO strings, NaN -> None, numpy -> python)."""
    out = []
    for row in frame.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if isinstance(v, (pd.Timestamp, datetime, date)):
                v = v.strftime("%Y-%m-%d")
            elif isinstance(v, (np.integer,)):
                v = int(v)
            elif isinstance(v, (float, np.floating)):
                v = None if math.isnan(v) else round(float(v), round_to)
            elif isinstance(v, np.ndarray):
                v = v.tolist()
            clean[k] = v
        out.append(clean)
    return out


def pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%"
