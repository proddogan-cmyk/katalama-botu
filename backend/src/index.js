import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import cron from 'node-cron';
import { createLogger, format, transports } from 'winston';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Modüller
import { initDatabase, closeDatabase, getSetting, getSettingNum, setSetting, getAllSettings, getTrades, getTradeStats, insertTrade, getLatestSignals, getLatestPortfolioSnapshot, getPortfolioHistory, insertPortfolioSnapshot, getUnresolvedRiskEvents, getGridBots, getDCAPlans } from './database.js';
import exchangeManager from './exchanges.js';
import riskManager from './risk-manager.js';
import notifier from './notifications.js';
import { analyzeSymbol, multiTimeframeAnalysis } from './strategies/technical-analysis.js';
import FuturesEngine from './strategies/futures-100.js';
import GridTrading from './strategies/grid-trading.js';
import DCAEngine from './strategies/dca.js';
import ArbitrageEngine from './strategies/arbitrage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log dizini
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [SERVER][${level.toUpperCase()}] ${message}`)),
  transports: [new transports.Console(), new transports.File({ filename: path.join(logDir, 'server.log') })],
});

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

// Production: Frontend static dosyalarını sun
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

const server = http.createServer(app);

// ==================== BAŞLATMA ====================
let futuresEngine, gridTrading, dcaEngine, arbitrageEngine;
let wsClients = new Set();

async function bootstrap() {
  logger.info('🚀 CryptoForge başlatılıyor...');

  // 1. Veritabanı
  initDatabase();

  // 2. Borsalar
  await exchangeManager.initialize();

  // 3. Strateji motorları
  futuresEngine = new FuturesEngine(exchangeManager, riskManager, notifier);
  gridTrading = new GridTrading(exchangeManager, notifier);
  dcaEngine = new DCAEngine(exchangeManager, notifier);
  arbitrageEngine = new ArbitrageEngine(exchangeManager, notifier);

  // DCA aktif planları yükle
  dcaEngine.initializeActivePlans();

  // WebSocket
  setupWebSocket();

  // Cron Jobs
  setupCronJobs();

  // Server
  server.listen(PORT, () => {
    logger.info(`✅ CryptoForge sunucusu çalışıyor: http://localhost:${PORT}`);
    logger.info(`📡 WebSocket: ws://localhost:${PORT}/ws`);
    notifier.notifyBotStatus('CryptoForge başlatıldı ✅');
  });
}

// ==================== WEBSOCKET ====================
function setupWebSocket() {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    logger.info(`WebSocket istemci bağlandı (toplam: ${wsClients.size})`);

    ws.on('close', () => {
      wsClients.delete(ws);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch { /* ignore */ }
    }
  }
}

// ==================== CRON JOBS ====================
let cronTimers = [];

function setupCronJobs() {
  // Market update — her 5 saniye
  const marketTimer = setInterval(async () => {
    try {
      const coins = (getSetting('futures.coins') || 'BTC/USDT,ETH/USDT').split(',').slice(0, 5);
      const prices = {};
      for (const symbol of coins) {
        try {
          const tickers = await exchangeManager.getAllTickers(symbol.trim());
          prices[symbol.trim()] = tickers;
        } catch { /* skip */ }
      }
      broadcast('market_update', prices);
    } catch { /* ignore */ }
  }, 5000);
  cronTimers.push(marketTimer);

  // Grid bot kontrolü — her 10 saniye
  const gridTimer = setInterval(() => {
    gridTrading.checkAllBots().catch(e => logger.error(`Grid kontrol hatası: ${e.message}`));
  }, 10000);
  cronTimers.push(gridTimer);

  // Arbitraj taraması — her 30 saniye (3 saniye çok agresif rate limit için)
  const arbTimer = setInterval(() => {
    arbitrageEngine.scan().catch(e => logger.error(`Arbitraj tarama hatası: ${e.message}`));
  }, 30000);
  cronTimers.push(arbTimer);

  // Portföy snapshot — her saat
  cron.schedule('0 * * * *', async () => {
    try {
      const balances = await exchangeManager.getAllBalances();
      let totalValue = 0;
      const balObj = {};
      for (const [id, bal] of Object.entries(balances)) {
        totalValue += bal.totalUSD || 0;
        balObj[id] = bal;
      }
      const stats = getTradeStats();
      insertPortfolioSnapshot({ total_value_usd: totalValue, balances: balObj, pnl_24h: stats.todayPnl });
      logger.info(`Portföy snapshot: $${totalValue.toFixed(2)}`);
    } catch (e) { logger.error(`Snapshot hatası: ${e.message}`); }
  });

  // Günlük rapor — her gece 23:55
  cron.schedule('55 23 * * *', () => {
    notifier.sendDailyReport().catch(e => logger.error(`Günlük rapor hatası: ${e.message}`));
  });

  // Futures pozisyon güncelleme WS broadcast — her 5 saniye
  const futuresBroadcast = setInterval(() => {
    if (futuresEngine && futuresEngine.running && futuresEngine.positions.size > 0) {
      broadcast('position_update', Object.fromEntries(futuresEngine.positions));
    }
  }, 5000);
  cronTimers.push(futuresBroadcast);
}

