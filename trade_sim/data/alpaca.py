"""Alpaca market data. The free Basic plan gets the IEX feed in full and the consolidated SIP
feed for anything older than 15 minutes; SIP is the better choice for backtests because
IEX carries only a few percent of volume and misses many highs and lows.

Needs ALPACA_API_KEY and ALPACA_SECRET_KEY in the environment. Only the market data API
is used; this module never talks to a brokerage or places orders.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request

import pandas as pd

from ..calendar import ET
from .store import label_sessions

BASE = "https://data.alpaca.markets/v2/stocks"


def _clamp_recent(end: str) -> str:
    """The free plan rejects SIP requests that reach into the last 15 minutes. A bare date
    counts as the whole day, so an end date of today (or later) is refused outright."""
    limit = pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=16)
    ts = pd.Timestamp(end)
    if ts.tzinfo is None:
        ts = ts.tz_localize(ET) + pd.Timedelta(days=1) if len(end) <= 10 else ts.tz_localize("UTC")
    return limit.strftime("%Y-%m-%dT%H:%M:%SZ") if ts > limit else end


def fetch_bars(symbol: str, start: str, end: str, timeframe: str = "1Min", feed: str = "iex",
               adjustment: str = "split") -> pd.DataFrame:
    key, secret = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_SECRET_KEY")
    if not key or not secret:
        raise RuntimeError("Set ALPACA_API_KEY and ALPACA_SECRET_KEY to download market data.")
    if feed == "sip":
        end = _clamp_recent(end)
    params = {"symbols": symbol, "timeframe": timeframe, "start": start, "end": end,
              "feed": feed, "adjustment": adjustment, "limit": 10000}
    rows, token = [], None
    while True:
        if token:
            params["page_token"] = token
        req = urllib.request.Request(f"{BASE}/bars?{urllib.parse.urlencode(params)}",
                                     headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.load(r)
        rows += payload.get("bars", {}).get(symbol, [])
        token = payload.get("next_page_token")
        if not token:
            break
        time.sleep(0.31)  # stay under 200 requests/minute
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "session"])
    df = pd.DataFrame(rows).rename(columns={"t": "ts", "o": "open", "h": "high", "l": "low",
                                            "c": "close", "v": "volume"})
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(ET)
    df = df.set_index("ts")[["open", "high", "low", "close", "volume"]].astype(float)
    return label_sessions(df)
