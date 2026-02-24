import { v4 as uuidv4 } from 'uuid';
import { createLogger, format, transports } from 'winston';
import { multiTimeframeAnalysis, calculateIndicators } from './technical-analysis.js';
import { getSetting, getSettingNum, setSetting, insertTrade } from '../database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [FUTURES][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/futures.log' })],
});

/**
 * Futures $100 Katlama Motoru
 * $100 bakiye ile kalibre edilmiş, çok katmanlı sinyal puanlamalı futures trading
 */
class FuturesEngine {
  constructor(exchangeManager, riskManager, notifier) {
    this.exchangeManager = exchangeManager;
    this.riskManager = riskManager;
    this.notifier = notifier;
    this.running = false;
    this.positions = new Map(); // symbol -> position data
    this.scanTimer = null;
    this.positionTimer = null;
    this.preferredExchange = 'binance';
    this.dailyPnL = 0;
    this.dailyPnLReset = new Date().toDateString();
  }

  getCoins() {
    const raw = getSetting('futures.coins') || 'BTC/USDT,ETH/USDT,SOL/USDT';
    return raw.split(',').map(s => s.trim());
  }

  async start() {
    if (this.running) {
      logger.warn('Futures motoru zaten çalışıyor.');
      return;
    }

    this.running = true;
    logger.info('🚀 Futures $100 Katlama Motoru başlatıldı!');

    const scanInterval = getSettingNum('futures.scan_interval_sec', 60) * 1000;
    const posInterval = getSettingNum('futures.position_check_sec', 5) * 1000;

    // İlk tarama
    await this.scanSignals();

    // Sinyal tarama timer
    this.scanTimer = setInterval(() => this.scanSignals(), scanInterval);

    // Pozisyon izleme timer
    this.positionTimer = setInterval(() => this.monitorPositions(), posInterval);

    if (this.notifier) {
      await this.notifier.notifyBotStatus('Futures $100 motoru başlatıldı ✅');
    }
  }

  stop() {
    this.running = false;
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    if (this.positionTimer) { clearInterval(this.positionTimer); this.positionTimer = null; }
    logger.info('Futures motoru durduruldu.');
    if (this.notifier) {
      this.notifier.notifyBotStatus('Futures $100 motoru durduruldu ⛔');
    }
  }

