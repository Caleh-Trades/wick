"""Strategy registry. Signals are the desired position after each bar closes."""

from __future__ import annotations

from dataclasses import dataclass

from app.indicators import bollinger, ema, macd, prior_extreme, rsi, sma


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    minimum: float
    maximum: float
    step: float
    default: float
    integer: bool = True


@dataclass(frozen=True)
class StrategySpec:
    id: str
    name: str
    summary: str
    params: tuple[ParamSpec, ...]


class StrategyError(ValueError):
    pass


STRATEGIES: tuple[StrategySpec, ...] = (
    StrategySpec(
        id="buy_hold",
        name="Buy and hold",
        summary="Stay long the whole window. This is the baseline every other rule has to beat.",
        params=(),
    ),
    StrategySpec(
        id="sma_cross",
        name="SMA crossover",
        summary="Long when the fast simple average is above the slow one. Short, if you allow it, when the fast average falls back underneath.",
        params=(
            ParamSpec("fast", "Fast period", 2, 200, 1, 20),
            ParamSpec("slow", "Slow period", 3, 400, 1, 50),
        ),
    ),
    StrategySpec(
        id="ema_cross",
        name="EMA crossover",
        summary="Same cross as the simple averages, but recent closes count for more than old ones.",
        params=(
            ParamSpec("fast", "Fast period", 2, 200, 1, 12),
            ParamSpec("slow", "Slow period", 3, 400, 1, 26),
        ),
    ),
    StrategySpec(
        id="rsi_reversion",
        name="RSI reversion",
        summary="Buy a stretch below the oversold line. Leave it, or fade it, once the reading pushes through overbought.",
        params=(
            ParamSpec("period", "RSI period", 2, 100, 1, 14),
            ParamSpec("oversold", "Oversold", 5, 50, 1, 30, integer=False),
            ParamSpec("overbought", "Overbought", 50, 95, 1, 70, integer=False),
        ),
    ),
    StrategySpec(
        id="bollinger",
        name="Bollinger bounce",
        summary="Buy a close under the lower band. Exit when price gets back to the middle band.",
        params=(
            ParamSpec("period", "Period", 5, 200, 1, 20),
            ParamSpec("mult", "Band width", 0.5, 4, 0.1, 2, integer=False),
        ),
    ),
    StrategySpec(
        id="macd",
        name="MACD cross",
        summary="Long when the MACD line is above its signal line. The signal line is a moving average of the MACD itself.",
        params=(
            ParamSpec("fast", "Fast EMA", 2, 100, 1, 12),
            ParamSpec("slow", "Slow EMA", 3, 200, 1, 26),
            ParamSpec("signal", "Signal", 2, 50, 1, 9),
        ),
    ),
    StrategySpec(
        id="donchian",
        name="Donchian breakout",
        summary="Buy a close through the prior high. Get out on a close through the shorter trailing low.",
        params=(
            ParamSpec("entry", "Entry window", 2, 200, 1, 20),
            ParamSpec("exit", "Exit window", 1, 200, 1, 10),
        ),
    ),
)

_BY_ID = {spec.id: spec for spec in STRATEGIES}


def list_strategies() -> list[StrategySpec]:
    return list(STRATEGIES)


def get_strategy(strategy_id: str) -> StrategySpec:
    try:
        return _BY_ID[strategy_id]
    except KeyError as exc:
        known = ", ".join(spec.name for spec in STRATEGIES)
        raise StrategyError(f"Unknown strategy. Wick knows {known}.") from exc


def resolve_params(spec: StrategySpec, raw: dict[str, float] | None) -> dict[str, float]:
    provided = raw or {}
    unknown = sorted(set(provided) - {param.key for param in spec.params})
    if unknown:
        raise StrategyError(f"Unexpected parameter: {unknown[0]}.")

    resolved: dict[str, float] = {}
    for param in spec.params:
        value = provided.get(param.key, param.default)
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise StrategyError(f"{param.label} needs to be a number.") from exc
        if param.integer:
            number = float(int(round(number)))
        if number < param.minimum or number > param.maximum:
            raise StrategyError(
                f"{param.label} has to sit between {param.minimum:g} and {param.maximum:g}."
            )
        resolved[param.key] = number

    _validate_relationships(spec.id, resolved)
    return resolved


