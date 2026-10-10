"""Next-open backtest.

A signal is fixed when a bar closes. The fill happens on the following bar's
open, worsened by slippage. Nothing in the signal uses that future open.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.strategies import StrategyError, generate_signals, get_strategy, resolve_params


class BacktestError(ValueError):
    pass


@dataclass(frozen=True)
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Trade:
    entry_time: int
    exit_time: int | None
    side: str
    entry_price: float
    exit_price: float | None
    quantity: float
    pnl: float
    return_pct: float
    bars_held: int
    status: str


@dataclass(frozen=True)
class EquityPoint:
    time: int
    equity: float
    benchmark: float
    drawdown_pct: float
    price: float


@dataclass(frozen=True)
class Metrics:
    total_return_pct: float
    benchmark_return_pct: float
    excess_return_pct: float
    cagr_pct: float | None
    max_drawdown_pct: float
    sharpe: float | None
    sortino: float | None
    win_rate_pct: float | None
    profit_factor: float | None
    trades: int
    exposure_pct: float
    final_equity: float
    avg_trade_pct: float | None
    best_trade_pct: float | None
    worst_trade_pct: float | None


@dataclass(frozen=True)
class BacktestResult:
    strategy_id: str
    params: dict[str, float]
    start: int
    end: int
    bars: int
    metrics: Metrics
    equity: list[EquityPoint]
    trades: list[Trade]
    candles: list[Candle]


def run_backtest(
    candles: list[Candle],
    strategy_id: str,
    raw_params: dict[str, float] | None,
    *,
    initial_capital: float,
    fee_bps: float,
    slippage_bps: float,
    allow_short: bool,
    start: int | None = None,
    end: int | None = None,
    periods_per_year: float = 365,
) -> BacktestResult:
    if len(candles) < 3:
        raise BacktestError("Need at least three bars before a backtest means anything.")
    if initial_capital <= 0:
        raise BacktestError("Starting capital has to be greater than zero.")

    spec = get_strategy(strategy_id)
    try:
        params = resolve_params(spec, raw_params)
    except StrategyError as exc:
        raise BacktestError(str(exc)) from exc

    lo, hi = _window(candles, start, end)
    sim_start = lo if lo > 0 else 1
    if hi - sim_start + 1 < 2:
        raise BacktestError("This window is too short. Widen the dates or pick a coarser interval.")

    closes = [bar.close for bar in candles]
    highs = [bar.high for bar in candles]
    lows = [bar.low for bar in candles]
    try:
        signals = generate_signals(strategy_id, closes, highs, lows, params)
    except StrategyError as exc:
        raise BacktestError(str(exc)) from exc

    fee = fee_bps / 10_000
    slip = slippage_bps / 10_000
    account = _Account(initial_capital, fee)
    bench = _benchmark(candles, sim_start, hi, initial_capital, fee, slip)

    equity: list[EquityPoint] = []
    trades: list[Trade] = []
    peak = initial_capital
    exposed = 0
    open_trade: dict | None = None

    for index in range(sim_start, hi + 1):
        target = signals[index - 1]
        if not allow_short and target < 0:
            target = 0
        bar = candles[index]
        if _sign(account.qty) != target:
            if account.qty != 0 and open_trade is not None:
                fill = _close_fill(bar.open, account.qty, slip)
                # Entry fee already left the cash balance. Fold it into the
                # reported round trip so win rate and profit factor see it.
                pnl = account.close(fill) - open_trade["entry_fee"]
                notional = open_trade["quantity"] * open_trade["entry_price"]
                trades.append(
                    Trade(
                        entry_time=open_trade["entry_time"],
                        exit_time=bar.time,
                        side=open_trade["side"],
                        entry_price=open_trade["entry_price"],
                        exit_price=fill,
                        quantity=open_trade["quantity"],
                        pnl=pnl,
                        return_pct=(pnl / notional * 100) if notional else 0.0,
                        bars_held=index - open_trade["entry_index"],
                        status="closed",
                    )
                )
                open_trade = None
            if target != 0 and account.cash > 1:
                fill = _open_fill(bar.open, target, slip)
                quantity, entry_fee = account.open(target, fill)
                if quantity > 0:
                    open_trade = {
                        "entry_time": bar.time,
                        "entry_index": index,
                        "entry_price": fill,
                        "entry_fee": entry_fee,
                        "quantity": quantity,
                        "side": "long" if target > 0 else "short",
                    }

        if account.qty != 0:
            exposed += 1
        marked = account.mark(bar.close)
        peak = max(peak, marked)
        drawdown = ((marked - peak) / peak * 100) if peak else 0.0
        equity.append(
            EquityPoint(
                time=bar.time,
                equity=marked,
                benchmark=bench[index],
                drawdown_pct=drawdown,
                price=bar.close,
            )
        )

    if open_trade is not None and account.qty != 0:
        last = candles[hi]
        unrealized = account.qty * (last.close - account.entry) - open_trade["entry_fee"]
        notional = open_trade["quantity"] * open_trade["entry_price"]
        trades.append(
            Trade(
                entry_time=open_trade["entry_time"],
                exit_time=None,
                side=open_trade["side"],
                entry_price=open_trade["entry_price"],
                exit_price=last.close,
                quantity=open_trade["quantity"],
                pnl=unrealized,
                return_pct=(unrealized / notional * 100) if notional else 0.0,
                bars_held=hi - open_trade["entry_index"],
                status="open",
            )
        )

    window = candles[sim_start : hi + 1]
    metrics = _metrics(
        equity=equity,
        trades=trades,
        initial=initial_capital,
        exposed_bars=exposed,
        periods_per_year=periods_per_year,
    )
    return BacktestResult(
        strategy_id=strategy_id,
        params=params,
        start=window[0].time,
        end=window[-1].time,
        bars=len(window),
        metrics=metrics,
        equity=equity,
        trades=trades,
        candles=window,
    )


def _window(candles: list[Candle], start: int | None, end: int | None) -> tuple[int, int]:
    lo = 0
    hi = len(candles) - 1
    if start is not None:
        while lo <= hi and candles[lo].time < start:
            lo += 1
    if end is not None:
        while hi >= lo and candles[hi].time > end:
            hi -= 1
    if hi < lo:
        raise BacktestError("No bars landed inside those dates.")
    return lo, hi


def _sign(qty: float) -> int:
    if qty > 0:
        return 1
    if qty < 0:
        return -1
    return 0


def _open_fill(price: float, target: int, slip: float) -> float:
    # Buying pays up. Selling a short gets a worse (lower) print.
    return price * (1 + slip) if target > 0 else price * (1 - slip)


def _close_fill(price: float, qty: float, slip: float) -> float:
    # Closing a long sells lower. Covering a short buys higher.
    return price * (1 - slip) if qty > 0 else price * (1 + slip)


class _Account:
    """Fully funded account. Quantity is signed. Cash is realized equity."""

    def __init__(self, cash: float, fee: float) -> None:
        self.cash = cash
        self.fee = fee
        self.qty = 0.0
        self.entry = 0.0

    def open(self, side: int, fill: float) -> tuple[float, float]:
        if fill <= 0 or self.cash <= 0:
            return 0.0, 0.0
        notional = self.cash / (1 + self.fee)
        fee_paid = notional * self.fee
        self.cash -= fee_paid
        self.qty = side * (notional / fill)
        self.entry = fill
        return abs(self.qty), fee_paid

    def close(self, fill: float) -> float:
        pnl = self.qty * (fill - self.entry)
        fee_paid = abs(self.qty) * fill * self.fee
        self.cash += pnl - fee_paid
        self.qty = 0.0
        self.entry = 0.0
        return pnl - fee_paid

    def mark(self, price: float) -> float:
        if self.qty == 0:
            return self.cash
        return self.cash + self.qty * (price - self.entry)


def _benchmark(
    candles: list[Candle],
    sim_start: int,
    hi: int,
    initial: float,
    fee: float,
    slip: float,
) -> dict[int, float]:
    """Buy on the first simulated open and hold, with the same costs."""
    fill = candles[sim_start].open * (1 + slip)
    marks: dict[int, float] = {}
    if fill <= 0:
        for index in range(sim_start, hi + 1):
            marks[index] = initial
        return marks
    notional = initial / (1 + fee)
    cash = initial - notional * fee
    qty = notional / fill
    for index in range(sim_start, hi + 1):
        marks[index] = cash + qty * (candles[index].close - fill)
    return marks


def _metrics(
    *,
    equity: list[EquityPoint],
    trades: list[Trade],
    initial: float,
    exposed_bars: int,
    periods_per_year: float,
) -> Metrics:
    final = equity[-1].equity if equity else initial
    benchmark_final = equity[-1].benchmark if equity else initial
    total_return = _pct(final, initial)
    benchmark_return = _pct(benchmark_final, initial)
    closed = [trade for trade in trades if trade.status == "closed"]
    returns = [trade.return_pct for trade in closed]
    wins = [trade for trade in closed if trade.pnl > 0]
    gross_profit = sum(trade.pnl for trade in trades if trade.pnl > 0)
    gross_loss = -sum(trade.pnl for trade in trades if trade.pnl < 0)

    bar_returns: list[float] = []
    previous = initial
    for point in equity:
        if previous > 0:
            bar_returns.append(point.equity / previous - 1)
        previous = point.equity

    return Metrics(
        total_return_pct=total_return,
        benchmark_return_pct=benchmark_return,
        excess_return_pct=total_return - benchmark_return,
        cagr_pct=_cagr(initial, final, equity[0].time, equity[-1].time) if equity else None,
        max_drawdown_pct=min((point.drawdown_pct for point in equity), default=0.0),
        sharpe=_sharpe(bar_returns, periods_per_year),
        sortino=_sortino(bar_returns, periods_per_year),
        win_rate_pct=(len(wins) / len(closed) * 100) if closed else None,
        profit_factor=(gross_profit / gross_loss) if gross_loss > 0 else None,
        trades=len(closed),
        exposure_pct=(exposed_bars / len(equity) * 100) if equity else 0.0,
        final_equity=final,
        avg_trade_pct=(sum(returns) / len(returns)) if returns else None,
        best_trade_pct=max(returns) if returns else None,
        worst_trade_pct=min(returns) if returns else None,
    )


def _pct(final: float, initial: float) -> float:
    if initial == 0:
        return 0.0
    return (final / initial - 1) * 100


def _cagr(initial: float, final: float, start: int, end: int) -> float | None:
    days = (end - start) / 86_400
    if days < 1 or initial <= 0 or final <= 0:
        return None
    return ((final / initial) ** (365.25 / days) - 1) * 100


def _sharpe(returns: list[float], periods_per_year: float) -> float | None:
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
    if variance <= 0:
        return None
    return mean / variance**0.5 * periods_per_year**0.5


def _sortino(returns: list[float], periods_per_year: float) -> float | None:
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    downside = sum(min(value, 0.0) ** 2 for value in returns) / len(returns)
    if downside <= 0:
        return None
    return mean / downside**0.5 * periods_per_year**0.5
