import { v4 as uuidv4 } from 'uuid';
import { createLogger, format, transports } from 'winston';
import { getSetting, getSettingNum, setSetting, insertArbitrageHistory, getArbitrageHistory, getArbitrageStats } from '../database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [ARB][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/arbitrage.log' })],
});

class ArbitrageEngine {
  constructor(exchangeManager, notifier) {
    this.exchangeManager = exchangeManager;
    this.notifier = notifier;
    this.opportunities = [];
    this.autoExecute = false;
    this.scanTimer = null;
  }

  getCoins() {
    const raw = getSetting('arbitrage.coins') || 'BTC/USDT,ETH/USDT,SOL/USDT';
    return raw.split(',').map(s => s.trim());
  }

  /**
   * Tüm coinleri 3 borsada tara
   */
  async scan() {
    const coins = this.getCoins();
    const minSpread = getSettingNum('arbitrage.min_spread_pct', 0.15);
    const newOpportunities = [];

    for (const symbol of coins) {
      try {
        const tickers = await this.exchangeManager.getAllTickers(symbol);
        const exchanges = Object.entries(tickers).filter(([, t]) => !t.error && t.bid && t.ask);

        if (exchanges.length < 2) continue;

        // Her çift arasında spread hesapla
        for (let i = 0; i < exchanges.length; i++) {
          for (let j = 0; j < exchanges.length; j++) {
            if (i === j) continue;

            const [buyExchange, buyTicker] = exchanges[i];
            const [sellExchange, sellTicker] = exchanges[j];

            // Al: ask (satıcının istediği) — Sat: bid (alıcının teklifi)
            const buyPrice = buyTicker.ask;
            const sellPrice = sellTicker.bid;
            const spread = ((sellPrice - buyPrice) / buyPrice) * 100;

            if (spread >= minSpread) {
              const opp = {
                id: uuidv4(),
                symbol,
                buyExchange,
                sellExchange,
                buyPrice,
                sellPrice,
                spread: spread.toFixed(4),
                timestamp: Date.now(),
              };
              newOpportunities.push(opp);

              logger.info(`💱 Arbitraj fırsatı: ${symbol} | Al: ${buyExchange} @ $${buyPrice.toFixed(2)} → Sat: ${sellExchange} @ $${sellPrice.toFixed(2)} | Spread: ${spread.toFixed(4)}%`);

              // DB'ye kaydet
              insertArbitrageHistory({
                symbol,
                buy_exchange: buyExchange,
                sell_exchange: sellExchange,
                buy_price: buyPrice,
                sell_price: sellPrice,
                spread_pct: spread,
                status: 'detected',
              });

              // Otomatik işlem
              if (this.autoExecute) {
                await this.execute(opp);
              }
            }
          }
        }
      } catch (err) {
        logger.error(`Arbitraj tarama hatası (${symbol}): ${err.message}`);
      }
    }

    this.opportunities = newOpportunities;
    return newOpportunities;
  }

  /**
   * Arbitraj işlemi yürüt
   */
  async execute(opportunity) {
    const { symbol, buyExchange, sellExchange, buyPrice, sellPrice } = opportunity;
    const startTime = Date.now();

    try {
      // Slippage kontrolü: fiyatı tekrar çek
      const [buyTicker, sellTicker] = await Promise.all([
        this.exchangeManager.getTicker(buyExchange, symbol),
        this.exchangeManager.getTicker(sellExchange, symbol),
      ]);

      const currentBuyPrice = buyTicker.ask;
      const currentSellPrice = sellTicker.bid;
      const currentSpread = ((currentSellPrice - currentBuyPrice) / currentBuyPrice) * 100;
      const minSpread = getSettingNum('arbitrage.min_spread_pct', 0.15);

      if (currentSpread < minSpread) {
        logger.warn(`Arbitraj iptal — spread azaldı: ${currentSpread.toFixed(4)}% < ${minSpread}%`);
        return { success: false, reason: 'Spread yetersiz' };
      }

      // İşlem miktarı ($10 sabit)
      const tradeAmount = 10;
      const amount = tradeAmount / currentBuyPrice;

      // Fee hesapla
      const [buyFee, sellFee] = await Promise.all([
        this.exchangeManager.getTradingFee(buyExchange, symbol),
        this.exchangeManager.getTradingFee(sellExchange, symbol),
      ]);

      const totalFee = (buyFee.taker + sellFee.taker) * tradeAmount;
      const grossProfit = (currentSellPrice - currentBuyPrice) * amount;
      const netProfit = grossProfit - totalFee;

      if (netProfit <= 0) {
        logger.warn(`Arbitraj iptal — fee sonrası kâr negatif: $${netProfit.toFixed(4)}`);
        return { success: false, reason: 'Fee sonrası kâr negatif' };
      }

      // Eşzamanlı emir
      const [buyOrder, sellOrder] = await Promise.all([
        this.exchangeManager.createOrder(buyExchange, symbol, 'market', 'buy', amount),
        this.exchangeManager.createOrder(sellExchange, symbol, 'market', 'sell', amount),
      ]);

      const executionTime = Date.now() - startTime;

      // DB'ye kaydet
      insertArbitrageHistory({
        symbol,
        buy_exchange: buyExchange,
        sell_exchange: sellExchange,
        buy_price: currentBuyPrice,
        sell_price: currentSellPrice,
        spread_pct: currentSpread,
        amount,
        profit: netProfit,
        status: 'executed',
        execution_time_ms: executionTime,
      });

      logger.info(`✅ Arbitraj işlemi başarılı: ${symbol} | Net kâr: $${netProfit.toFixed(4)} | Süre: ${executionTime}ms`);

      // Telegram
      if (this.notifier) {
        await this.notifier.notifyArbitrage({
          symbol,
          buyExchange,
          sellExchange,
          buyPrice: currentBuyPrice,
          sellPrice: currentSellPrice,
          spreadPct: currentSpread,
          profit: netProfit,
          executed: true,
        });
      }

      return { success: true, profit: netProfit, executionTime };
    } catch (err) {
      logger.error(`Arbitraj işlem hatası: ${err.message}`);
      insertArbitrageHistory({
        symbol,
        buy_exchange: buyExchange,
        sell_exchange: sellExchange,
        buy_price: buyPrice,
        sell_price: sellPrice,
        spread_pct: parseFloat(opportunity.spread),
        status: 'failed',
        execution_time_ms: Date.now() - startTime,
      });
      return { success: false, reason: err.message };
    }
  }

  enableAuto() {
    this.autoExecute = true;
    setSetting('arbitrage.auto_execute', '1');
    logger.info('Arbitraj otomatik işlem aktif.');
  }

  disableAuto() {
    this.autoExecute = false;
    setSetting('arbitrage.auto_execute', '0');
    logger.info('Arbitraj otomatik işlem devre dışı.');
  }

  getOpportunities() {
    return this.opportunities;
  }

  getHistory(limit = 50) {
    return getArbitrageHistory(limit);
  }

  getStats() {
    return getArbitrageStats();
  }
}

export default ArbitrageEngine;