  /**
   * 7 Katmanlı Sinyal Puanlama (10 üzerinden)
   */
  calculateSignalScore(mtfAnalysis) {
    const tf1h = mtfAnalysis.timeframes?.['1h'];
    const tf4h = mtfAnalysis.timeframes?.['4h'];
    const tf15m = mtfAnalysis.timeframes?.['15m'];

    if (!tf1h?.indicators || !tf4h?.indicators) {
      return { score: 0, direction: null, layers: {}, reason: 'Yetersiz veri' };
    }

    let score = 0;
    const layers = {};
    let direction = null; // 'long' veya 'short'

    // Ana sinyal yönünü belirle (1H baz)
    if (tf1h.signal?.includes('buy')) direction = 'long';
    else if (tf1h.signal?.includes('sell')) direction = 'short';
    else {
      // 4H'dan bak
      if (tf4h.signal?.includes('buy')) direction = 'long';
      else if (tf4h.signal?.includes('sell')) direction = 'short';
    }

    if (!direction) {
      return { score: 0, direction: null, layers: {}, reason: 'Yön belirlenemedi' };
    }

    // --- KATMAN 1: Trend Uyumu (0-2 puan) ---
    const trend4h = tf4h.signal || 'neutral';
    const trend1h = tf1h.signal || 'neutral';
    if (direction === 'long') {
      if (trend4h.includes('buy') && trend1h.includes('buy')) { score += 2; layers.trend = { score: 2, status: 'tam_uyum' }; }
      else if (trend4h.includes('buy') || trend1h.includes('buy')) { score += 1; layers.trend = { score: 1, status: 'kısmi_uyum' }; }
      else { layers.trend = { score: 0, status: 'uyumsuz' }; }
    } else {
      if (trend4h.includes('sell') && trend1h.includes('sell')) { score += 2; layers.trend = { score: 2, status: 'tam_uyum' }; }
      else if (trend4h.includes('sell') || trend1h.includes('sell')) { score += 1; layers.trend = { score: 1, status: 'kısmi_uyum' }; }
      else { layers.trend = { score: 0, status: 'uyumsuz' }; }
    }

    // --- KATMAN 2: RSI Onay (0-2 puan) ---
    const rsi = tf1h.indicators?.rsi;
    if (rsi !== null && rsi !== undefined) {
      if (direction === 'long') {
        if (rsi < 25) { score += 2; layers.rsi = { score: 2, value: rsi, status: 'güçlü_oversold' }; }
        else if (rsi < 35) { score += 1; layers.rsi = { score: 1, value: rsi, status: 'oversold' }; }
        else { layers.rsi = { score: 0, value: rsi, status: 'nötr' }; }
      } else {
        if (rsi > 75) { score += 2; layers.rsi = { score: 2, value: rsi, status: 'güçlü_overbought' }; }
        else if (rsi > 65) { score += 1; layers.rsi = { score: 1, value: rsi, status: 'overbought' }; }
        else { layers.rsi = { score: 0, value: rsi, status: 'nötr' }; }
      }
    } else { layers.rsi = { score: 0, value: null, status: 'veri_yok' }; }

    // --- KATMAN 3: MACD Onay (0-2 puan) ---
    const macd = tf1h.indicators?.macd;
    const macdPrev = tf1h.indicators?.macdPrev;
    if (macd && macdPrev) {
      const crossUp = macdPrev.MACD <= macdPrev.signal && macd.MACD > macd.signal;
      const crossDown = macdPrev.MACD >= macdPrev.signal && macd.MACD < macd.signal;

      if (direction === 'long') {
        if (crossUp) { score += 2; layers.macd = { score: 2, status: 'bullish_crossover' }; }
        else if (macd.histogram > 0) { score += 1; layers.macd = { score: 1, status: 'pozitif_histogram' }; }
        else { layers.macd = { score: 0, status: 'nötr' }; }
      } else {
        if (crossDown) { score += 2; layers.macd = { score: 2, status: 'bearish_crossover' }; }
        else if (macd.histogram < 0) { score += 1; layers.macd = { score: 1, status: 'negatif_histogram' }; }
        else { layers.macd = { score: 0, status: 'nötr' }; }
      }
    } else { layers.macd = { score: 0, status: 'veri_yok' }; }

    // --- KATMAN 4: Bollinger Bands (0-1 puan) ---
    const bb = tf1h.indicators?.bollinger;
    if (bb) {
      if (direction === 'long' && bb.position < 0.1) { score += 1; layers.bollinger = { score: 1, position: bb.position, status: 'alt_bant' }; }
      else if (direction === 'short' && bb.position > 0.9) { score += 1; layers.bollinger = { score: 1, position: bb.position, status: 'üst_bant' }; }
      else if (bb.squeeze) { score += 1; layers.bollinger = { score: 1, position: bb.position, status: 'squeeze' }; }
      else { layers.bollinger = { score: 0, position: bb.position, status: 'nötr' }; }
    } else { layers.bollinger = { score: 0, status: 'veri_yok' }; }

    // --- KATMAN 5: EMA Trend (0-1 puan) ---
    const ema = tf1h.indicators?.ema;
    if (ema?.ema9 && ema?.ema21 && ema?.ema50) {
      if (direction === 'long' && ema.ema9 > ema.ema21 && ema.ema21 > ema.ema50) {
        score += 1; layers.ema = { score: 1, status: 'bullish_sıralama' };
      } else if (direction === 'short' && ema.ema9 < ema.ema21 && ema.ema21 < ema.ema50) {
        score += 1; layers.ema = { score: 1, status: 'bearish_sıralama' };
      } else { layers.ema = { score: 0, status: 'karışık' }; }
    } else { layers.ema = { score: 0, status: 'veri_yok' }; }

    // --- KATMAN 6: Hacim (0-1 puan) ---
    const vol = tf1h.indicators?.volume;
    if (vol && vol.ratio >= 1.3) {
      score += 1; layers.volume = { score: 1, ratio: vol.ratio, status: 'yüksek_hacim' };
    } else {
      layers.volume = { score: 0, ratio: vol?.ratio || 0, status: 'düşük_hacim' };
    }

    // --- KATMAN 7: 15M Giriş Zamanı (0-1 puan) ---
    if (tf15m && !tf15m.error) {
      const match15m = (direction === 'long' && tf15m.signal?.includes('buy')) ||
                       (direction === 'short' && tf15m.signal?.includes('sell'));
      if (match15m) {
        score += 1; layers.entry_timing = { score: 1, signal: tf15m.signal, status: 'uyumlu' };
      } else {
        layers.entry_timing = { score: 0, signal: tf15m.signal, status: 'uyumsuz' };
      }
    } else { layers.entry_timing = { score: 0, status: 'veri_yok' }; }

    return { score, direction, layers };
  }

