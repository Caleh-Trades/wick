import pytest

from app.engine import BacktestError, Candle, run_backtest


def bars(prices: list[float], start: int = 1_700_000_000) -> list[Candle]:
    return [
        Candle(
            time=start + index * 86_400,
            open=price,
            high=price,
            low=price,
            close=price,
            volume=1,
        )
        for index, price in enumerate(prices)
    ]


def test_buy_and_hold_matches_the_benchmark_without_costs():
    result = run_backtest(
        bars([100, 100, 110, 120, 130]),
        "buy_hold",
        {},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
    )
    assert result.equity
    for point in result.equity:
        assert point.equity == pytest.approx(point.benchmark)
    assert result.metrics.total_return_pct == pytest.approx(30)
    assert result.trades[0].status == "open"
    assert result.trades[0].entry_time == result.candles[0].time
    assert result.trades[0].entry_price == pytest.approx(100)


def test_entry_is_the_bar_after_the_signal_close():
    prices = [1, 1, 1, 5, 5, 5, 1, 1, 1]
    result = run_backtest(
        bars(prices),
        "sma_cross",
        {"fast": 2, "slow": 3},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
    )
    closed = [trade for trade in result.trades if trade.status == "closed"]
    assert len(closed) == 1
    trade = closed[0]
    assert trade.entry_price == pytest.approx(5)
    assert trade.exit_price == pytest.approx(1)
    assert trade.entry_time == bars(prices)[4].time
    assert trade.exit_time == bars(prices)[6].time
    assert result.metrics.final_equity == pytest.approx(2_000)


def test_a_later_spike_does_not_rewrite_the_fill():
    base = [1, 1, 1, 5, 5, 5, 1, 1, 1]
    shocked = base[:-1] + [999]
    kwargs = dict(
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
    )
    first = run_backtest(bars(base), "sma_cross", {"fast": 2, "slow": 3}, **kwargs)
    second = run_backtest(bars(shocked), "sma_cross", {"fast": 2, "slow": 3}, **kwargs)
    assert first.trades[0].entry_price == pytest.approx(second.trades[0].entry_price)
    assert first.trades[0].entry_time == second.trades[0].entry_time
    assert first.trades[0].exit_price == pytest.approx(second.trades[0].exit_price)


def test_fees_drag_a_round_trip_and_a_hold():
    series = bars([100, 100, 110, 120, 130])
    free = run_backtest(
        series, "buy_hold", {}, initial_capital=10_000, fee_bps=0, slippage_bps=0, allow_short=False
    )
    costly = run_backtest(
        series, "buy_hold", {}, initial_capital=10_000, fee_bps=100, slippage_bps=0, allow_short=False
    )
    assert costly.metrics.final_equity < free.metrics.final_equity
    notional = 10_000 / 1.01
    assert costly.metrics.final_equity == pytest.approx(notional * 1.3)


def test_drawdown_from_the_peak():
    result = run_backtest(
        bars([100, 100, 150, 75, 90]),
        "buy_hold",
        {},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
    )
    assert result.metrics.max_drawdown_pct == pytest.approx(-50)


def test_shorts_can_profit_and_can_be_turned_off():
    declining = bars([12, 11, 10, 9, 8, 7, 6, 5, 4])
    short = run_backtest(
        declining,
        "sma_cross",
        {"fast": 2, "slow": 4},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=True,
    )
    flat = run_backtest(
        declining,
        "sma_cross",
        {"fast": 2, "slow": 4},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
    )
    assert any(trade.side == "short" for trade in short.trades)
    assert short.metrics.final_equity > 10_000
    assert flat.metrics.final_equity == pytest.approx(10_000)
    assert flat.trades == []


def test_fast_period_must_be_shorter_than_slow():
    with pytest.raises(BacktestError, match="fast period"):
        run_backtest(
            bars([1, 2, 3, 4, 5, 6]),
            "sma_cross",
            {"fast": 10, "slow": 5},
            initial_capital=10_000,
            fee_bps=0,
            slippage_bps=0,
            allow_short=False,
        )


def test_window_can_open_on_a_signal_from_before_the_slice():
    prices = [1, 1, 1, 5, 6, 7, 8, 9]
    series = bars(prices)
    result = run_backtest(
        series,
        "sma_cross",
        {"fast": 2, "slow": 3},
        initial_capital=10_000,
        fee_bps=0,
        slippage_bps=0,
        allow_short=False,
        start=series[4].time,
    )
    assert result.trades[0].entry_time == series[4].time
    assert result.trades[0].status == "open"
