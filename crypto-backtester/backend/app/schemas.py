"""Request bodies for the backtest desk."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str = "BTC-USD"
    interval: str = "1d"
    start: str | None = None
    end: str | None = None
    strategy: str = "sma_cross"
    params: dict[str, float] = Field(default_factory=dict)
    initial_capital: float = 10_000
    fee_bps: float = 10
    slippage_bps: float = 5
    allow_short: bool = False