// ==================== REST API ====================

// --- Status ---
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    exchanges: exchangeManager.getAvailableExchanges(),
    futures: futuresEngine?.running || false,
    botLocked: getSetting('bot.locked') === '1',
    demo: exchangeManager.getDemoStatus(),
  });
});

// --- Demo Mode ---
app.get('/api/demo', (req, res) => {
  res.json(exchangeManager.getDemoStatus());
});

app.post('/api/demo/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await exchangeManager.setDemoMode(enabled);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dashboard ---
app.get('/api/dashboard', async (req, res) => {
  try {
    const balances = await exchangeManager.getAllBalances();
    const stats = getTradeStats();
    const risk = riskManager.getReport();
    const recentTrades = getTrades(10);
    const futuresStatus = futuresEngine?.getStatus() || {};
    const snapshot = getLatestPortfolioSnapshot();

    let totalBalance = 0;
    for (const bal of Object.values(balances)) totalBalance += bal.totalUSD || 0;

    res.json({
      balance: { total: totalBalance, byExchange: balances },
      stats,
      risk,
      recentTrades,
      futures: futuresStatus,
      snapshot,
      activeStrategies: {
        futures: futuresEngine?.running || false,
        gridBots: getGridBots('active').length,
        dcaPlans: getDCAPlans('active').length,
        arbitrage: arbitrageEngine?.autoExecute || false,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Market ---
app.get('/api/market', async (req, res) => {
  try {
    const coins = (getSetting('futures.coins') || 'BTC/USDT,ETH/USDT').split(',').map(s => s.trim());
    const results = {};
    for (const symbol of coins) {
      try { results[symbol] = await exchangeManager.getAllTickers(symbol); } catch { /* skip */ }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/market/:symbol/ohlcv', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const exchange = req.query.exchange || 'binance';
    const timeframe = req.query.timeframe || '1h';
    const limit = parseInt(req.query.limit) || 100;
    const data = await exchangeManager.getOHLCV(exchange, symbol, timeframe, limit);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Teknik Analiz ---
app.get('/api/ta/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const exchange = req.query.exchange || 'binance';
    const analysis = await multiTimeframeAnalysis(exchangeManager, exchange, symbol);
    res.json(analysis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ta/signals/all', async (req, res) => {
  try {
    const coins = (getSetting('futures.coins') || 'BTC/USDT,ETH/USDT').split(',').map(s => s.trim());
    const results = [];
    for (const symbol of coins) {
      try {
        const analysis = await analyzeSymbol(exchangeManager, 'binance', symbol, '1h', 200);
        results.push(analysis);
      } catch { /* skip */ }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Grid Trading ---
app.get('/api/grid/bots', (req, res) => {
  try {
    res.json(getGridBots());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/grid/bots', async (req, res) => {
  try {
    const bot = await gridTrading.createBot(req.body);
    res.json(bot);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/grid/bots/:id/pause', async (req, res) => {
  try { await gridTrading.pauseBot(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/grid/bots/:id/resume', async (req, res) => {
  try { await gridTrading.resumeBot(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/grid/bots/:id/stop', async (req, res) => {
  try { await gridTrading.stopBot(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DCA ---
app.get('/api/dca/plans', async (req, res) => {
  try { res.json(await dcaEngine.getPlansWithROI()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dca/plans', (req, res) => {
  try { res.json(dcaEngine.createPlan(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/dca/plans/:id/buy', async (req, res) => {
  try { res.json(await dcaEngine.manualBuy(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dca/plans/:id/pause', (req, res) => {
  try { dcaEngine.pausePlan(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dca/plans/:id/resume', (req, res) => {
  try { dcaEngine.resumePlan(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/dca/plans/:id', (req, res) => {
  try { dcaEngine.deletePlan(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Arbitrage ---
app.get('/api/arbitrage/opportunities', (req, res) => {
  res.json(arbitrageEngine.getOpportunities());
});

app.get('/api/arbitrage/stats', (req, res) => {
  res.json(arbitrageEngine.getStats());
});

app.get('/api/arbitrage/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(arbitrageEngine.getHistory(limit));
});

app.post('/api/arbitrage/scan', async (req, res) => {
  try { res.json(await arbitrageEngine.scan()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/arbitrage/execute', async (req, res) => {
  try { res.json(await arbitrageEngine.execute(req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/arbitrage/auto/:action', (req, res) => {
  const { action } = req.params;
  if (action === 'enable') { arbitrageEngine.enableAuto(); res.json({ autoExecute: true }); }
  else if (action === 'disable') { arbitrageEngine.disableAuto(); res.json({ autoExecute: false }); }
  else res.status(400).json({ error: 'Geçersiz aksiyon. enable veya disable kullanın.' });
});

// --- Futures ---
app.get('/api/futures/status', (req, res) => {
  res.json(futuresEngine?.getStatus() || { running: false });
});

app.post('/api/futures/start', async (req, res) => {
  try {
    await futuresEngine.start();
    res.json({ success: true, status: futuresEngine.getStatus() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/futures/stop', (req, res) => {
  futuresEngine.stop();
  res.json({ success: true });
});

app.get('/api/futures/positions', (req, res) => {
  res.json(Object.fromEntries(futuresEngine?.positions || new Map()));
});

app.post('/api/futures/close-all', async (req, res) => {
  try {
    await futuresEngine.closeAllPositions();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/futures/analyze/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    res.json(await futuresEngine.analyzeOnly(symbol));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Trades ---
app.get('/api/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json(getTrades(limit, offset, req.query));
});

app.get('/api/trades/stats', (req, res) => {
  res.json(getTradeStats());
});

// --- Portfolio ---
app.get('/api/portfolio', async (req, res) => {
  try {
    const balances = await exchangeManager.getAllBalances();
    const history = getPortfolioHistory();
    res.json({ current: balances, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Risk ---
app.get('/api/risk', (req, res) => {
  res.json(riskManager.getReport());
});

app.post('/api/risk/unlock', (req, res) => {
  riskManager.unlockBot();
  res.json({ success: true, locked: false });
});

// --- Settings ---
app.get('/api/settings', (req, res) => {
  res.json(getAllSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      setSetting(key, value);
    }
    res.json({ success: true, settings: getAllSettings() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Manuel Emir ---
app.post('/api/order', async (req, res) => {
  try {
    const { exchange, symbol, type, side, amount, price } = req.body;
    if (!riskManager.canTrade()) {
      return res.status(403).json({ error: 'Risk yöneticisi işleme izin vermiyor.' });
    }
    const order = await exchangeManager.createOrder(exchange, symbol, type, side, amount, price);
    insertTrade({
      exchange, symbol, side, type, price: price || order.price || 0,
      amount, cost: order.cost || 0, order_id: order.id, strategy: 'manual', status: 'filled',
    });
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== SPA FALLBACK ====================
if (fs.existsSync(frontendDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ==================== GRACEFUL SHUTDOWN ====================
function shutdown(signal) {
  logger.info(`${signal} alındı — kapatılıyor...`);

  // Timer'ları durdur
  for (const timer of cronTimers) clearInterval(timer);

  // Motorları durdur
  if (futuresEngine?.running) futuresEngine.stop();
  if (dcaEngine) dcaEngine.stopAll();

  // Borsaları kapat
  exchangeManager.closeAll();

  // DB kapat
  closeDatabase();

  // Server kapat
  server.close(() => {
    logger.info('Sunucu kapatıldı.');
    process.exit(0);
  });

  // 5 saniye timeout
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ==================== BAŞLAT ====================
bootstrap().catch(err => {
  logger.error(`Başlatma hatası: ${err.message}`);
  console.error(err);
  process.exit(1);
});