  /**
   * Kaldıraç belirleme
   */
  determineLeverage(score, atrPct) {
    const maxLeverage = getSettingNum('futures.max_leverage', 4);
    const defaultLeverage = getSettingNum('futures.default_leverage', 2);

    // 4x sadece: sinyal puanı 9+ VE ATR < %2
    if (score >= 9 && atrPct !== null && atrPct < 2) {
      return { leverage: Math.min(4, maxLeverage), mode: 'GÜVEN 4x 🔥' };
    }
    // ATR > %3 ise kesinlikle 2x
    if (atrPct !== null && atrPct > 3) {
      return { leverage: 2, mode: 'Normal 2x (Yüksek Volatilite)' };
    }
    return { leverage: defaultLeverage, mode: `Normal ${defaultLeverage}x` };
  }

  /**
   * Pozisyon büyüklüğü hesapla ($100 bakiye bazlı)
   */
  calculatePositionSize(balance, entryPrice, stopLossPrice, leverage) {
    const maxRiskPct = getSettingNum('risk.max_position_risk_pct', 3) / 100;
    const maxMarginPct = getSettingNum('risk.max_margin_usage_pct', 50) / 100;

    const riskUSD = balance * maxRiskPct; // ör: $100 * 0.03 = $3
    const stopDistance = Math.abs(entryPrice - stopLossPrice) / entryPrice;

    if (stopDistance === 0) return null;

    const positionValue = riskUSD / stopDistance;
    const margin = positionValue / leverage;

    // Margin kontrolü
    const maxMargin = balance * maxMarginPct;
    const actualMargin = Math.min(margin, maxMargin);
    const actualPositionValue = actualMargin * leverage;
    const amount = actualPositionValue / entryPrice;

    return {
      riskUSD,
      stopDistance: (stopDistance * 100).toFixed(2) + '%',
      positionValue: actualPositionValue,
      margin: actualMargin,
      amount,
      leverage,
    };
  }

