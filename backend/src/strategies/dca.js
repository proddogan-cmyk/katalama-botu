import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import { createLogger, format, transports } from 'winston';
import { insertDCAPlan, getDCAPlans, getDCAPlan, updateDCAPlan, deleteDCAPlan as dbDeleteDCA, insertTrade } from '../database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [DCA][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/dca.log' })],
});

const CRON_MAP = {
  hourly: '0 * * * *',
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  biweekly: '0 9 1,15 * *',
  monthly: '0 9 1 * *',
};

class DCAEngine {
  constructor(exchangeManager, notifier) {
    this.exchangeManager = exchangeManager;
    this.notifier = notifier;
    this.cronJobs = new Map(); // planId -> cron job
  }

  /**
   * Kaydedilmiş planları başlat
   */
  initializeActivePlans() {
    const plans = getDCAPlans('active');
    for (const plan of plans) {
      this.schedulePlan(plan);
    }
    logger.info(`${plans.length} aktif DCA planı yüklendi.`);
  }

  /**
   * Yeni DCA planı oluştur
   */
  createPlan(config) {
    const { exchange, symbol, amount, interval } = config;

    if (!CRON_MAP[interval]) throw new Error(`Geçersiz aralık: ${interval}. Geçerli: ${Object.keys(CRON_MAP).join(', ')}`);

    const nextBuy = this.calculateNextBuy(interval);
    const id = insertDCAPlan({
      exchange,
      symbol,
      amount,
      interval,
      next_buy_at: nextBuy.toISOString(),
    });

    const plan = getDCAPlan(id);
    this.schedulePlan(plan);

    logger.info(`DCA planı oluşturuldu: ${symbol} | $${amount} | ${interval} | Sonraki: ${nextBuy.toLocaleString('tr-TR')}`);
    return plan;
  }

  /**
   * Plan zamanlama
   */
  schedulePlan(plan) {
    if (this.cronJobs.has(plan.id)) {
      this.cronJobs.get(plan.id).stop();
    }

    const cronExpr = CRON_MAP[plan.interval];
    if (!cronExpr) return;

    const job = cron.schedule(cronExpr, async () => {
      const currentPlan = getDCAPlan(plan.id);
      if (!currentPlan || currentPlan.status !== 'active') return;
      await this.executeBuy(currentPlan);
    });

    this.cronJobs.set(plan.id, job);
  }

  /**
   * Alım emri gönder
   */
  async executeBuy(plan) {
    try {
      const ticker = await this.exchangeManager.getTicker(plan.exchange, plan.symbol);
      const price = ticker.last;
      const amount = plan.amount / price;

      const order = await this.exchangeManager.createOrder(
        plan.exchange, plan.symbol, 'market', 'buy', amount
      );

      const totalInvested = (plan.total_invested || 0) + plan.amount;
      const totalCoins = (plan.total_coins || 0) + amount;
      const avgBuyPrice = totalInvested / totalCoins;
      const nextBuy = this.calculateNextBuy(plan.interval);

      updateDCAPlan(plan.id, {
        total_invested: totalInvested,
        total_coins: totalCoins,
        avg_buy_price: avgBuyPrice,
        last_buy_at: new Date().toISOString(),
        next_buy_at: nextBuy.toISOString(),
      });

      insertTrade({
        exchange: plan.exchange,
        symbol: plan.symbol,
        side: 'buy',
        type: 'market',
        price,
        amount,
        cost: plan.amount,
        strategy: 'dca',
        strategy_id: plan.id,
        order_id: order.id,
        status: 'filled',
        notes: `DCA ${plan.interval} | Toplam: $${totalInvested.toFixed(2)} | Ort: $${avgBuyPrice.toFixed(2)}`,
      });

      // ROI hesapla
      const currentValue = totalCoins * price;
      const roi = ((currentValue - totalInvested) / totalInvested) * 100;

      logger.info(`DCA alım: ${plan.symbol} | $${plan.amount} → ${amount.toFixed(6)} @ $${price.toFixed(2)} | Ort: $${avgBuyPrice.toFixed(2)} | ROI: ${roi.toFixed(2)}%`);

      if (this.notifier) {
        await this.notifier.notifyTrade({
          type: 'DCA ALIM',
          symbol: plan.symbol,
          direction: 'BUY',
          entryPrice: price,
          amount,
          margin: plan.amount,
          balance: totalInvested,
        });
      }
    } catch (err) {
      logger.error(`DCA alım hatası (${plan.symbol}): ${err.message}`);
    }
  }

  /**
   * Manuel alım tetikle
   */
  async manualBuy(planId) {
    const plan = getDCAPlan(planId);
    if (!plan) throw new Error('Plan bulunamadı.');
    await this.executeBuy(plan);
    return getDCAPlan(planId);
  }

  /**
   * Plan duraklat
   */
  pausePlan(id) {
    updateDCAPlan(id, { status: 'paused' });
    if (this.cronJobs.has(id)) {
      this.cronJobs.get(id).stop();
      this.cronJobs.delete(id);
    }
    logger.info(`DCA planı duraklatıldı: ${id}`);
  }

  /**
   * Plan devam et
   */
  resumePlan(id) {
    updateDCAPlan(id, { status: 'active' });
    const plan = getDCAPlan(id);
    if (plan) this.schedulePlan(plan);
    logger.info(`DCA planı devam ediyor: ${id}`);
  }

  /**
   * Plan sil
   */
  deletePlan(id) {
    if (this.cronJobs.has(id)) {
      this.cronJobs.get(id).stop();
      this.cronJobs.delete(id);
    }
    dbDeleteDCA(id);
    logger.info(`DCA planı silindi: ${id}`);
  }

  /**
   * Plan listesi + ROI
   */
  async getPlansWithROI() {
    const plans = getDCAPlans();
    const results = [];

    for (const plan of plans) {
      let roi = 0;
      let currentValue = 0;

      if (plan.total_coins > 0) {
        try {
          const ticker = await this.exchangeManager.getTicker(plan.exchange, plan.symbol);
          currentValue = plan.total_coins * ticker.last;
          roi = plan.total_invested > 0 ? ((currentValue - plan.total_invested) / plan.total_invested) * 100 : 0;
        } catch { /* ignore */ }
      }

      results.push({
        ...plan,
        currentValue,
        roi: roi.toFixed(2),
      });
    }

    return results;
  }

  calculateNextBuy(interval) {
    const now = new Date();
    switch (interval) {
      case 'hourly': return new Date(now.getTime() + 60 * 60 * 1000);
      case 'daily': { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
      case 'weekly': { const d = new Date(now); d.setDate(d.getDate() + (7 - d.getDay() + 1) % 7 || 7); d.setHours(9, 0, 0, 0); return d; }
      case 'biweekly': { const d = new Date(now); d.setDate(d.getDate() + 14); d.setHours(9, 0, 0, 0); return d; }
      case 'monthly': { const d = new Date(now); d.setMonth(d.getMonth() + 1); d.setDate(1); d.setHours(9, 0, 0, 0); return d; }
      default: return now;
    }
  }

  stopAll() {
    for (const [id, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();
    logger.info('Tüm DCA planları durduruldu.');
  }
}

export default DCAEngine;
