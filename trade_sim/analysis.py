"""Performance summaries for a trade journal (TradeTracker.to_frame()) and an equity curve."""
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
