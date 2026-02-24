import { RSI, MACD, BollingerBands, EMA, SMA, Stochastic, ATR } from 'technicalindicators';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [TA][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/ta.log' })],
});

/**
 * Teknik Analiz Motoru
 * RSI, MACD, Bollinger Bands, EMA, SMA, Stochastic, ATR hesaplama ve sinyal üretimi
 */
export function calculateIndicators(candles) {
  if (!candles || candles.length < 50) {
    logger.warn('Yetersiz mum verisi — en az 50 mum gerekli.');
    return null;
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // RSI (14)
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

  // MACD (12, 26, 9)
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macdLatest = macdValues.length > 0 ? macdValues[macdValues.length - 1] : null;
  const macdPrev = macdValues.length > 1 ? macdValues[macdValues.length - 2] : null;

  // Bollinger Bands (20, 2)
  const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bbLatest = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;
  let bollingerPosition = null;
  if (bbLatest) {
    const range = bbLatest.upper - bbLatest.lower;
    bollingerPosition = range > 0 ? (closes[closes.length - 1] - bbLatest.lower) / range : 0.5;
  }

  // EMA (9, 21, 50)
  const ema9Values = EMA.calculate({ values: closes, period: 9 });
  const ema21Values = EMA.calculate({ values: closes, period: 21 });
  const ema50Values = EMA.calculate({ values: closes, period: 50 });
  const ema9 = ema9Values.length > 0 ? ema9Values[ema9Values.length - 1] : null;
  const ema21 = ema21Values.length > 0 ? ema21Values[ema21Values.length - 1] : null;
  const ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : null;

  // SMA (20, 50, 200)
  const sma20Values = SMA.calculate({ values: closes, period: 20 });
  const sma50Values = SMA.calculate({ values: closes, period: 50 });
  const sma200Values = SMA.calculate({ values: closes, period: Math.min(200, closes.length) });
  const sma20 = sma20Values.length > 0 ? sma20Values[sma20Values.length - 1] : null;
  const sma50 = sma50Values.length > 0 ? sma50Values[sma50Values.length - 1] : null;
  const sma200 = sma200Values.length > 0 ? sma200Values[sma200Values.length - 1] : null;

  // Stochastic (14, 3)
  const stochValues = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const stochLatest = stochValues.length > 0 ? stochValues[stochValues.length - 1] : null;

  // ATR (14)
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
  const atrPct = atr && closes[closes.length - 1] > 0 ? (atr / closes[closes.length - 1]) * 100 : null;

  // Hacim Analizi
  const recentVolumes = volumes.slice(-5);
  const baseVolumes = volumes.slice(-20);
  const avgRecentVol = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const avgBaseVol = baseVolumes.reduce((a, b) => a + b, 0) / baseVolumes.length;
  const volumeRatio = avgBaseVol > 0 ? avgRecentVol / avgBaseVol : 1;

  // Bollinger Squeeze: bantlar daralıyorsa
  let bollingerSqueeze = false;
  if (bbValues.length >= 5) {
    const recentBBWidths = bbValues.slice(-5).map(b => b.upper - b.lower);
    const prevBBWidths = bbValues.slice(-20, -5).map(b => b.upper - b.lower);
    const avgRecent = recentBBWidths.reduce((a, b) => a + b, 0) / recentBBWidths.length;
    const avgPrev = prevBBWidths.length > 0 ? prevBBWidths.reduce((a, b) => a + b, 0) / prevBBWidths.length : avgRecent;
    bollingerSqueeze = avgRecent < avgPrev * 0.7;
  }

  return {
    price: closes[closes.length - 1],
    rsi,
    macd: macdLatest ? { MACD: macdLatest.MACD, signal: macdLatest.signal, histogram: macdLatest.histogram } : null,
    macdPrev: macdPrev ? { MACD: macdPrev.MACD, signal: macdPrev.signal, histogram: macdPrev.histogram } : null,
    bollinger: bbLatest ? { upper: bbLatest.upper, middle: bbLatest.middle, lower: bbLatest.lower, position: bollingerPosition, squeeze: bollingerSqueeze } : null,
    ema: { ema9, ema21, ema50 },
    sma: { sma20, sma50, sma200 },
    stochastic: stochLatest ? { k: stochLatest.k, d: stochLatest.d } : null,
    atr,
    atrPct,
    volume: { recent: avgRecentVol, base: avgBaseVol, ratio: volumeRatio },
  };
}

/**
 * Sinyal Üretimi
 * Tüm göstergeleri değerlendir ve buy/sell sinyali oluştur
 */
export function generateSignal(indicators) {
  if (!indicators) return { signal: 'neutral', buyScore: 0, sellScore: 0, strength: 0 };

  let buyScore = 0;
  let sellScore = 0;
  const details = {};

  // 1. RSI
  if (indicators.rsi !== null) {
    if (indicators.rsi < 25) { buyScore += 2; details.rsi = 'güçlü_alım'; }
    else if (indicators.rsi < 35) { buyScore += 1; details.rsi = 'alım'; }
    else if (indicators.rsi > 75) { sellScore += 2; details.rsi = 'güçlü_satım'; }
    else if (indicators.rsi > 65) { sellScore += 1; details.rsi = 'satım'; }
    else { details.rsi = 'nötr'; }
  }

  // 2. MACD Crossover
  if (indicators.macd && indicators.macdPrev) {
    const crossUp = indicators.macdPrev.MACD <= indicators.macdPrev.signal && indicators.macd.MACD > indicators.macd.signal;
    const crossDown = indicators.macdPrev.MACD >= indicators.macdPrev.signal && indicators.macd.MACD < indicators.macd.signal;
    if (crossUp) { buyScore += 2; details.macd = 'bullish_crossover'; }
    else if (crossDown) { sellScore += 2; details.macd = 'bearish_crossover'; }
    else if (indicators.macd.histogram > 0) { buyScore += 1; details.macd = 'bullish_histogram'; }
    else if (indicators.macd.histogram < 0) { sellScore += 1; details.macd = 'bearish_histogram'; }
    else { details.macd = 'nötr'; }
  }

  // 3. Bollinger Bands
  if (indicators.bollinger) {
    if (indicators.bollinger.position < 0.1) { buyScore += 1.5; details.bollinger = 'alt_bant'; }
    else if (indicators.bollinger.position > 0.9) { sellScore += 1.5; details.bollinger = 'üst_bant'; }
    else if (indicators.bollinger.squeeze) { buyScore += 0.5; sellScore += 0.5; details.bollinger = 'squeeze'; }
    else { details.bollinger = 'nötr'; }
  }

  // 4. EMA Trend
  if (indicators.ema.ema9 && indicators.ema.ema21 && indicators.ema.ema50) {
    if (indicators.ema.ema9 > indicators.ema.ema21 && indicators.ema.ema21 > indicators.ema.ema50) {
      buyScore += 1.5; details.ema = 'güçlü_yükseliş';
    } else if (indicators.ema.ema9 < indicators.ema.ema21 && indicators.ema.ema21 < indicators.ema.ema50) {
      sellScore += 1.5; details.ema = 'güçlü_düşüş';
    } else if (indicators.ema.ema9 > indicators.ema.ema21) {
      buyScore += 0.5; details.ema = 'yükseliş';
    } else {
      sellScore += 0.5; details.ema = 'düşüş';
    }
  }

  // 5. Stochastic
  if (indicators.stochastic) {
    if (indicators.stochastic.k < 20 && indicators.stochastic.d < 20) {
      buyScore += 1; details.stochastic = 'aşırı_satım';
    } else if (indicators.stochastic.k > 80 && indicators.stochastic.d > 80) {
      sellScore += 1; details.stochastic = 'aşırı_alım';
    } else { details.stochastic = 'nötr'; }
  }

  // 6. Hacim
  if (indicators.volume.ratio > 1.5) {
    details.volume = 'yüksek_hacim';
    // Hacim artışı mevcut trendi destekliyor
    if (buyScore > sellScore) buyScore += 1;
    else if (sellScore > buyScore) sellScore += 1;
  } else if (indicators.volume.ratio > 1.2) {
    details.volume = 'artan_hacim';
  } else {
    details.volume = 'normal';
  }

  // Sinyal belirleme
  const maxScore = Math.max(buyScore, sellScore);
  const totalPossible = 10;
  const strength = Math.min(100, Math.round((maxScore / totalPossible) * 100));

  let signal = 'neutral';
  if (buyScore >= 7 && buyScore > sellScore + 2) signal = 'strong_buy';
  else if (buyScore >= 5 && buyScore > sellScore + 1) signal = 'buy';
  else if (sellScore >= 7 && sellScore > buyScore + 2) signal = 'strong_sell';
  else if (sellScore >= 5 && sellScore > buyScore + 1) signal = 'sell';

  // Stop Loss & Take Profit hesaplama
  let stopLoss = null;
  let takeProfit = null;
  if (indicators.atr && indicators.price) {
    const atrSL = indicators.atr * 1.5;
    const pctSL = indicators.price * 0.02;
    const slDistance = Math.min(atrSL, pctSL);

    const atrTP = indicators.atr * 2.5;
    const pctTP = indicators.price * 0.05;
    const tpDistance = Math.max(atrTP, pctTP);

    if (signal.includes('buy')) {
      stopLoss = indicators.price - slDistance;
      takeProfit = indicators.price + tpDistance;
    } else if (signal.includes('sell')) {
      stopLoss = indicators.price + slDistance;
      takeProfit = indicators.price - tpDistance;
    }
  }

  return {
    signal,
    buyScore: Math.round(buyScore * 10) / 10,
    sellScore: Math.round(sellScore * 10) / 10,
    strength,
    details,
    stopLoss,
    takeProfit,
    indicators,
  };
}

/**
 * Tam analiz: OHLCV verisini al, gösterge hesapla, sinyal üret
 */
export async function analyzeSymbol(exchangeManager, exchangeId, symbol, timeframe = '1h', limit = 200) {
  try {
    const candles = await exchangeManager.getOHLCV(exchangeId, symbol, timeframe, limit);
    if (!candles || candles.length < 50) {
      return { symbol, timeframe, error: 'Yetersiz veri' };
    }

    const indicators = calculateIndicators(candles);
    const signal = generateSignal(indicators);

    return {
      symbol,
      exchange: exchangeId,
      timeframe,
      ...signal,
      timestamp: Date.now(),
    };
  } catch (err) {
    logger.error(`Analiz hatası (${symbol} @ ${exchangeId}): ${err.message}`);
    return { symbol, exchange: exchangeId, timeframe, error: err.message };
  }
}

/**
 * Multi-timeframe analiz: 15m, 1h, 4h
 */
export async function multiTimeframeAnalysis(exchangeManager, exchangeId, symbol) {
  try {
    const [tf15m, tf1h, tf4h] = await Promise.all([
      analyzeSymbol(exchangeManager, exchangeId, symbol, '15m', 100),
      analyzeSymbol(exchangeManager, exchangeId, symbol, '1h', 200),
      analyzeSymbol(exchangeManager, exchangeId, symbol, '4h', 100),
    ]);

    // Trend uyumu kontrolü
    const trendAlignment = checkTrendAlignment(tf15m, tf1h, tf4h);

    return {
      symbol,
      exchange: exchangeId,
      timeframes: { '15m': tf15m, '1h': tf1h, '4h': tf4h },
      trendAlignment,
      timestamp: Date.now(),
    };
  } catch (err) {
    logger.error(`Multi-TF analiz hatası (${symbol}): ${err.message}`);
    return { symbol, exchange: exchangeId, error: err.message };
  }
}

function checkTrendAlignment(tf15m, tf1h, tf4h) {
  const signals = [tf15m?.signal, tf1h?.signal, tf4h?.signal].filter(Boolean);
  const bullish = signals.filter(s => s.includes('buy')).length;
  const bearish = signals.filter(s => s.includes('sell')).length;

  if (bullish >= 2) return { direction: 'bullish', strength: bullish === 3 ? 'güçlü' : 'orta' };
  if (bearish >= 2) return { direction: 'bearish', strength: bearish === 3 ? 'güçlü' : 'orta' };
  return { direction: 'mixed', strength: 'zayıf' };
}

export default { calculateIndicators, generateSignal, analyzeSymbol, multiTimeframeAnalysis };