  /**
   * Stop Loss & Take Profit hesapla
   */
  calculateSLTP(direction, entryPrice, atr, bollinger) {
    // ATR bazlı
    const atrSL = atr * 1.5;
    const atrTP = atr * 3.5;

    // Yüzde bazlı
    const pctSL = entryPrice * 0.02;
    const pctTP = entryPrice * 0.07;

    let stopLoss, takeProfit;

    if (direction === 'long') {
      // SL: Hangisi sıkıysa (entry'ye daha yakın)
      const slDist = Math.min(atrSL, pctSL);
      stopLoss = entryPrice - slDist;

      // TP: Bollinger upper veya ATR bazlı (hangisi büyükse)
      const tpDist = Math.max(atrTP, pctTP);
      takeProfit = entryPrice + tpDist;

      // Bollinger ile karşılaştır
      if (bollinger) {
        if (bollinger.lower > stopLoss) stopLoss = bollinger.lower * 0.998; // Bandın biraz altı
        if (bollinger.upper < takeProfit) takeProfit = bollinger.upper * 1.002;
      }
    } else {
      const slDist = Math.min(atrSL, pctSL);
      stopLoss = entryPrice + slDist;

      const tpDist = Math.max(atrTP, pctTP);
      takeProfit = entryPrice - tpDist;

      if (bollinger) {
        if (bollinger.upper < stopLoss) stopLoss = bollinger.upper * 1.002;
        if (bollinger.lower > takeProfit) takeProfit = bollinger.lower * 0.998;
      }
    }

    // Risk:Reward kontrolü
    const slDist = Math.abs(entryPrice - stopLoss);
    const tpDist = Math.abs(entryPrice - takeProfit);
    const rrRatio = slDist > 0 ? tpDist / slDist : 0;
    const minRR = getSettingNum('risk.min_rr_ratio', 2.5);

    if (rrRatio < minRR) {
      // TP'yi minimum R:R'a göre ayarla
      const adjustedTPDist = slDist * minRR;
      if (direction === 'long') takeProfit = entryPrice + adjustedTPDist;
      else takeProfit = entryPrice - adjustedTPDist;
    }

    return {
      stopLoss,
      takeProfit,
      slDistance: ((Math.abs(entryPrice - stopLoss) / entryPrice) * 100).toFixed(2) + '%',
      tpDistance: ((Math.abs(entryPrice - takeProfit) / entryPrice) * 100).toFixed(2) + '%',
      rrRatio: (Math.abs(entryPrice - takeProfit) / Math.abs(entryPrice - stopLoss)).toFixed(2),
    };
  }

  /**
   * Tüm coinleri tara ve sinyal üret
   */
  async scanSignals() {
    if (!this.running) return;

    // Günlük P&L reset kontrolü
    const today = new Date().toDateString();
    if (today !== this.dailyPnLReset) {
      this.dailyPnL = 0;
      this.dailyPnLReset = today;
      // Bot kilidini kontrol et
      if (getSetting('bot.locked') === '1') {
        const lockUntil = getSetting('bot.lock_until');
        if (lockUntil && new Date(lockUntil) <= new Date()) {
          setSetting('bot.locked', '0');
          setSetting('bot.lock_until', '');
          logger.info('Bot kilidi açıldı — yeni gün.');
        }
      }
    }

    // Bot kilitli mi?
    if (getSetting('bot.locked') === '1') {
      logger.warn('Bot kilitli — günlük kayıp limitine ulaşıldı.');
      return;
    }

    const coins = this.getCoins();
    const maxOpenPositions = getSettingNum('risk.max_open_positions', 2);

    if (this.positions.size >= maxOpenPositions) {
      logger.info(`Maksimum açık pozisyon sayısına ulaşıldı (${this.positions.size}/${maxOpenPositions})`);
      return;
    }

    logger.info(`🔍 Sinyal taraması başlıyor — ${coins.length} coin...`);

    for (const symbol of coins) {
      if (this.positions.size >= maxOpenPositions) break;
      if (this.positions.has(symbol)) continue; // Zaten açık pozisyon var

      try {
        const analysis = await multiTimeframeAnalysis(this.exchangeManager, this.preferredExchange, symbol);
        if (analysis.error) continue;

        const { score, direction, layers } = this.calculateSignalScore(analysis);
        const minScore = getSettingNum('futures.min_signal_score', 7);

        logger.info(`${symbol}: Sinyal Puanı ${score}/10 — Yön: ${direction || 'Yok'} — Min: ${minScore}`);

        if (score >= minScore && direction) {
          await this.openPosition(symbol, direction, score, layers, analysis);
        }
      } catch (err) {
        logger.error(`${symbol} tarama hatası: ${err.message}`);
      }
    }
  }

