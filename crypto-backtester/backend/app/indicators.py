"""Causal indicators. Each value at index i uses only closes through i."""

from __future__ import annotations


def sma(values: list[float], period: int) -> list[float | None]:
    if period < 1:
        raise ValueError("period must be at least 1")
    out: list[float | None] = [None] * len(values)
    total = 0.0
    for i, value in enumerate(values):
        total += value
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def ema(values: list[float], period: int) -> list[float | None]:
    if period < 1:
        raise ValueError("period must be at least 1")
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    alpha = 2 / (period + 1)
    previous = seed
    for i in range(period, len(values)):
        previous = values[i] * alpha + previous * (1 - alpha)
        out[i] = previous
    return out


def rsi(values: list[float], period: int) -> list[float | None]:
    """Wilder RSI. Index `period` is the first defined reading."""
    if period < 1:
        raise ValueError("period must be at least 1")
    out: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return out

    gain_sum = 0.0
    loss_sum = 0.0
    for i in range(1, period + 1):
        delta = values[i] - values[i - 1]
        if delta >= 0:
            gain_sum += delta
        else:
            loss_sum -= delta
    avg_gain = gain_sum / period
    avg_loss = loss_sum / period
    out[period] = _rsi_value(avg_gain, avg_loss)

    for i in range(period + 1, len(values)):
        delta = values[i] - values[i - 1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = _rsi_value(avg_gain, avg_loss)
    return out


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def bollinger(
    values: list[float], period: int, mult: float
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """Middle band is an SMA. Bands use the population standard deviation."""
    mid = sma(values, period)
    upper: list[float | None] = [None] * len(values)
    lower: list[float | None] = [None] * len(values)
    for i, center in enumerate(mid):
        if center is None:
            continue
        window = values[i - period + 1 : i + 1]
        variance = sum((v - center) ** 2 for v in window) / period
        width = variance**0.5 * mult
        upper[i] = center + width
        lower[i] = center - width
    return mid, upper, lower


def macd(
    values: list[float], fast: int, slow: int, signal: int
) -> tuple[list[float | None], list[float | None]]:
    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    line: list[float | None] = [None] * len(values)
    defined: list[float] = []
    defined_at: list[int] = []
    for i, (fast_value, slow_value) in enumerate(zip(fast_ema, slow_ema)):
        if fast_value is None or slow_value is None:
            continue
        value = fast_value - slow_value
        line[i] = value
        defined.append(value)
        defined_at.append(i)

    signal_line: list[float | None] = [None] * len(values)
    if len(defined) < signal:
        return line, signal_line
    seeded = ema(defined, signal)
    for index, value in zip(defined_at, seeded):
        signal_line[index] = value
    return line, signal_line


def prior_extreme(values: list[float], period: int, use_max: bool) -> list[float | None]:
    """Highest or lowest value of the previous `period` bars, excluding the current bar."""
    out: list[float | None] = [None] * len(values)
    if period < 1:
        return out
    for i in range(period, len(values)):
        window = values[i - period : i]
        out[i] = max(window) if use_max else min(window)
    return out
