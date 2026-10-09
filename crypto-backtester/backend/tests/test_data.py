from app.data import get_interval, load_series, load_tail, resample, span_days
from app.engine import Candle


# Epoch-aligned so four hourly bars land in one 4h bucket.
BUCKET = 1_699_992_000


def _hour(index: int, price: float) -> Candle:
    return Candle(
        time=BUCKET + index * 3600,
        open=price,
        high=price + 2,
        low=price - 2,
        close=price + 1,
        volume=index + 1,
    )


def test_resample_builds_four_hour_bars_and_skips_gaps():
    hours = [_hour(index, 100 + index) for index in range(4)]
    # Leave a hole, then one stray hour that is not a full bucket.
    hours.append(_hour(6, 200))
    bundled = resample(hours, 14_400, 3600)
    assert len(bundled) == 2
    assert bundled[0].open == 100
    assert bundled[0].close == 104
    assert bundled[0].high == 105
    assert bundled[0].low == 98
    assert bundled[0].volume == 10
    assert bundled[1].close == 201


def test_span_follows_the_requested_range_and_caps_minute_bars():
    minute = get_interval("1m")
    assert span_days(minute, 1) == 1
    assert span_days(minute, 5) == 5
    assert span_days(minute, 366) < 366
    assert span_days(minute, 0) == span_days(minute, 10_000)
    assert span_days(get_interval("1d"), 0) >= 365 * 4


def test_load_series_forwards_the_requested_span(monkeypatch):
    captured: dict[str, int | None] = {}

    def fetch(symbol, interval, spec, days=None):
        captured["days"] = days
        start = 1_700_000_000
        candles = [
            Candle(time=start + index * 60, open=100, high=101, low=99, close=100 + index, volume=1)
            for index in range(4)
        ]
        return candles, "coinbase"

    monkeypatch.setattr("app.data._fetch", fetch)
    candles, source = load_series("BTC-USD", "1m", 5)
    assert source == "coinbase"
    assert captured["days"] == 5
    assert len(candles) == 4


def test_intraday_intervals_include_minute_bars():
    assert get_interval("1m")["seconds"] == 60
    assert get_interval("5m")["coinbase"] == 300
    thirty = get_interval("30m")
    assert thirty["seconds"] == 1_800
    assert thirty["coinbase"] == 300
    assert thirty["periods_per_year"] == 365 * 48


def test_resample_builds_thirty_minute_bars():
    start = 1_700_010_000
    candles = []
    for index in range(7):
        price = 100 + index
        candles.append(
            Candle(
                time=start + index * 300,
                open=price,
                high=price + 1,
                low=price - 1,
                close=price + 0.5,
                volume=1,
            )
        )
    bundled = resample(candles, 1_800, 300)
    assert len(bundled) == 2
    assert bundled[0].time == start
    assert bundled[0].open == 100
    assert bundled[0].close == 105.5
    assert bundled[0].high == 106
    assert bundled[0].low == 99
    assert bundled[1].time == start + 1_800
    assert bundled[1].open == 106


def test_load_tail_returns_bars_from_since(monkeypatch):
    start = 1_700_000_000
    series = [
        Candle(time=start + index * 86_400, open=100, high=101, low=99, close=100 + index, volume=1)
        for index in range(4)
    ]

    def rows(product, granularity, start_at, end_at):
        assert product == "BTC-USD"
        assert granularity == 86_400
        return [[candle.time, candle.low, candle.high, candle.open, candle.close, candle.volume] for candle in series]

    monkeypatch.setattr("app.data._coinbase_rows", rows)
    candles, source = load_tail("BTC-USD", "1d", since=series[-2].time)
    assert source == "coinbase"
    assert [candle.time for candle in candles] == [series[-2].time, series[-1].time]
    assert candles[-1].close == series[-1].close
