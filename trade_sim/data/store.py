"""Minute-bar storage: a DataFrame indexed by tz-aware US/Eastern timestamps with columns
open, high, low, close, volume, session."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..calendar import ET, TradingCalendar


def label_sessions(df: pd.DataFrame, cal: TradingCalendar | None = None) -> pd.DataFrame:
    cal = cal or TradingCalendar()
    df = df.copy()
    df.index = df.index.tz_convert(ET)
    df["session"] = [cal.session(ts).value for ts in df.index]
    return df


def save_csv(df: pd.DataFrame, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index_label="ts")


def load_csv(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["ts"], index_col="ts")
    df.index = pd.to_datetime(df.index, utc=True).tz_convert(ET)
    return df