  /**
   * Pozisyon aç
   */
  async openPosition(symbol, direction, score, layers, analysis) {
    try {
      // Risk kontrolü
      if (this.riskManager && !this.riskManager.canTrade()) {
        logger.warn('Risk yöneticisi işleme izin vermiyor.');
        return;
      }

      // Bakiye al
      const balance = await this.getBalance();
      const tf1h = analysis.timeframes?.['1h'];
      const atrPct = tf1h?.indicators?.atrPct || null;
      const atr = tf1h?.indicators?.atr || 0;
      const bollinger = tf1h?.indicators?.bollinger || null;
      const entryPrice = tf1h?.indicators?.price;

      if (!entryPrice) {
        logger.error(`${symbol} — Giriş fiyatı alınamadı.`);
        return;
      }

      // Kaldıraç
      const { leverage, mode: leverageMode } = this.determineLeverage(score, atrPct);

      // SL & TP
      const sltp = this.calculateSLTP(direction, entryPrice, atr, bollinger);

      // Pozisyon büyüklüğü
      const sizing = this.calculatePositionSize(balance, entryPrice, sltp.stopLoss, leverage);
      if (!sizing) {
        logger.warn(`${symbol} — Pozisyon büyüklüğü hesaplanamadı.`);
        return;
      }

      // Margin kontrolü
      if (sizing.margin > balance * 0.5) {
        logger.warn(`${symbol} — Margin çok yüksek: $${sizing.margin.toFixed(2)} > $${(balance * 0.5).toFixed(2)}`);
        return;
      }

      logger.info(`📊 ${symbol} ${direction.toUpperCase()} sinyali! Puan: ${score}/10 | Kaldıraç: ${leverage}x (${leverageMode})`);
      logger.info(`   Giriş: $${entryPrice} | SL: $${sltp.stopLoss.toFixed(2)} | TP: $${sltp.takeProfit.toFixed(2)} | R:R ${sltp.rrRatio}`);
      logger.info(`   Miktar: ${sizing.amount.toFixed(6)} | Değer: $${sizing.positionValue.toFixed(2)} | Margin: $${sizing.margin.toFixed(2)}`);

      // Kaldıraç ayarla
      const futuresSymbol = symbol;
      await this.exchangeManager.setLeverage(this.preferredExchange, futuresSymbol, leverage);
      await this.exchangeManager.setMarginMode(this.preferredExchange, futuresSymbol, 'isolated');

      // Market emir
      const side = direction === 'long' ? 'buy' : 'sell';
      const order = await this.exchangeManager.createOrder(
        this.preferredExchange,
        futuresSymbol,
        'market',
        side,
        sizing.amount,
        undefined,
        { type: 'future' }
      );

      // Pozisyonu kaydet
      const position = {
        id: uuidv4(),
        symbol,
        direction,
        entryPrice,
        currentPrice: entryPrice,
        amount: sizing.amount,
        leverage,
        leverageMode,
        stopLoss: sltp.stopLoss,
        takeProfit: sltp.takeProfit,
        trailingStopActive: false,
        trailingStopPrice: null,
        partialClosed: false,
        score,
        layers,
        margin: sizing.margin,
        positionValue: sizing.positionValue,
        orderId: order.id,
        openedAt: new Date().toISOString(),
        pnl: 0,
        pnlPct: 0,
      };

      this.positions.set(symbol, position);

      // DB'ye kaydet
      insertTrade({
        exchange: this.preferredExchange,
        symbol,
        side,
        type: 'market',
        price: entryPrice,
        amount: sizing.amount,
        cost: sizing.positionValue,
        strategy: 'futures-100',
        strategy_id: position.id,
        order_id: order.id,
        status: 'filled',
        notes: `${direction.toUpperCase()} ${leverage}x | Score: ${score}/10 | SL: ${sltp.stopLoss.toFixed(2)} | TP: ${sltp.takeProfit.toFixed(2)}`,
      });

      // Telegram bildirimi
      if (this.notifier) {
        await this.notifier.notifyTrade({
          type: 'FUTURES AÇILIŞ',
          symbol,
          direction: direction.toUpperCase(),
          leverage,
          leverageMode,
          entryPrice,
          stopLoss: sltp.stopLoss,
          takeProfit: sltp.takeProfit,
          amount: sizing.amount,
          margin: sizing.margin,
          positionValue: sizing.positionValue,
          score,
          rrRatio: sltp.rrRatio,
          balance,
        });
      }

      logger.info(`✅ ${symbol} ${direction.toUpperCase()} pozisyon açıldı!`);
    } catch (err) {
      logger.error(`${symbol} pozisyon açma hatası: ${err.message}`);
    }
  }

