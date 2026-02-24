import ccxt from 'ccxt';
import EventEmitter from 'events';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [EXCHANGE][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/exchange.log' })],
});

class ExchangeManager extends EventEmitter {
  constructor() {
    super();
    this.exchanges = {};
    this.demoMode = {};
    this.forceDemo = false; // Kullanıcı tarafından zorlanmış demo mod
    this._configs = [];
  }

  async initialize() {
    const configs = [
      {
        id: 'binance',
        class: ccxt.binance,
        config: {
          apiKey: process.env.BINANCE_API_KEY,
          secret: process.env.BINANCE_SECRET_KEY,
          sandbox: process.env.BINANCE_TESTNET === 'true',
          options: { defaultType: 'spot', adjustForTimeDifference: true },
        },
      },
      {
        id: 'bybit',
        class: ccxt.bybit,
        config: {
          apiKey: process.env.BYBIT_API_KEY,
          secret: process.env.BYBIT_SECRET_KEY,
          sandbox: process.env.BYBIT_TESTNET === 'true',
          options: { defaultType: 'spot' },
        },
      },
      {
        id: 'okx',
        class: ccxt.okx,
        config: {
          apiKey: process.env.OKX_API_KEY,
          secret: process.env.OKX_SECRET_KEY,
          password: process.env.OKX_PASSPHRASE,
          sandbox: process.env.OKX_TESTNET === 'true',
          options: { defaultType: 'spot' },
        },
      },
    ];

    this._configs = configs;

    for (const cfg of configs) {
      try {
        const isDemo = this.forceDemo || !cfg.config.apiKey || cfg.config.apiKey.startsWith('your_');
        this.demoMode[cfg.id] = isDemo;

        if (isDemo) {
          logger.warn(`${cfg.id} — API key bulunamadı, DEMO modda çalışıyor.`);
          // Demo modda da exchange objesini oluştur (public endpoint'ler için)
          const exchange = new cfg.class({
            ...cfg.config,
            apiKey: undefined,
            secret: undefined,
            password: undefined,
            enableRateLimit: true,
          });
          this.exchanges[cfg.id] = exchange;
          try {
            await exchange.loadMarkets();
            logger.info(`${cfg.id} — Marketler yüklendi (demo mod, sadece public endpoint).`);
          } catch (e) {
            logger.warn(`${cfg.id} — Market yükleme başarısız (demo): ${e.message}`);
          }
        } else {
          const exchange = new cfg.class({
            ...cfg.config,
            enableRateLimit: true,
          });
          await exchange.loadMarkets();
          this.exchanges[cfg.id] = exchange;
          logger.info(`${cfg.id} — Bağlantı başarılı, ${Object.keys(exchange.markets).length} market yüklendi.`);
        }
      } catch (err) {
        logger.error(`${cfg.id} — Bağlantı hatası: ${err.message}`);
        this.demoMode[cfg.id] = true;
      }
    }

    return this;
  }

  getExchange(exchangeId) {
    return this.exchanges[exchangeId];
  }

  getAvailableExchanges() {
    return Object.keys(this.exchanges);
  }

  isDemo(exchangeId) {
    return this.forceDemo || this.demoMode[exchangeId] === true;
  }

  /**
   * Demo modu aç/kapat ve borsalara yeniden bağlan
   */
  async setDemoMode(enabled) {
    this.forceDemo = enabled;
    logger.info(`Demo mod ${enabled ? 'AÇILDI' : 'KAPATILDI'} — borsalar yeniden bağlanıyor...`);
    // Yeniden bağlan
    await this.initialize();
    return this.getDemoStatus();
  }

  getDemoStatus() {
    const perExchange = {};
    for (const id of Object.keys(this.exchanges)) {
      const hasKey = !this.demoMode[id]; // orijinal key durumu
      perExchange[id] = {
        demo: this.isDemo(id),
        hasApiKey: hasKey,
      };
    }
    return {
      forceDemo: this.forceDemo,
      globalDemo: Object.values(perExchange).every(e => e.demo),
      exchanges: perExchange,
    };
  }

