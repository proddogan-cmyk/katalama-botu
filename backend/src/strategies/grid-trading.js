import { v4 as uuidv4 } from 'uuid';
import { createLogger, format, transports } from 'winston';
import { insertGridBot, getGridBots, getGridBot, updateGridBot, insertTrade } from '../database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [GRID][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/grid.log' })],
});

class GridTrading {
  constructor(exchangeManager, notifier) {
    this.exchangeManager = exchangeManager;
    this.notifier = notifier;
    this.activeBots = new Map();
  }

  /**
   * Grid bot oluştur
   */
  async createBot(config) {
    const { exchange, symbol, upper_price, lower_price, grid_count, investment, stop_loss_pct, take_profit_pct } = config;

    if (upper_price <= lower_price) throw new Error('Üst fiyat alt fiyattan büyük olmalı.');
    if (grid_count < 2 || grid_count > 100) throw new Error('Grid sayısı 2-100 arasında olmalı.');

    // Grid seviyelerini hesapla
    const step = (upper_price - lower_price) / grid_count;
    const gridLevels = [];
    for (let i = 0; i <= grid_count; i++) {
      gridLevels.push(parseFloat((lower_price + step * i).toFixed(8)));
    }

    // Mevcut fiyatı al
    const ticker = await this.exchangeManager.getTicker(exchange, symbol);
    const currentPrice = ticker.last;

    // Grid emirleri oluştur
    const perGridInvestment = investment / grid_count;
    const gridOrders = [];

    for (let i = 0; i < gridLevels.length - 1; i++) {
      const buyPrice = gridLevels[i];
      const sellPrice = gridLevels[i + 1];

      if (buyPrice < currentPrice) {
        // Fiyatın altındaki seviyelere alım emri
        gridOrders.push({
          id: uuidv4(),
          level: i,
          buyPrice,
          sellPrice,
          amount: perGridInvestment / buyPrice,
          status: 'pending_buy', // pending_buy, bought, pending_sell, completed
          orderId: null,
        });
      } else {
        // Fiyatın üstündeki seviyelere satım emri (eldekileri sat)
        gridOrders.push({
          id: uuidv4(),
          level: i,
          buyPrice,
          sellPrice,
          amount: perGridInvestment / buyPrice,
          status: 'pending_sell',
          orderId: null,
        });
      }
    }

    const id = insertGridBot({
      exchange,
      symbol,
      upper_price,
      lower_price,
      grid_count,
      investment,
      stop_loss_pct: stop_loss_pct || 5,
      take_profit_pct: take_profit_pct || 10,
      grid_orders: gridOrders,
    });

    const bot = getGridBot(id);
    this.activeBots.set(id, { ...bot, gridOrders });

    logger.info(`Grid bot oluşturuldu: ${symbol} | ${grid_count} grid | $${investment} | Aralık: $${lower_price}-$${upper_price}`);

    // Limit emirleri yerleştir
    await this.placeGridOrders(id);

    return bot;
  }

  /**
   * Grid emirlerini yerleştir
   */
  async placeGridOrders(botId) {
    const bot = this.activeBots.get(botId);
    if (!bot) return;

    const gridOrders = typeof bot.gridOrders === 'string' ? JSON.parse(bot.gridOrders) : bot.gridOrders;

    for (const order of gridOrders) {
      if (order.status === 'pending_buy') {
        try {
          const placed = await this.exchangeManager.createOrder(
            bot.exchange, bot.symbol, 'limit', 'buy', order.amount, order.buyPrice
          );
          order.orderId = placed.id;
          order.status = 'buy_placed';
          logger.info(`Grid alım emri: ${bot.symbol} @ $${order.buyPrice} — ${order.amount}`);
        } catch (err) {
          logger.error(`Grid alım emir hatası: ${err.message}`);
        }
      } else if (order.status === 'pending_sell') {
        try {
          const placed = await this.exchangeManager.createOrder(
            bot.exchange, bot.symbol, 'limit', 'sell', order.amount, order.sellPrice
          );
          order.orderId = placed.id;
          order.status = 'sell_placed';
          logger.info(`Grid satım emri: ${bot.symbol} @ $${order.sellPrice} — ${order.amount}`);
        } catch (err) {
          logger.error(`Grid satım emir hatası: ${err.message}`);
        }
      }
    }

    updateGridBot(botId, { grid_orders: JSON.stringify(gridOrders) });
  }

  /**
   * Aktif botları kontrol et
   */
  async checkAllBots() {
    const bots = getGridBots('active');

    for (const bot of bots) {
      try {
        await this.checkBot(bot);
      } catch (err) {
        logger.error(`Grid bot kontrol hatası (${bot.id}): ${err.message}`);
      }
    }
  }