def _validate_relationships(strategy_id: str, params: dict[str, float]) -> None:
    if strategy_id in {"sma_cross", "ema_cross", "macd"}:
        if params["fast"] >= params["slow"]:
            raise StrategyError("The fast period has to be shorter than the slow period.")
    if strategy_id == "rsi_reversion" and params["oversold"] >= params["overbought"]:
        raise StrategyError("Oversold has to sit below overbought.")
    if strategy_id == "donchian" and params["exit"] > params["entry"]:
        raise StrategyError("The exit window should be shorter than or equal to the entry window.")


def generate_signals(
    strategy_id: str, closes: list[float], highs: list[float], lows: list[float], params: dict[str, float]
) -> list[int]:
    """Return the position desired after each close: 1 long, 0 flat, -1 short."""
    count = len(closes)
    if strategy_id == "buy_hold":
        return [1] * count
    if strategy_id == "sma_cross":
        return _cross(sma(closes, int(params["fast"])), sma(closes, int(params["slow"])))
    if strategy_id == "ema_cross":
        return _cross(ema(closes, int(params["fast"])), ema(closes, int(params["slow"])))
    if strategy_id == "rsi_reversion":
        return _rsi_reversion(
            rsi(closes, int(params["period"])),
            params["oversold"],
            params["overbought"],
        )
    if strategy_id == "bollinger":
        mid, upper, lower = bollinger(closes, int(params["period"]), params["mult"])
        return _bollinger_bounce(closes, mid, upper, lower)
    if strategy_id == "macd":
        line, signal = macd(closes, int(params["fast"]), int(params["slow"]), int(params["signal"]))
        return _cross(line, signal)
    if strategy_id == "donchian":
        return _donchian(
            closes,
            highs,
            lows,
            int(params["entry"]),
            int(params["exit"]),
        )
    raise StrategyError(f"Unknown strategy: {strategy_id}.")


def _cross(fast: list[float | None], slow: list[float | None]) -> list[int]:
    signals: list[int] = []
    for fast_value, slow_value in zip(fast, slow):
        if fast_value is None or slow_value is None:
            signals.append(0)
        elif fast_value > slow_value:
            signals.append(1)
        elif fast_value < slow_value:
            signals.append(-1)
        else:
            signals.append(0)
    return signals


def _rsi_reversion(readings: list[float | None], oversold: float, overbought: float) -> list[int]:
    signals: list[int] = []
    state = 0
    for reading in readings:
        if reading is None:
            signals.append(0)
            continue
        if reading <= oversold:
            state = 1
        elif reading >= overbought:
            state = -1
        signals.append(state)
    return signals


def _bollinger_bounce(
    closes: list[float],
    mid: list[float | None],
    upper: list[float | None],
    lower: list[float | None],
) -> list[int]:
    signals: list[int] = []
    state = 0
    for close, center, high_band, low_band in zip(closes, mid, upper, lower):
        if center is None or high_band is None or low_band is None:
            signals.append(0)
            continue
        if close < low_band:
            state = 1
        elif close > high_band:
            state = -1
        elif state == 1 and close >= center:
            state = 0
        elif state == -1 and close <= center:
            state = 0
        signals.append(state)
    return signals


def _donchian(
    closes: list[float], highs: list[float], lows: list[float], entry: int, exit_window: int
) -> list[int]:
    entry_high = prior_extreme(highs, entry, use_max=True)
    entry_low = prior_extreme(lows, entry, use_max=False)
    exit_high = prior_extreme(highs, exit_window, use_max=True)
    exit_low = prior_extreme(lows, exit_window, use_max=False)
    signals: list[int] = []
    state = 0
    for i, close in enumerate(closes):
        broke_up = entry_high[i] is not None and close > entry_high[i]
        broke_down = entry_low[i] is not None and close < entry_low[i]
        if broke_up:
            state = 1
        elif broke_down:
            state = -1
        elif state == 1 and exit_low[i] is not None and close < exit_low[i]:
            state = 0
        elif state == -1 and exit_high[i] is not None and close > exit_high[i]:
            state = 0
        signals.append(state)
    return signals