  /**
   * Açık pozisyonları izle
   */
  async monitorPositions() {
    if (!this.running || this.positions.size === 0) return;

    for (const [symbol, pos] of this.positions) {
      try {
        const ticker = await this.exchangeManager.getTicker(this.preferredExchange, symbol);
        const currentPrice = ticker.last;
        if (!currentPrice) continue;

        pos.currentPrice = currentPrice;

        // P&L hesapla
        if (pos.direction === 'long') {
          pos.pnl = (currentPrice - pos.entryPrice) * pos.amount;
          pos.pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage;
        } else {
          pos.pnl = (pos.entryPrice - currentPrice) * pos.amount;
          pos.pnlPct = ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100 * pos.leverage;
        }

        // --- STOP LOSS kontrolü ---
        const hitSL = (pos.direction === 'long' && currentPrice <= pos.stopLoss) ||
                      (pos.direction === 'short' && currentPrice >= pos.stopLoss);

        if (hitSL) {
          await this.closePosition(symbol, 'STOP LOSS', currentPrice);
          continue;
        }

        // --- TAKE PROFIT kontrolü ---
        const hitTP = (pos.direction === 'long' && currentPrice >= pos.takeProfit) ||
                      (pos.direction === 'short' && currentPrice <= pos.takeProfit);

        if (hitTP) {
          await this.closePosition(symbol, 'TAKE PROFIT', currentPrice);
          continue;
        }

        // --- TRAILING STOP kontrolü ---
        const trailingActivatePct = getSettingNum('futures.trailing_stop_activate_pct', 2);
        const trailingDistancePct = getSettingNum('futures.trailing_stop_distance_pct', 1.5);

        if (pos.pnlPct >= trailingActivatePct && !pos.trailingStopActive) {
          pos.trailingStopActive = true;
          const distance = currentPrice * (trailingDistancePct / 100);
          pos.trailingStopPrice = pos.direction === 'long' ? currentPrice - distance : currentPrice + distance;
          logger.info(`${symbol} Trailing Stop aktif! Mesafe: ${trailingDistancePct}% | TSL: $${pos.trailingStopPrice.toFixed(2)}`);
        }

        if (pos.trailingStopActive) {
          const distance = currentPrice * (trailingDistancePct / 100);
          if (pos.direction === 'long') {
            const newTSL = currentPrice - distance;
            if (newTSL > pos.trailingStopPrice) pos.trailingStopPrice = newTSL;
            if (currentPrice <= pos.trailingStopPrice) {
              await this.closePosition(symbol, 'TRAILING STOP', currentPrice);
              continue;
            }
          } else {
            const newTSL = currentPrice + distance;
            if (newTSL < pos.trailingStopPrice) pos.trailingStopPrice = newTSL;
            if (currentPrice >= pos.trailingStopPrice) {
              await this.closePosition(symbol, 'TRAILING STOP', currentPrice);
              continue;
            }
          }
        }

        // --- KISMI KÂR kontrolü ---
        const partialClosePct = getSettingNum('futures.partial_close_pct', 4);
        const partialCloseAmount = getSettingNum('futures.partial_close_amount', 50);

        if (pos.pnlPct >= partialClosePct && !pos.partialClosed) {
          const closeAmount = pos.amount * (partialCloseAmount / 100);
          const closeSide = pos.direction === 'long' ? 'sell' : 'buy';

          try {
            await this.exchangeManager.createOrder(
              this.preferredExchange, symbol, 'market', closeSide, closeAmount, undefined, { type: 'future', reduceOnly: true }
            );

            pos.amount -= closeAmount;
            pos.partialClosed = true;
            pos.stopLoss = pos.entryPrice; // Breakeven SL

            logger.info(`${symbol} Kısmi kâr alındı! %${partialCloseAmount} kapatıldı | SL → Breakeven`);

            if (this.notifier) {
              await this.notifier.notifyTrade({
                type: 'KISMI KÂR',
                symbol,
                direction: pos.direction.toUpperCase(),
                closePrice: currentPrice,
                closedAmount: closeAmount,
                remainingAmount: pos.amount,
                pnlPct: pos.pnlPct.toFixed(2),
                newSL: pos.entryPrice,
              });
            }
          } catch (err) {
            logger.error(`${symbol} kısmi kâr hatası: ${err.message}`);
          }
        }
      } catch (err) {
        logger.error(`${symbol} pozisyon izleme hatası: ${err.message}`);
      }
    }
  }