  async checkBot(bot) {
    const ticker = await this.exchangeManager.getTicker(bot.exchange, bot.symbol);
    const currentPrice = ticker.last;

    // Stop Loss kontrolü
    const slPrice = bot.lower_price * (1 - bot.stop_loss_pct / 100);
    if (currentPrice <= slPrice) {
      logger.warn(`Grid bot SL tetiklendi: ${bot.symbol} @ $${currentPrice}`);
      await this.stopBot(bot.id);
      return;
    }

    // Take Profit kontrolü
    const tpPrice = bot.upper_price * (1 + bot.take_profit_pct / 100);
    if (currentPrice >= tpPrice) {
      logger.info(`Grid bot TP tetiklendi: ${bot.symbol} @ $${currentPrice}`);
      await this.stopBot(bot.id);
      return;
    }

    // Emir durumlarını kontrol et
    const gridOrders = typeof bot.grid_orders === 'string' ? JSON.parse(bot.grid_orders) : bot.grid_orders;
    let updated = false;
    let botProfit = bot.total_profit || 0;
    let botTrades = bot.total_trades || 0;

    for (const order of gridOrders) {
      if (order.status === 'buy_placed' && currentPrice <= order.buyPrice) {
        // Alım dolmuş sayılıyor (basitleştirilmiş kontrol)
        order.status = 'bought';
        updated = true;
        botTrades++;

        insertTrade({
          exchange: bot.exchange, symbol: bot.symbol, side: 'buy', type: 'limit',
          price: order.buyPrice, amount: order.amount, cost: order.buyPrice * order.amount,
          strategy: 'grid', strategy_id: bot.id, status: 'filled',
        });

        // Ters emir (satım) yerleştir
        try {
          const placed = await this.exchangeManager.createOrder(
            bot.exchange, bot.symbol, 'limit', 'sell', order.amount, order.sellPrice
          );
          order.orderId = placed.id;
          order.status = 'sell_placed';
          logger.info(`Grid: ${bot.symbol} alım doldu @ $${order.buyPrice} → satım emri @ $${order.sellPrice}`);
        } catch (err) {
          logger.error(`Grid ters emir hatası: ${err.message}`);
        }
      } else if (order.status === 'sell_placed' && currentPrice >= order.sellPrice) {
        // Satım dolmuş
        order.status = 'completed';
        updated = true;
        botTrades++;

        const profit = (order.sellPrice - order.buyPrice) * order.amount;
        botProfit += profit;

        insertTrade({
          exchange: bot.exchange, symbol: bot.symbol, side: 'sell', type: 'limit',
          price: order.sellPrice, amount: order.amount, cost: order.sellPrice * order.amount,
          strategy: 'grid', strategy_id: bot.id, status: 'filled', pnl: profit,
        });

        // Yeni alım emri yerleştir (döngü)
        try {
          const placed = await this.exchangeManager.createOrder(
            bot.exchange, bot.symbol, 'limit', 'buy', order.amount, order.buyPrice
          );
          order.orderId = placed.id;
          order.status = 'buy_placed';
          logger.info(`Grid: ${bot.symbol} satım doldu @ $${order.sellPrice} (+$${profit.toFixed(4)}) → yeni alım @ $${order.buyPrice}`);
        } catch (err) {
          logger.error(`Grid yeni emir hatası: ${err.message}`);
        }
      }
    }

    if (updated) {
      updateGridBot(bot.id, { grid_orders: JSON.stringify(gridOrders), total_profit: botProfit, total_trades: botTrades });
    }
  }

  async pauseBot(id) {
    updateGridBot(id, { status: 'paused' });
    this.activeBots.delete(id);
    logger.info(`Grid bot duraklatıldı: ${id}`);
  }

  async resumeBot(id) {
    updateGridBot(id, { status: 'active' });
    const bot = getGridBot(id);
    if (bot) this.activeBots.set(id, bot);
    logger.info(`Grid bot devam ediyor: ${id}`);
  }

  async stopBot(id) {
    // Açık emirleri iptal et
    const bot = getGridBot(id);
    if (bot) {
      const gridOrders = typeof bot.grid_orders === 'string' ? JSON.parse(bot.grid_orders) : bot.grid_orders;
      for (const order of gridOrders) {
        if (order.orderId && (order.status === 'buy_placed' || order.status === 'sell_placed')) {
          try {
            await this.exchangeManager.cancelOrder(bot.exchange, order.orderId, bot.symbol);
          } catch { /* ignore */ }
        }
      }
    }

    updateGridBot(id, { status: 'stopped' });
    this.activeBots.delete(id);
    logger.info(`Grid bot durduruldu: ${id}`);
  }
}

export default GridTrading;
