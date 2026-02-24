import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import { getSetting, getTradeStats } from './database.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [TELEGRAM][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: 'logs/telegram.log' })],
});

class NotificationService {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.enabled = false;
    this.init();
  }

  init() {
    if (this.token && this.chatId && !this.token.startsWith('your_') && !this.chatId.startsWith('your_')) {
      this.enabled = true;
      logger.info('Telegram bildirim servisi aktif.');
    } else {
      logger.warn('Telegram bildirim servisi devre dışı — token/chatId eksik.');
    }
  }

  async send(text) {
    if (!this.enabled) {
      logger.info(`[DEMO] Telegram mesajı: ${text.substring(0, 80)}...`);
      return;
    }
    if (getSetting('telegram.enabled') === '0') return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      logger.error(`Telegram gönderim hatası: ${err.message}`);
    }
  }

  async notifyTrade(data) {
    if (getSetting('telegram.trade_notifications') === '0') return;

    const emoji = data.type?.includes('KAPANIŞ')
      ? (data.pnl >= 0 ? '🟢' : '🔴')
      : '📊';

    let msg = `${emoji} <b>${data.type}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 <b>${data.symbol}</b> | ${data.direction || ''} ${data.leverage ? data.leverage + 'x' : ''}\n`;

    if (data.leverageMode) msg += `⚡ Kaldıraç: <b>${data.leverageMode}</b>\n`;
    if (data.entryPrice) msg += `🎯 Giriş: <code>$${Number(data.entryPrice).toFixed(2)}</code>\n`;
    if (data.closePrice) msg += `🏁 Çıkış: <code>$${Number(data.closePrice).toFixed(2)}</code>\n`;
    if (data.stopLoss) msg += `🛑 SL: <code>$${Number(data.stopLoss).toFixed(2)}</code>\n`;
    if (data.takeProfit) msg += `🎯 TP: <code>$${Number(data.takeProfit).toFixed(2)}</code>\n`;
    if (data.amount) msg += `📦 Miktar: <code>${Number(data.amount).toFixed(6)}</code>\n`;
    if (data.margin) msg += `💰 Margin: <code>$${Number(data.margin).toFixed(2)}</code>\n`;
    if (data.rrRatio) msg += `⚖️ R:R: <code>${data.rrRatio}</code>\n`;
    if (data.score !== undefined) msg += `📈 Sinyal Puanı: <b>${data.score}/10</b>\n`;

    if (data.pnl !== undefined) {
      const pnlEmoji = data.pnl >= 0 ? '✅' : '❌';
      msg += `${pnlEmoji} P&L: <b>${data.pnl >= 0 ? '+' : ''}$${Number(data.pnl).toFixed(2)}</b>`;
      if (data.pnlPct !== undefined) msg += ` (${data.pnlPct >= 0 ? '+' : ''}${Number(data.pnlPct).toFixed(2)}%)`;
      msg += `\n`;
    }

    if (data.balance !== undefined) msg += `💎 Bakiye: <code>$${Number(data.balance).toFixed(2)}</code>\n`;

    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `⏰ ${new Date().toLocaleString('tr-TR')}`;

    await this.send(msg);
  }

  async notifyStopLoss(data) {
    let msg = `🚨 <b>STOP LOSS TETİKLENDİ!</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 ${data.symbol} | ${data.direction?.toUpperCase()}\n`;
    msg += `🎯 Giriş: <code>$${Number(data.entryPrice).toFixed(2)}</code>\n`;
    msg += `🛑 Stop: <code>$${Number(data.stopPrice).toFixed(2)}</code>\n`;
    msg += `❌ Kayıp: <b>$${Number(data.pnl).toFixed(2)}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('tr-TR')}`;
    await this.send(msg);
  }

  async notifyArbitrage(data) {
    let msg = `💱 <b>ARBİTRAJ ${data.executed ? 'İŞLEMİ' : 'FIRSATI'}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 ${data.symbol}\n`;
    msg += `🟢 Al: ${data.buyExchange} @ <code>$${Number(data.buyPrice).toFixed(2)}</code>\n`;
    msg += `🔴 Sat: ${data.sellExchange} @ <code>$${Number(data.sellPrice).toFixed(2)}</code>\n`;
    msg += `📊 Spread: <b>${Number(data.spreadPct).toFixed(3)}%</b>\n`;
    if (data.profit) msg += `💰 Kâr: <b>+$${Number(data.profit).toFixed(4)}</b>\n`;
    msg += `⏰ ${new Date().toLocaleString('tr-TR')}`;
    await this.send(msg);
  }

  async sendDailyReport() {
    if (getSetting('telegram.daily_report') === '0') return;

    const stats = getTradeStats();
    let msg = `📋 <b>GÜNLÜK RAPOR</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 ${new Date().toLocaleDateString('tr-TR')}\n\n`;
    msg += `📊 Toplam İşlem: <b>${stats.totalTrades}</b>\n`;
    msg += `✅ Kazanç: ${stats.winCount} | ❌ Kayıp: ${stats.lossCount}\n`;
    msg += `📈 Kazanma Oranı: <b>${stats.winRate}%</b>\n`;
    msg += `💰 Bugünkü P&L: <b>${stats.todayPnl >= 0 ? '+' : ''}$${Number(stats.todayPnl).toFixed(2)}</b>\n`;
    msg += `💎 Toplam P&L: <b>${stats.totalPnl >= 0 ? '+' : ''}$${Number(stats.totalPnl).toFixed(2)}</b>\n`;
    msg += `⚖️ Profit Factor: <b>${stats.profitFactor}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━\n`;
    msg += `🤖 CryptoForge Bot`;
    await this.send(msg);
  }

  async notifyRiskAlert(message) {
    if (getSetting('telegram.risk_alerts') === '0') return;
    await this.send(`⚠️ <b>RİSK UYARISI</b>\n━━━━━━━━━━━━━━━━━\n${message}`);
  }

  async notifyBotStatus(message) {
    await this.send(`🤖 <b>BOT DURUMU</b>\n━━━━━━━━━━━━━━━━━\n${message}\n⏰ ${new Date().toLocaleString('tr-TR')}`);
  }
}

export default new NotificationService();