  /**
   * Pozisyon kapat
   */
  async closePosition(symbol, reason, closePrice) {
    const pos = this.positions.get(symbol);
    if (!pos) return;

    try {
      const closeSide = pos.direction === 'long' ? 'sell' : 'buy';

      await this.exchangeManager.createOrder(
        this.preferredExchange, symbol, 'market', closeSide, pos.amount, undefined, { type: 'future', reduceOnly: true }
      );

      // Final P&L
      let finalPnL;
      if (pos.direction === 'long') {
        finalPnL = (closePrice - pos.entryPrice) * pos.amount;
      } else {
        finalPnL = (pos.entryPrice - closePrice) * pos.amount;
      }
      const finalPnLPct = pos.direction === 'long'
        ? ((closePrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage
        : ((pos.entryPrice - closePrice) / pos.entryPrice) * 100 * pos.leverage;

      // Günlük P&L güncelle
      this.dailyPnL += finalPnL;

      // DB'ye kaydet
      insertTrade({
        exchange: this.preferredExchange,
        symbol,
        side: closeSide,
        type: 'market',
        price: closePrice,
        amount: pos.amount,
        cost: pos.amount * closePrice,
        strategy: 'futures-100',
        strategy_id: pos.id,
        status: 'filled',
        pnl: finalPnL,
        notes: `${reason} | ${pos.direction.toUpperCase()} ${pos.leverage}x | Giriş: $${pos.entryPrice} → Çıkış: $${closePrice.toFixed(2)} | P&L: ${finalPnL >= 0 ? '+' : ''}$${finalPnL.toFixed(2)} (${finalPnLPct >= 0 ? '+' : ''}${finalPnLPct.toFixed(2)}%)`,
      });

      // Risk manager'a bildir
      if (this.riskManager) {
        this.riskManager.recordPnL(finalPnL);
      }

      // Günlük kayıp kontrolü
      const balance = await this.getBalance();
      const maxDailyLossPct = getSettingNum('risk.max_daily_loss_pct', 10) / 100;
      const maxDailyLoss = balance * maxDailyLossPct;

      if (this.dailyPnL < -maxDailyLoss) {
        setSetting('bot.locked', '1');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        setSetting('bot.lock_until', tomorrow.toISOString());
        logger.warn(`⚠️ GÜNLÜK KAYIP LİMİTİ! Bot kilitlendi. Günlük P&L: $${this.dailyPnL.toFixed(2)}`);
        if (this.notifier) {
          await this.notifier.notifyRiskAlert(`🚨 GÜNLÜK KAYIP LİMİTİ AŞILDI!\nGünlük P&L: $${this.dailyPnL.toFixed(2)}\nBot kilitlendi, yarın açılacak.`);
        }
      }

      const balanceAfter = balance + finalPnL;

      // Telegram
      if (this.notifier) {
        await this.notifier.notifyTrade({
          type: `FUTURES KAPANIŞ — ${reason}`,
          symbol,
          direction: pos.direction.toUpperCase(),
          leverage: pos.leverage,
          leverageMode: pos.leverageMode,
          entryPrice: pos.entryPrice,
          closePrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          amount: pos.amount,
          pnl: finalPnL,
          pnlPct: finalPnLPct,
          score: pos.score,
          balance: balanceAfter,
        });

        if (reason === 'STOP LOSS') {
          await this.notifier.notifyStopLoss({ symbol, direction: pos.direction, entryPrice: pos.entryPrice, stopPrice: closePrice, pnl: finalPnL });
        }
      }

      logger.info(`${reason === 'STOP LOSS' ? '🔴' : '🟢'} ${symbol} ${pos.direction.toUpperCase()} kapatıldı — ${reason} | P&L: ${finalPnL >= 0 ? '+' : ''}$${finalPnL.toFixed(2)} (${finalPnLPct.toFixed(2)}%)`);

      this.positions.delete(symbol);
    } catch (err) {
      logger.error(`${symbol} pozisyon kapatma hatası: ${err.message}`);
    }
  }

  /**
   * Tüm pozisyonları kapat
   */
  async closeAllPositions() {
    const symbols = [...this.positions.keys()];
    for (const symbol of symbols) {
      try {
        const ticker = await this.exchangeManager.getTicker(this.preferredExchange, symbol);
        await this.closePosition(symbol, 'MANUAL_CLOSE', ticker.last);
      } catch (err) {
        logger.error(`${symbol} toplu kapatma hatası: ${err.message}`);
      }
    }
  }

  /**
   * Bakiye al
   */
  async getBalance() {
    try {
      const bal = await this.exchangeManager.getBalance(this.preferredExchange);
      return bal.totalUSD || 100;
    } catch {
      return getSettingNum('bot.initial_balance', 100);
    }
  }

  /**
   * Analiz et (işlem açmadan)
   */
  async analyzeOnly(symbol) {
    try {
      const analysis = await multiTimeframeAnalysis(this.exchangeManager, this.preferredExchange, symbol);
      if (analysis.error) return { symbol, error: analysis.error };

      const { score, direction, layers } = this.calculateSignalScore(analysis);
      const tf1h = analysis.timeframes?.['1h'];
      const atrPct = tf1h?.indicators?.atrPct || null;
      const atr = tf1h?.indicators?.atr || 0;
      const bollinger = tf1h?.indicators?.bollinger || null;
      const entryPrice = tf1h?.indicators?.price;

      const { leverage, mode: leverageMode } = this.determineLeverage(score, atrPct);

      let sltp = null;
      let sizing = null;
      if (direction && entryPrice) {
        sltp = this.calculateSLTP(direction, entryPrice, atr, bollinger);
        const balance = await this.getBalance();
        sizing = this.calculatePositionSize(balance, entryPrice, sltp.stopLoss, leverage);
      }

      return {
        symbol,
        score,
        minScore: getSettingNum('futures.min_signal_score', 7),
        direction,
        layers,
        leverage,
        leverageMode,
        entryPrice,
        sltp,
        sizing,
        atrPct,
        wouldTrade: score >= getSettingNum('futures.min_signal_score', 7) && direction !== null,
        analysis: {
          '15m': analysis.timeframes?.['15m']?.signal,
          '1h': analysis.timeframes?.['1h']?.signal,
          '4h': analysis.timeframes?.['4h']?.signal,
        },
      };
    } catch (err) {
      logger.error(`Analiz hatası (${symbol}): ${err.message}`);
      return { symbol, error: err.message };
    }
  }

  /**
   * Durum bilgisi
   */
  getStatus() {
    return {
      running: this.running,
      positionCount: this.positions.size,
      positions: Object.fromEntries(this.positions),
      dailyPnL: this.dailyPnL,
      locked: getSetting('bot.locked') === '1',
      preferredExchange: this.preferredExchange,
      coins: this.getCoins(),
    };
  }
}

export default FuturesEngine;
