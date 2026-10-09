from app.indicators import bollinger, ema, prior_extreme, rsi, sma


def test_sma_uses_only_completed_bars():
    values = [1, 2, 3, 4, 5, 100]
    averages = sma(values, 3)
    assert averages[0] is None
    assert averages[1] is None
    assert averages[2] == 2
    assert averages[4] == 4
    assert averages[5] == (4 + 5 + 100) / 3


def test_ema_is_seeded_with_the_simple_average():
    values = [1, 2, 3, 4, 5]
    averages = ema(values, 3)
    assert averages[1] is None
    assert averages[2] == 2


def test_rsi_stays_inside_the_scale():
    readings = rsi([1, 2, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6], 3)
    defined = [value for value in readings if value is not None]
    assert defined
    assert all(0 <= value <= 100 for value in defined)


def test_bollinger_bands_surround_the_middle():
    mid, upper, lower = bollinger([1, 2, 3, 4, 5, 6, 7], 3, 2)
    assert mid[4] == 4
    assert upper[4] > mid[4] > lower[4]


def test_prior_extreme_excludes_the_current_bar():
    highs = prior_extreme([1, 5, 2, 9], 2, use_max=True)
    assert highs[2] == 5
    assert highs[3] == 5