  async getBalance(exchangeId) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) {
      return { totalUSD: 100, free: { USDT: 100 }, used: {}, total: { USDT: 100 } };
    }
    try {
      const balance = await exchange.fetchBalance();
      let totalUSD = 0;
      const filtered = {};
      for (const [coin, amount] of Object.entries(balance.total || {})) {
        if (amount > 0) {
          filtered[coin] = amount;
          if (coin === 'USDT' || coin === 'USD') {
            totalUSD += amount;
          } else {
            try {
              const ticker = await exchange.fetchTicker(`${coin}/USDT`);
              totalUSD += amount * (ticker.last || 0);
            } catch { /* coin/USDT çifti yok */ }
          }
        }
      }
      return { totalUSD, free: balance.free, used: balance.used, total: filtered };
    } catch (err) {
      logger.error(`${exchangeId} bakiye hatası: ${err.message}`);
      throw err;
    }
  }

  async getAllBalances() {
    const results = {};
    for (const id of Object.keys(this.exchanges)) {
      try {
        results[id] = await this.getBalance(id);
      } catch (err) {
        results[id] = { totalUSD: 0, free: {}, used: {}, total: {}, error: err.message };
      }
    }
    return results;
  }

  async getTicker(exchangeId, symbol) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    try {
      return await exchange.fetchTicker(symbol);
    } catch (err) {
      logger.error(`${exchangeId} ticker hatası (${symbol}): ${err.message}`);
      throw err;
    }
  }

  async getAllTickers(symbol) {
    const results = {};
    const promises = Object.entries(this.exchanges).map(async ([id, exchange]) => {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        results[id] = {
          last: ticker.last,
          bid: ticker.bid,
          ask: ticker.ask,
          high: ticker.high,
          low: ticker.low,
          volume: ticker.baseVolume,
          change: ticker.percentage,
          timestamp: ticker.timestamp,
        };
      } catch (err) {
        results[id] = { error: err.message };
      }
    });
    await Promise.all(promises);
    return results;
  }

  async getOHLCV(exchangeId, symbol, timeframe = '1h', limit = 100) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv.map(c => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      }));
    } catch (err) {
      logger.error(`${exchangeId} OHLCV hatası (${symbol} ${timeframe}): ${err.message}`);
      throw err;
    }
  }

  async createOrder(exchangeId, symbol, type, side, amount, price = undefined, params = {}) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) {
      logger.warn(`${exchangeId} DEMO mod — emir simüle ediliyor: ${side} ${amount} ${symbol} @ ${price || 'market'}`);
      const simOrder = {
        id: `demo_${Date.now()}`,
        symbol,
        type,
        side,
        amount,
        price: price || 0,
        cost: amount * (price || 0),
        fee: { cost: 0, currency: 'USDT' },
        status: 'closed',
        timestamp: Date.now(),
        demo: true,
      };
      this.emit('orderCreated', { exchangeId, order: simOrder });
      return simOrder;
    }

    try {
      const order = await exchange.createOrder(symbol, type, side, amount, price, params);
      logger.info(`${exchangeId} emir oluşturuldu: ${side} ${amount} ${symbol} — ID: ${order.id}`);
      this.emit('orderCreated', { exchangeId, order });
      return order;
    } catch (err) {
      logger.error(`${exchangeId} emir hatası: ${err.message}`);
      this.emit('orderFailed', { exchangeId, symbol, side, error: err.message });
      throw err;
    }
  }

  async cancelOrder(exchangeId, orderId, symbol) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) return { id: orderId, status: 'cancelled', demo: true };
    try {
      return await exchange.cancelOrder(orderId, symbol);
    } catch (err) {
      logger.error(`${exchangeId} emir iptal hatası: ${err.message}`);
      throw err;
    }
  }

  async getOpenOrders(exchangeId, symbol) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) return [];
    try {
      return await exchange.fetchOpenOrders(symbol);
    } catch (err) {
      logger.error(`${exchangeId} açık emir hatası: ${err.message}`);
      return [];
    }
  }

  async getOrderBook(exchangeId, symbol, limit = 10) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    try {
      return await exchange.fetchOrderBook(symbol, limit);
    } catch (err) {
      logger.error(`${exchangeId} orderbook hatası: ${err.message}`);
      throw err;
    }
  }

  async getTradingFee(exchangeId, symbol) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    try {
      if (exchange.has['fetchTradingFee']) {
        return await exchange.fetchTradingFee(symbol);
      }
      return { maker: 0.001, taker: 0.001 };
    } catch {
      return { maker: 0.001, taker: 0.001 };
    }
  }

  // Futures specific helpers
  async setLeverage(exchangeId, symbol, leverage) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) {
      logger.info(`${exchangeId} DEMO — kaldıraç ayarlandı: ${symbol} ${leverage}x`);
      return true;
    }
    try {
      await exchange.setLeverage(leverage, symbol);
      logger.info(`${exchangeId} kaldıraç ayarlandı: ${symbol} ${leverage}x`);
      return true;
    } catch (err) {
      logger.error(`${exchangeId} kaldıraç hatası: ${err.message}`);
      throw err;
    }
  }

  async setMarginMode(exchangeId, symbol, mode = 'isolated') {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) return true;
    try {
      await exchange.setMarginMode(mode, symbol);
      return true;
    } catch (err) {
      // Zaten ayarlanmış olabilir
      if (!err.message.includes('No need to change')) {
        logger.warn(`${exchangeId} margin mode hatası: ${err.message}`);
      }
      return true;
    }
  }

  async getPositions(exchangeId, symbols) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) throw new Error(`Borsa bulunamadı: ${exchangeId}`);
    if (this.isDemo(exchangeId)) return [];
    try {
      return await exchange.fetchPositions(symbols);
    } catch (err) {
      logger.error(`${exchangeId} pozisyon hatası: ${err.message}`);
      return [];
    }
  }

  async closeAll() {
    for (const [id, exchange] of Object.entries(this.exchanges)) {
      try {
        // ccxt has no explicit close, just log
        logger.info(`${id} — Bağlantı kapatıldı.`);
      } catch { /* ignore */ }
    }
  }
}

export default new ExchangeManager();
