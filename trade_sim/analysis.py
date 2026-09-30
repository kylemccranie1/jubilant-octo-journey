"""Compare a baseline strategy with filtered versions of it.

The question this answers: "if I only took the level trades where metric X was in
range Y, would results have been better?" Buckets are defined on the training period
only and then checked on the later test period, so a filter that only fits noise shows
up as a winner in-sample and a loser out-of-sample.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def summarize(trades: pd.DataFrame) -> dict:
    if trades.empty:
        return {"trades": 0}
    pnl = trades["net_pnl"]
    wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
    pf = wins.sum() / -losses.sum() if losses.sum() < 0 else float("inf")
    return {
        "trades": int(len(trades)),
        "win_rate": round(100 * len(wins) / len(trades), 1),
        "avg_return_pct": round(trades["return_pct"].mean(), 3),
        "avg_r": round(trades["r_multiple"].mean(), 3) if "r_multiple" in trades else float("nan"),
        "net_pnl": round(pnl.sum(), 2),
        "fees": round(trades["fees"].sum(), 2),
        "profit_factor": round(pf, 2),
    }


def equity_stats(equity_curve: list[tuple]) -> dict:
    if len(equity_curve) < 2:
        return {}
    s = pd.Series([e for _, e in equity_curve], index=[d for d, _ in equity_curve], dtype=float)
    rets = s.pct_change().dropna()
    dd = (s / s.cummax() - 1).min()
    sharpe = rets.mean() / rets.std() * np.sqrt(252) if rets.std() > 0 else float("nan")
    return {"start_equity": round(s.iloc[0], 2), "end_equity": round(s.iloc[-1], 2),
            "total_return_pct": round(100 * (s.iloc[-1] / s.iloc[0] - 1), 2),
            "max_drawdown_pct": round(100 * dd, 2), "sharpe": round(sharpe, 2)}


def filter_report(trades: pd.DataFrame, split=None, buckets: int = 3) -> pd.DataFrame:
    """For every f_* feature column, stats per bucket in the train and test periods.

    split: timestamp separating train (before) from test (after). Defaults to the 70th
    percentile of entry times.
    """
    if trades.empty:
        return pd.DataFrame()
    t = trades.sort_values("entry_ts")
    if split is None:
        split = t["entry_ts"].iloc[int(len(t) * 0.7)]
    train, test = t[t["entry_ts"] < split], t[t["entry_ts"] >= split]
    rows = []
    for col in [c for c in t.columns if c.startswith("f_")]:
        name = col[2:]
        if pd.api.types.is_numeric_dtype(t[col]) and t[col].nunique() > buckets:
            edges = np.unique(np.nanquantile(train[col].dropna(), np.linspace(0, 1, buckets + 1)))
            if len(edges) < 3:
                continue
            edges[0], edges[-1] = -np.inf, np.inf
            label = lambda df: pd.cut(df[col], edges, duplicates="drop").astype(str)
        else:
            label = lambda df: df[col].astype(str)
        for period, df in (("train", train), ("test", test)):
            if df.empty:
                continue
            for bucket, g in df.groupby(label(df)):
                s = summarize(g)
                rows.append({"feature": name, "bucket": bucket, "period": period, **s})
    base = []
    for period, df in (("train", train), ("test", test)):
        base.append({"feature": "(baseline)", "bucket": "all", "period": period, **summarize(df)})
    return pd.DataFrame(base + rows)
