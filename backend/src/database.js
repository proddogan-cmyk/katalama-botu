import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

export function initDatabase(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cryptoforge.db');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  createTables();
  insertDefaultSettings();

  console.log(`[DB] Veritabanı başlatıldı: ${resolvedPath}`);
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy','sell')),
      type TEXT NOT NULL DEFAULT 'market',
      price REAL NOT NULL,
      amount REAL NOT NULL,
      cost REAL,
      fee REAL DEFAULT 0,
      fee_currency TEXT,
      strategy TEXT,
      strategy_id TEXT,
      order_id TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','filled','cancelled','failed')),
      pnl REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS grid_bots (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      upper_price REAL NOT NULL,
      lower_price REAL NOT NULL,
      grid_count INTEGER NOT NULL,
      investment REAL NOT NULL,
      stop_loss_pct REAL DEFAULT 5,
      take_profit_pct REAL DEFAULT 10,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','stopped')),
      total_profit REAL DEFAULT 0,
      total_trades INTEGER DEFAULT 0,
      grid_orders TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dca_plans (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      amount REAL NOT NULL,
      interval TEXT NOT NULL CHECK(interval IN ('hourly','daily','weekly','biweekly','monthly')),
      total_invested REAL DEFAULT 0,
      total_coins REAL DEFAULT 0,
      avg_buy_price REAL DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','stopped')),
      last_buy_at DATETIME,
      next_buy_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ta_signals (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      signal TEXT NOT NULL,
      strength REAL DEFAULT 0,
      rsi REAL,
      macd REAL,
      macd_signal REAL,
      macd_histogram REAL,
      bollinger_upper REAL,
      bollinger_middle REAL,
      bollinger_lower REAL,
      bollinger_position REAL,
      auto_trade INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS arbitrage_history (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      buy_exchange TEXT NOT NULL,
      sell_exchange TEXT NOT NULL,
      buy_price REAL NOT NULL,
      sell_price REAL NOT NULL,
      spread_pct REAL NOT NULL,
      amount REAL,
      profit REAL DEFAULT 0,
      status TEXT DEFAULT 'detected',
      execution_time_ms INTEGER,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_value_usd REAL,
      balances TEXT DEFAULT '{}',
      pnl_24h REAL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT,
      severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    -- İndeksler
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_ta_signals_symbol ON ta_signals(symbol);
    CREATE INDEX IF NOT EXISTS idx_ta_signals_created ON ta_signals(created_at);
    CREATE INDEX IF NOT EXISTS idx_arbitrage_created ON arbitrage_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_portfolio_created ON portfolio_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_risk_events_type ON risk_events(type);
    CREATE INDEX IF NOT EXISTS idx_grid_bots_status ON grid_bots(status);
    CREATE INDEX IF NOT EXISTS idx_dca_plans_status ON dca_plans(status);
  `);
}

function insertDefaultSettings() {
  const defaults = {
    'risk.max_daily_loss_pct': '10',
    'risk.max_position_risk_pct': '3',
    'risk.max_open_positions': '2',
    'risk.max_margin_usage_pct': '50',
    'risk.min_rr_ratio': '2.5',
    'futures.default_leverage': '2',
    'futures.max_leverage': '4',
    'futures.min_signal_score': '7',
    'futures.trailing_stop_activate_pct': '2',
    'futures.trailing_stop_distance_pct': '1.5',
    'futures.partial_close_pct': '4',
    'futures.partial_close_amount': '50',
    'futures.scan_interval_sec': '60',
    'futures.position_check_sec': '5',
    'futures.coins': 'BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,XRP/USDT,DOGE/USDT,ADA/USDT,AVAX/USDT,DOT/USDT,MATIC/USDT',
    'grid.check_interval_sec': '10',
    'arbitrage.min_spread_pct': '0.15',
    'arbitrage.scan_interval_sec': '3',
    'arbitrage.auto_execute': '0',
    'arbitrage.coins': 'BTC/USDT,ETH/USDT,SOL/USDT',
    'telegram.enabled': '1',
    'telegram.trade_notifications': '1',
    'telegram.daily_report': '1',
    'telegram.risk_alerts': '1',
    'bot.locked': '0',
    'bot.lock_until': '',
    'bot.initial_balance': '100',
  };

  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, value);
  }
}

// ==================== REPOSITORY FONKSİYONLARI ====================

// --- Settings ---
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function getSettingNum(key, defaultVal = 0) {
  const val = getSetting(key);
  return val !== null ? parseFloat(val) : defaultVal;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))').run(key, String(value));
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// --- Trades ---
export function insertTrade(trade) {
  const id = trade.id || uuidv4();
  db.prepare(`
    INSERT INTO trades (id, exchange, symbol, side, type, price, amount, cost, fee, fee_currency, strategy, strategy_id, order_id, status, pnl, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, trade.exchange, trade.symbol, trade.side, trade.type || 'market', trade.price, trade.amount, trade.cost || 0, trade.fee || 0, trade.fee_currency || 'USDT', trade.strategy || null, trade.strategy_id || null, trade.order_id || null, trade.status || 'filled', trade.pnl || 0, trade.notes || null);
  return id;
}

export function getTrades(limit = 50, offset = 0, filters = {}) {
  let where = 'WHERE 1=1';
  const params = [];
  if (filters.symbol) { where += ' AND symbol = ?'; params.push(filters.symbol); }
  if (filters.strategy) { where += ' AND strategy = ?'; params.push(filters.strategy); }
  if (filters.status) { where += ' AND status = ?'; params.push(filters.status); }
  if (filters.exchange) { where += ' AND exchange = ?'; params.push(filters.exchange); }
  params.push(limit, offset);
  return db.prepare(`SELECT * FROM trades ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);
}

export function getTradeStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM trades WHERE status = ?').get('filled');
  const wins = db.prepare('SELECT COUNT(*) as count FROM trades WHERE status = ? AND pnl > 0').get('filled');
  const losses = db.prepare('SELECT COUNT(*) as count FROM trades WHERE status = ? AND pnl < 0').get('filled');
  const totalPnl = db.prepare('SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE status = ?').get('filled');
  const totalProfit = db.prepare('SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE status = ? AND pnl > 0').get('filled');
  const totalLoss = db.prepare('SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE status = ? AND pnl < 0').get('filled');
  const todayPnl = db.prepare("SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE status = 'filled' AND created_at >= date('now')").get();

  return {
    totalTrades: total.count,
    winCount: wins.count,
    lossCount: losses.count,
    winRate: total.count > 0 ? ((wins.count / total.count) * 100).toFixed(1) : 0,
    totalPnl: totalPnl.total,
    totalProfit: totalProfit.total,
    totalLoss: totalLoss.total,
    profitFactor: totalLoss.total !== 0 ? Math.abs(totalProfit.total / totalLoss.total).toFixed(2) : 'N/A',
    todayPnl: todayPnl.total,
  };
}

// --- Grid Bots ---
export function insertGridBot(bot) {
  const id = bot.id || uuidv4();
  db.prepare(`
    INSERT INTO grid_bots (id, exchange, symbol, upper_price, lower_price, grid_count, investment, stop_loss_pct, take_profit_pct, grid_orders)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, bot.exchange, bot.symbol, bot.upper_price, bot.lower_price, bot.grid_count, bot.investment, bot.stop_loss_pct || 5, bot.take_profit_pct || 10, JSON.stringify(bot.grid_orders || []));
  return id;
}

export function getGridBots(status) {
  if (status) return db.prepare('SELECT * FROM grid_bots WHERE status = ?').all(status);
  return db.prepare('SELECT * FROM grid_bots ORDER BY created_at DESC').all();
}

export function getGridBot(id) {
  return db.prepare('SELECT * FROM grid_bots WHERE id = ?').get(id);
}

export function updateGridBot(id, updates) {
  const fields = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    params.push(typeof value === 'object' ? JSON.stringify(value) : value);
  }
  fields.push('updated_at = datetime("now")');
  params.push(id);
  db.prepare(`UPDATE grid_bots SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

// --- DCA Plans ---
export function insertDCAPlan(plan) {
  const id = plan.id || uuidv4();
  db.prepare(`
    INSERT INTO dca_plans (id, exchange, symbol, amount, interval, next_buy_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, plan.exchange, plan.symbol, plan.amount, plan.interval, plan.next_buy_at || null);
  return id;
}

export function getDCAPlans(status) {
  if (status) return db.prepare('SELECT * FROM dca_plans WHERE status = ?').all(status);
  return db.prepare('SELECT * FROM dca_plans ORDER BY created_at DESC').all();
}

export function getDCAPlan(id) {
  return db.prepare('SELECT * FROM dca_plans WHERE id = ?').get(id);
}

export function updateDCAPlan(id, updates) {
  const fields = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    params.push(value);
  }
  fields.push('updated_at = datetime("now")');
  params.push(id);
  db.prepare(`UPDATE dca_plans SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteDCAPlan(id) {
  db.prepare('DELETE FROM dca_plans WHERE id = ?').run(id);
}

// --- TA Signals ---
export function insertTASignal(signal) {
  const id = signal.id || uuidv4();
  db.prepare(`
    INSERT INTO ta_signals (id, exchange, symbol, signal, strength, rsi, macd, macd_signal, macd_histogram, bollinger_upper, bollinger_middle, bollinger_lower, bollinger_position, auto_trade)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, signal.exchange, signal.symbol, signal.signal, signal.strength || 0, signal.rsi, signal.macd, signal.macd_signal, signal.macd_histogram, signal.bollinger_upper, signal.bollinger_middle, signal.bollinger_lower, signal.bollinger_position, signal.auto_trade || 0);
  return id;
}

export function getLatestSignals(limit = 20) {
  return db.prepare('SELECT * FROM ta_signals ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getLatestSignalForSymbol(symbol) {
  return db.prepare('SELECT * FROM ta_signals WHERE symbol = ? ORDER BY created_at DESC LIMIT 1').get(symbol);
}

// --- Arbitrage ---
export function insertArbitrageHistory(arb) {
  const id = arb.id || uuidv4();
  db.prepare(`
    INSERT INTO arbitrage_history (id, symbol, buy_exchange, sell_exchange, buy_price, sell_price, spread_pct, amount, profit, status, execution_time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, arb.symbol, arb.buy_exchange, arb.sell_exchange, arb.buy_price, arb.sell_price, arb.spread_pct, arb.amount || 0, arb.profit || 0, arb.status || 'detected', arb.execution_time_ms || 0);
  return id;
}

export function getArbitrageHistory(limit = 50) {
  return db.prepare('SELECT * FROM arbitrage_history ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getArbitrageStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM arbitrage_history').get();
  const executed = db.prepare("SELECT COUNT(*) as count FROM arbitrage_history WHERE status = 'executed'").get();
  const totalProfit = db.prepare("SELECT COALESCE(SUM(profit), 0) as total FROM arbitrage_history WHERE status = 'executed'").get();
  const avgSpread = db.prepare('SELECT COALESCE(AVG(spread_pct), 0) as avg FROM arbitrage_history').get();
  return { totalDetected: total.count, totalExecuted: executed.count, totalProfit: totalProfit.total, avgSpread: avgSpread.avg };
}

// --- Portfolio Snapshots ---
export function insertPortfolioSnapshot(snapshot) {
  db.prepare(`
    INSERT INTO portfolio_snapshots (total_value_usd, balances, pnl_24h)
    VALUES (?, ?, ?)
  `).run(snapshot.total_value_usd, JSON.stringify(snapshot.balances || {}), snapshot.pnl_24h || 0);
}

export function getLatestPortfolioSnapshot() {
  return db.prepare('SELECT * FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1').get();
}

export function getPortfolioHistory(limit = 168) {
  return db.prepare('SELECT * FROM portfolio_snapshots ORDER BY created_at DESC LIMIT ?').all(limit);
}

// --- Risk Events ---
export function insertRiskEvent(event) {
  const id = event.id || uuidv4();
  db.prepare(`
    INSERT INTO risk_events (id, type, message, severity)
    VALUES (?, ?, ?, ?)
  `).run(id, event.type, event.message, event.severity || 'info');
  return id;
}

export function getUnresolvedRiskEvents() {
  return db.prepare('SELECT * FROM risk_events WHERE resolved = 0 ORDER BY created_at DESC').all();
}

export function resolveRiskEvent(id) {
  db.prepare('UPDATE risk_events SET resolved = 1 WHERE id = ?').run(id);
}

// --- Genel ---
export function getDB() {
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    console.log('[DB] Veritabanı kapatıldı.');
  }
}
