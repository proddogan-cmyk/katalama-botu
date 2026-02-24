import { createLogger, format, transports } from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { getSetting, getSettingNum, setSetting, insertRiskEvent, getTradeStats } from './database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [RISK][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/risk.log' })],
});

class RiskManager {
  constructor() {
    this.dailyPnL = 0;
    this.dailyTradeCount = 0;
    this.tradeHistory = []; // son 50 işlem sonucu (win/loss) — Kelly için
    this.maxDrawdown = 0;
    this.peakBalance = 100;
    this.currentDay = new Date().toDateString();
  }

  /**
   * Yeni gün kontrolü — günlük sayaçları sıfırla
   */
  checkDayReset() {
    const today = new Date().toDateString();
    if (today !== this.currentDay) {
      this.dailyPnL = 0;
      this.dailyTradeCount = 0;
      this.currentDay = today;

      // Bot kilidi kontrolü
      if (getSetting('bot.locked') === '1') {
        const lockUntil = getSetting('bot.lock_until');
        if (lockUntil && new Date(lockUntil) <= new Date()) {
          setSetting('bot.locked', '0');
          setSetting('bot.lock_until', '');
          logger.info('Bot kilidi açıldı — yeni gün.');
        }
      }
    }
  }

  /**
   * İşlem öncesi kontrol
   */
  canTrade(tradeConfig = {}) {
    this.checkDayReset();

    // Bot kilitli mi?
    if (getSetting('bot.locked') === '1') {
      logger.warn('İşlem reddedildi — bot kilitli.');
      return false;
    }

    // Günlük kayıp limiti
    const balance = tradeConfig.balance || getSettingNum('bot.initial_balance', 100);
    const maxDailyLossPct = getSettingNum('risk.max_daily_loss_pct', 10) / 100;
    const maxDailyLoss = balance * maxDailyLossPct;

    if (this.dailyPnL < -maxDailyLoss) {
      logger.warn(`Günlük kayıp limiti aşıldı: $${this.dailyPnL.toFixed(2)} < -$${maxDailyLoss.toFixed(2)}`);
      this.lockBot('Günlük kayıp limiti aşıldı');
      return false;
    }

    // Pozisyon büyüklüğü kontrolü
    if (tradeConfig.margin && tradeConfig.balance) {
      const maxMarginPct = getSettingNum('risk.max_margin_usage_pct', 50) / 100;
      if (tradeConfig.margin > tradeConfig.balance * maxMarginPct) {
        logger.warn(`Margin çok yüksek: $${tradeConfig.margin.toFixed(2)} > $${(tradeConfig.balance * maxMarginPct).toFixed(2)}`);
        return false;
      }
    }

    // Risk:Reward kontrolü
    if (tradeConfig.rrRatio) {
      const minRR = getSettingNum('risk.min_rr_ratio', 2.5);
      if (tradeConfig.rrRatio < minRR) {
        logger.warn(`R:R çok düşük: ${tradeConfig.rrRatio} < ${minRR}`);
        return false;
      }
    }

    return true;
  }

  /**
   * İşlem sonrası kayıp takibi
   */
  recordPnL(pnl) {
    this.dailyPnL += pnl;
    this.dailyTradeCount++;
    this.tradeHistory.push(pnl >= 0 ? 'win' : 'loss');
    if (this.tradeHistory.length > 50) this.tradeHistory.shift();

    // Max drawdown
    const balance = getSettingNum('bot.initial_balance', 100) + this.dailyPnL;
    if (balance > this.peakBalance) this.peakBalance = balance;
    const drawdown = ((this.peakBalance - balance) / this.peakBalance) * 100;
    if (drawdown > this.maxDrawdown) this.maxDrawdown = drawdown;

    // Günlük kayıp limiti kontrolü
    const initialBalance = getSettingNum('bot.initial_balance', 100);
    const maxDailyLossPct = getSettingNum('risk.max_daily_loss_pct', 10) / 100;
    const maxDailyLoss = initialBalance * maxDailyLossPct;

    if (this.dailyPnL < -maxDailyLoss) {
      this.lockBot('Günlük kayıp limiti aşıldı');
    }

    logger.info(`P&L kaydedildi: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Günlük: ${this.dailyPnL >= 0 ? '+' : ''}$${this.dailyPnL.toFixed(2)} | İşlem: ${this.dailyTradeCount}`);
  }

  /**
   * Bot kilitle
   */
  lockBot(reason) {
    setSetting('bot.locked', '1');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    setSetting('bot.lock_until', tomorrow.toISOString());

    insertRiskEvent({
      type: 'bot_locked',
      message: reason,
      severity: 'critical',
    });

    logger.warn(`🔒 BOT KİLİTLENDİ: ${reason} — Açılış: ${tomorrow.toISOString()}`);
  }

  /**
   * Bot kilidini aç
   */
  unlockBot() {
    setSetting('bot.locked', '0');
    setSetting('bot.lock_until', '');
    this.dailyPnL = 0;
    logger.info('Bot kilidi açıldı (manuel).');
  }

  /**
   * Trailing stop hesapla
   */
  calculateTrailingStop(currentPrice, direction, activatePct = 2, distancePct = 1.5) {
    const distance = currentPrice * (distancePct / 100);
    if (direction === 'long') return currentPrice - distance;
    return currentPrice + distance;
  }

  /**
   * Kelly Criterion ile optimal pozisyon büyüklüğü
   */
  kellyOptimalSize(balance) {
    const stats = getTradeStats();
    const winRate = parseFloat(stats.winRate) / 100 || 0.5;
    const profitFactor = parseFloat(stats.profitFactor) || 1;

    if (profitFactor <= 0 || stats.totalTrades < 10) {
      // Yeterli veri yok — varsayılan %3
      return balance * 0.03;
    }

    // Kelly = W - (L / B)
    // W = kazanma oranı, L = kayıp oranı, B = ortalama kazanç / ortalama kayıp
    const lossRate = 1 - winRate;
    const kelly = winRate - (lossRate / profitFactor);

    // Half Kelly (daha güvenli)
    const halfKelly = Math.max(0, Math.min(kelly / 2, 0.1)); // max %10

    return balance * halfKelly;
  }

  /**
   * Risk raporu
   */
  getReport() {
    const stats = getTradeStats();
    return {
      dailyPnL: this.dailyPnL,
      dailyTradeCount: this.dailyTradeCount,
      maxDrawdown: this.maxDrawdown,
      peakBalance: this.peakBalance,
      botLocked: getSetting('bot.locked') === '1',
      lockUntil: getSetting('bot.lock_until'),
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      totalTrades: stats.totalTrades,
      totalPnl: stats.totalPnl,
      todayPnl: stats.todayPnl,
      kellySize: this.kellyOptimalSize(getSettingNum('bot.initial_balance', 100)),
      limits: {
        maxDailyLossPct: getSettingNum('risk.max_daily_loss_pct', 10),
        maxPositionRiskPct: getSettingNum('risk.max_position_risk_pct', 3),
        maxOpenPositions: getSettingNum('risk.max_open_positions', 2),
        maxMarginUsagePct: getSettingNum('risk.max_margin_usage_pct', 50),
        minRRRatio: getSettingNum('risk.min_rr_ratio', 2.5),
      },
    };
  }
}

export default new RiskManager();
