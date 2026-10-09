from app.data import resample
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
