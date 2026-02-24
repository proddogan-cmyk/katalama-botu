import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = '/api';
const MONO = "'JetBrains Mono', monospace";

// ==================== HOOKS ====================
function useAPI(endpoint, interval = null) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

function useWebSocket() {
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try { setLastMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => setTimeout(() => {}, 3000);
    return () => ws.close();
  }, []);

  return lastMessage;
}

async function apiPost(endpoint, body = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

async function apiPut(endpoint, body = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

async function apiDelete(endpoint) {
  const res = await fetch(`${API}${endpoint}`, { method: 'DELETE' });
  return res.json();
}

// ==================== STYLES ====================
const S = {
  container: { minHeight: '100vh', background: '#0A0B0F', color: '#E1E1E6', fontFamily: "'Inter', sans-serif" },
  header: { background: '#12131A', borderBottom: '1px solid #1E1F2E', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 },
  logo: { fontSize: 20, fontWeight: 700, color: '#8B5CF6', letterSpacing: 1 },
  balBadge: { background: '#1A1B2E', padding: '6px 16px', borderRadius: 8, fontFamily: MONO, fontSize: 16, fontWeight: 600, color: '#10B981' },
  nav: { display: 'flex', gap: 4, background: '#12131A', padding: '8px 24px', borderBottom: '1px solid #1E1F2E', overflowX: 'auto' },
  navBtn: (active) => ({ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: active ? '#8B5CF6' : 'transparent', color: active ? '#fff' : '#8B8B9A', transition: 'all 0.2s' }),
  main: { padding: 24, maxWidth: 1400, margin: '0 auto' },
  card: { background: '#12131A', borderRadius: 12, border: '1px solid #1E1F2E', padding: 20, marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#C4C4CC' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 },
  stat: { textAlign: 'center', padding: 16 },
  statVal: { fontSize: 24, fontWeight: 700, fontFamily: MONO },
  statLabel: { fontSize: 12, color: '#8B8B9A', marginTop: 4 },
  btn: (color = '#8B5CF6') => ({ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: color, color: '#fff', transition: 'all 0.2s' }),
  btnSm: (color = '#8B5CF6') => ({ padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: color, color: '#fff' }),
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #2A2B3E', background: '#0A0B0F', color: '#E1E1E6', fontSize: 13, fontFamily: MONO, width: '100%', boxSizing: 'border-box' },
  select: { padding: '8px 12px', borderRadius: 6, border: '1px solid #2A2B3E', background: '#0A0B0F', color: '#E1E1E6', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '8px 12px', borderBottom: '1px solid #1E1F2E', textAlign: 'left', color: '#8B8B9A', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' },
  td: { padding: '8px 12px', borderBottom: '1px solid #0F1015', fontFamily: MONO, fontSize: 12 },
  badge: (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: color + '22', color }),
  progress: (pct, color = '#10B981') => ({ width: '100%', height: 6, background: '#1E1F2E', borderRadius: 3, overflow: 'hidden', position: 'relative' }),
  green: '#10B981', red: '#EF4444', yellow: '#F59E0B', purple: '#8B5CF6', blue: '#3B82F6',
};

// ==================== HELPER COMPONENTS ====================
function StatCard({ label, value, color = '#E1E1E6', prefix = '', suffix = '' }) {
  return (
    <div style={{ ...S.card, ...S.stat }}>
      <div style={{ ...S.statVal, color }}>{prefix}{value}{suffix}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

function Badge({ text, color }) {
  return <span style={S.badge(color)}>{text}</span>;
}

function ProgressBar({ value, max = 100, color = '#10B981', height = 6 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ width: '100%', height, background: '#1E1F2E', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: height / 2, transition: 'width 0.3s' }} />
    </div>
  );
}

function SignalScoreBar({ score }) {
  const color = score >= 9 ? S.green : score >= 7 ? S.yellow : S.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ProgressBar value={score} max={10} color={color} height={8} />
      <span style={{ fontFamily: MONO, fontWeight: 700, color, fontSize: 14, minWidth: 40 }}>{score}/10</span>
    </div>
  );
}

function LayerIndicator({ name, score, maxScore, status }) {
  const icon = score >= maxScore ? '✅' : score > 0 ? '⚠️' : '❌';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
      <span>{icon}</span>
      <span style={{ color: '#8B8B9A', minWidth: 120 }}>{name}</span>
      <span style={{ fontFamily: MONO, fontWeight: 600, color: score >= maxScore ? S.green : score > 0 ? S.yellow : S.red }}>{score}/{maxScore}</span>
      <span style={{ color: '#6B6B7A', fontSize: 11 }}>{status}</span>
    </div>
  );
}

function LeverageBadge({ leverage, mode }) {
  const is4x = leverage >= 4;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700, fontFamily: MONO,
      background: is4x ? '#7C3AED22' : '#374151', color: is4x ? '#A78BFA' : '#9CA3AF',
    }}>
      {leverage}x {is4x && '🔥 GÜVEN'}
    </span>
  );
}

function SLTPProgress({ entry, current, sl, tp, direction }) {
  if (!entry || !sl || !tp) return null;
  const range = Math.abs(tp - sl);
  let pct;
  if (direction === 'long') {
    pct = ((current - sl) / range) * 100;
  } else {
    pct = ((sl - current) / range) * 100;
  }
  pct = Math.min(100, Math.max(0, pct));
  const color = pct > 70 ? S.green : pct > 40 ? S.yellow : S.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: S.red, fontFamily: MONO }}>SL</span>
      <div style={{ flex: 1 }}><ProgressBar value={pct} color={color} height={4} /></div>
      <span style={{ color: S.green, fontFamily: MONO }}>TP</span>
    </div>
  );
}

// ==================== TABS ====================

// --- 1. GENEL BAKIS ---
function DashboardTab() {
  const { data, loading } = useAPI('/dashboard', 10000);
  if (loading || !data) return <div>Yükleniyor...</div>;

  const { balance, stats, risk, recentTrades, futures, activeStrategies } = data;
  return (
    <div>
      <div style={S.grid4}>
        <StatCard label="Toplam Bakiye" value={`$${(balance?.total || 100).toFixed(2)}`} color={S.green} />
        <StatCard label="Toplam P&L" value={`${stats?.totalPnl >= 0 ? '+' : ''}$${(stats?.totalPnl || 0).toFixed(2)}`} color={stats?.totalPnl >= 0 ? S.green : S.red} />
        <StatCard label="Kazanma Oranı" value={`${stats?.winRate || 0}%`} color={S.yellow} />
        <StatCard label="Bugün P&L" value={`${stats?.todayPnl >= 0 ? '+' : ''}$${(stats?.todayPnl || 0).toFixed(2)}`} color={stats?.todayPnl >= 0 ? S.green : S.red} />
      </div>

      <div style={S.grid2}>
        <div style={S.card}>
          <div style={S.cardTitle}>Borsa Bakiyeleri</div>
          {balance?.byExchange && Object.entries(balance.byExchange).map(([ex, bal]) => (
            <div key={ex} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1E1F2E' }}>
              <span style={{ textTransform: 'capitalize' }}>{ex}</span>
              <span style={{ fontFamily: MONO, color: S.green }}>${(bal.totalUSD || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Aktif Stratejiler</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Futures</span>
              <Badge text={activeStrategies?.futures ? 'AKTIF' : 'KAPALI'} color={activeStrategies?.futures ? S.green : S.red} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Grid Botlar</span>
              <span style={{ fontFamily: MONO }}>{activeStrategies?.gridBots || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>DCA Planları</span>
              <span style={{ fontFamily: MONO }}>{activeStrategies?.dcaPlans || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Arbitraj Oto</span>
              <Badge text={activeStrategies?.arbitrage ? 'AKTIF' : 'KAPALI'} color={activeStrategies?.arbitrage ? S.green : S.red} />
            </div>
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Son İşlemler</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Tarih</th><th style={S.th}>Borsa</th><th style={S.th}>Sembol</th>
              <th style={S.th}>Yön</th><th style={S.th}>Fiyat</th><th style={S.th}>Miktar</th>
              <th style={S.th}>P&L</th><th style={S.th}>Strateji</th>
            </tr>
          </thead>
          <tbody>
            {(recentTrades || []).map(t => (
              <tr key={t.id}>
                <td style={S.td}>{new Date(t.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={S.td}>{t.exchange}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{t.symbol}</td>
                <td style={S.td}><Badge text={t.side.toUpperCase()} color={t.side === 'buy' ? S.green : S.red} /></td>
                <td style={S.td}>${Number(t.price).toFixed(2)}</td>
                <td style={S.td}>{Number(t.amount).toFixed(6)}</td>
                <td style={{ ...S.td, color: t.pnl >= 0 ? S.green : S.red }}>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '-'}</td>
                <td style={S.td}><Badge text={t.strategy || 'manual'} color={S.purple} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 2. PİYASA ---
function MarketTab() {
  const { data, loading } = useAPI('/market', 5000);
  if (loading || !data) return <div>Yükleniyor...</div>;

  return (
    <div style={S.card}>
      <div style={S.cardTitle}>Canlı Fiyat Karşılaştırması (3 Borsa)</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Sembol</th>
            <th style={S.th}>Binance</th><th style={S.th}>Bybit</th><th style={S.th}>OKX</th>
            <th style={S.th}>Fark</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([symbol, exchanges]) => {
            const prices = Object.values(exchanges).filter(e => e.last).map(e => e.last);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const diff = min > 0 ? ((max - min) / min * 100).toFixed(3) : '0';
            return (
              <tr key={symbol}>
                <td style={{ ...S.td, fontWeight: 700, color: '#fff' }}>{symbol}</td>
                {['binance', 'bybit', 'okx'].map(ex => (
                  <td key={ex} style={S.td}>
                    {exchanges[ex]?.last ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>${Number(exchanges[ex].last).toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: (exchanges[ex].change || 0) >= 0 ? S.green : S.red }}>
                          {exchanges[ex].change >= 0 ? '+' : ''}{(exchanges[ex].change || 0).toFixed(2)}%
                        </div>
                      </div>
                    ) : <span style={{ color: '#4A4A5A' }}>-</span>}
                  </td>
                ))}
                <td style={{ ...S.td, color: parseFloat(diff) > 0.1 ? S.yellow : '#6B6B7A' }}>{diff}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- 3. GRID TRADING ---
function GridTab() {
  const { data: bots, refetch } = useAPI('/grid/bots', 10000);
  const [form, setForm] = useState({ exchange: 'binance', symbol: 'BTC/USDT', upper_price: '', lower_price: '', grid_count: 10, investment: 50, stop_loss_pct: 5, take_profit_pct: 10 });

  const createBot = async () => {
    await apiPost('/grid/bots', { ...form, upper_price: parseFloat(form.upper_price), lower_price: parseFloat(form.lower_price), grid_count: parseInt(form.grid_count), investment: parseFloat(form.investment) });
    refetch();
  };

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Yeni Grid Bot</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Borsa</label><select style={S.select} value={form.exchange} onChange={e => setForm({ ...form, exchange: e.target.value })}><option>binance</option><option>bybit</option><option>okx</option></select></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Sembol</label><input style={S.input} value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Üst Fiyat</label><input style={S.input} type="number" value={form.upper_price} onChange={e => setForm({ ...form, upper_price: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Alt Fiyat</label><input style={S.input} type="number" value={form.lower_price} onChange={e => setForm({ ...form, lower_price: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Grid Sayısı</label><input style={S.input} type="number" value={form.grid_count} onChange={e => setForm({ ...form, grid_count: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Yatırım ($)</label><input style={S.input} type="number" value={form.investment} onChange={e => setForm({ ...form, investment: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>SL %</label><input style={S.input} type="number" value={form.stop_loss_pct} onChange={e => setForm({ ...form, stop_loss_pct: e.target.value })} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button style={S.btn(S.purple)} onClick={createBot}>Bot Oluştur</button></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Aktif Grid Botlar</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Sembol</th><th style={S.th}>Aralık</th><th style={S.th}>Grid</th><th style={S.th}>Yatırım</th><th style={S.th}>Kâr</th><th style={S.th}>Durum</th><th style={S.th}>İşlem</th></tr></thead>
          <tbody>
            {(bots || []).map(b => (
              <tr key={b.id}>
                <td style={{ ...S.td, fontWeight: 600 }}>{b.symbol}</td>
                <td style={S.td}>${b.lower_price} - ${b.upper_price}</td>
                <td style={S.td}>{b.grid_count}</td>
                <td style={S.td}>${b.investment}</td>
                <td style={{ ...S.td, color: (b.total_profit || 0) >= 0 ? S.green : S.red }}>${(b.total_profit || 0).toFixed(4)}</td>
                <td style={S.td}><Badge text={b.status} color={b.status === 'active' ? S.green : b.status === 'paused' ? S.yellow : S.red} /></td>
                <td style={S.td}>
                  {b.status === 'active' && <button style={S.btnSm(S.yellow)} onClick={() => { apiPost(`/grid/bots/${b.id}/pause`); refetch(); }}>Duraklat</button>}
                  {b.status === 'paused' && <button style={S.btnSm(S.green)} onClick={() => { apiPost(`/grid/bots/${b.id}/resume`); refetch(); }}>Devam</button>}
                  {b.status !== 'stopped' && <button style={{ ...S.btnSm(S.red), marginLeft: 4 }} onClick={() => { apiPost(`/grid/bots/${b.id}/stop`); refetch(); }}>Durdur</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 4. DCA ---
function DCATab() {
  const { data: plans, refetch } = useAPI('/dca/plans', 10000);
  const [form, setForm] = useState({ exchange: 'binance', symbol: 'BTC/USDT', amount: 10, interval: 'daily' });

  const createPlan = async () => {
    await apiPost('/dca/plans', form);
    refetch();
  };

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Yeni DCA Planı</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Borsa</label><select style={S.select} value={form.exchange} onChange={e => setForm({ ...form, exchange: e.target.value })}><option>binance</option><option>bybit</option><option>okx</option></select></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Sembol</label><input style={S.input} value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Miktar ($)</label><input style={S.input} type="number" value={form.amount} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) })} /></div>
          <div><label style={{ fontSize: 11, color: '#8B8B9A' }}>Aralık</label><select style={S.select} value={form.interval} onChange={e => setForm({ ...form, interval: e.target.value })}><option value="hourly">Saatlik</option><option value="daily">Günlük</option><option value="weekly">Haftalık</option><option value="biweekly">2 Hafta</option><option value="monthly">Aylık</option></select></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button style={S.btn(S.green)} onClick={createPlan}>Plan Oluştur</button></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>DCA Planları</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Sembol</th><th style={S.th}>Miktar</th><th style={S.th}>Aralık</th><th style={S.th}>Toplam Yatırım</th><th style={S.th}>Ort. Fiyat</th><th style={S.th}>ROI</th><th style={S.th}>Durum</th><th style={S.th}>İşlem</th></tr></thead>
          <tbody>
            {(plans || []).map(p => (
              <tr key={p.id}>
                <td style={{ ...S.td, fontWeight: 600 }}>{p.symbol}</td>
                <td style={S.td}>${p.amount}</td>
                <td style={S.td}>{p.interval}</td>
                <td style={S.td}>${(p.total_invested || 0).toFixed(2)}</td>
                <td style={S.td}>${(p.avg_buy_price || 0).toFixed(2)}</td>
                <td style={{ ...S.td, color: parseFloat(p.roi || 0) >= 0 ? S.green : S.red }}>{p.roi || 0}%</td>
                <td style={S.td}><Badge text={p.status} color={p.status === 'active' ? S.green : S.yellow} /></td>
                <td style={S.td}>
                  <button style={S.btnSm(S.blue)} onClick={() => { apiPost(`/dca/plans/${p.id}/buy`); refetch(); }}>Manuel Al</button>
                  {p.status === 'active' && <button style={{ ...S.btnSm(S.yellow), marginLeft: 4 }} onClick={() => { apiPost(`/dca/plans/${p.id}/pause`); refetch(); }}>Duraklat</button>}
                  {p.status === 'paused' && <button style={{ ...S.btnSm(S.green), marginLeft: 4 }} onClick={() => { apiPost(`/dca/plans/${p.id}/resume`); refetch(); }}>Devam</button>}
                  <button style={{ ...S.btnSm(S.red), marginLeft: 4 }} onClick={() => { apiDelete(`/dca/plans/${p.id}`); refetch(); }}>Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 5. TEKNİK ANALİZ ---
function TATab() {
  const { data: signals, loading } = useAPI('/ta/signals/all', 30000);
  if (loading) return <div>Sinyaller hesaplanıyor...</div>;

  return (
    <div style={S.card}>
      <div style={S.cardTitle}>Tüm Coinlerin Teknik Analiz Sinyalleri</div>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Sembol</th><th style={S.th}>Sinyal</th><th style={S.th}>Güç</th><th style={S.th}>RSI</th><th style={S.th}>MACD</th><th style={S.th}>BB Pozisyon</th><th style={S.th}>Alım Puanı</th><th style={S.th}>Satım Puanı</th></tr></thead>
        <tbody>
          {(signals || []).map(s => (
            <tr key={s.symbol}>
              <td style={{ ...S.td, fontWeight: 700, color: '#fff' }}>{s.symbol}</td>
              <td style={S.td}>
                <Badge text={s.signal || 'neutral'} color={
                  s.signal?.includes('buy') ? S.green : s.signal?.includes('sell') ? S.red : '#6B6B7A'
                } />
              </td>
              <td style={S.td}><ProgressBar value={s.strength || 0} color={s.strength >= 70 ? S.green : s.strength >= 40 ? S.yellow : S.red} /></td>
              <td style={{ ...S.td, color: s.indicators?.rsi < 30 ? S.green : s.indicators?.rsi > 70 ? S.red : '#E1E1E6' }}>{s.indicators?.rsi?.toFixed(1) || '-'}</td>
              <td style={S.td}>{s.indicators?.macd?.histogram?.toFixed(4) || '-'}</td>
              <td style={S.td}>{s.indicators?.bollinger?.position?.toFixed(2) || '-'}</td>
              <td style={{ ...S.td, color: S.green }}>{s.buyScore || 0}</td>
              <td style={{ ...S.td, color: S.red }}>{s.sellScore || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- 6. ARBİTRAJ ---
function ArbitrageTab() {
  const { data: opps, refetch: refetchOpps } = useAPI('/arbitrage/opportunities', 5000);
  const { data: stats } = useAPI('/arbitrage/stats', 10000);
  const { data: history } = useAPI('/arbitrage/history?limit=20', 10000);

  return (
    <div>
      <div style={S.grid4}>
        <StatCard label="Tespit Edilen" value={stats?.totalDetected || 0} color={S.blue} />
        <StatCard label="İşlem Yapılan" value={stats?.totalExecuted || 0} color={S.green} />
        <StatCard label="Toplam Kâr" value={`$${(stats?.totalProfit || 0).toFixed(4)}`} color={S.green} />
        <StatCard label="Ort. Spread" value={`${(stats?.avgSpread || 0).toFixed(3)}%`} color={S.yellow} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={S.btn(S.blue)} onClick={() => apiPost('/arbitrage/scan').then(refetchOpps)}>Manuel Tara</button>
        <button style={S.btn(S.green)} onClick={() => apiPost('/arbitrage/auto/enable')}>Oto Aç</button>
        <button style={S.btn(S.red)} onClick={() => apiPost('/arbitrage/auto/disable')}>Oto Kapat</button>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Canlı Fırsatlar</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Sembol</th><th style={S.th}>Al Borsa</th><th style={S.th}>Al Fiyat</th><th style={S.th}>Sat Borsa</th><th style={S.th}>Sat Fiyat</th><th style={S.th}>Spread</th></tr></thead>
          <tbody>
            {(opps || []).map(o => (
              <tr key={o.id}>
                <td style={{ ...S.td, fontWeight: 600 }}>{o.symbol}</td>
                <td style={{ ...S.td, color: S.green }}>{o.buyExchange}</td>
                <td style={S.td}>${Number(o.buyPrice).toFixed(2)}</td>
                <td style={{ ...S.td, color: S.red }}>{o.sellExchange}</td>
                <td style={S.td}>${Number(o.sellPrice).toFixed(2)}</td>
                <td style={{ ...S.td, color: S.yellow, fontWeight: 700 }}>{o.spread}%</td>
              </tr>
            ))}
            {(!opps || opps.length === 0) && <tr><td style={{ ...S.td, color: '#4A4A5A' }} colSpan={6}>Fırsat bulunamadı</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Geçmiş</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Tarih</th><th style={S.th}>Sembol</th><th style={S.th}>Al</th><th style={S.th}>Sat</th><th style={S.th}>Spread</th><th style={S.th}>Kâr</th><th style={S.th}>Durum</th></tr></thead>
          <tbody>
            {(history || []).map(h => (
              <tr key={h.id}>
                <td style={S.td}>{new Date(h.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{h.symbol}</td>
                <td style={S.td}>{h.buy_exchange}</td>
                <td style={S.td}>{h.sell_exchange}</td>
                <td style={S.td}>{Number(h.spread_pct).toFixed(3)}%</td>
                <td style={{ ...S.td, color: S.green }}>${(h.profit || 0).toFixed(4)}</td>
                <td style={S.td}><Badge text={h.status} color={h.status === 'executed' ? S.green : h.status === 'failed' ? S.red : S.blue} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 7. FUTURES $100 ---
function FuturesTab() {
  const { data: status, refetch } = useAPI('/futures/status', 5000);
  const [analyzeSymbol, setAnalyzeSymbol] = useState('BTC/USDT');
  const [analysis, setAnalysis] = useState(null);
  const { data: trades } = useAPI('/trades?strategy=futures-100&limit=20', 10000);

  const startBot = async () => { await apiPost('/futures/start'); refetch(); };
  const stopBot = async () => { await apiPost('/futures/stop'); refetch(); };
  const closeAll = async () => { await apiPost('/futures/close-all'); refetch(); };
  const analyze = async () => {
    const res = await fetch(`${API}/futures/analyze/${analyzeSymbol.replace('/', '-')}`);
    setAnalysis(await res.json());
  };

  const positions = status?.positions ? Object.values(status.positions) : [];

  return (
    <div>
      {/* Kontroller */}
      <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>$100 Katlama Motoru</span>
          <Badge text={status?.running ? 'AKTIF' : 'KAPALI'} color={status?.running ? S.green : S.red} />
          {status?.locked && <Badge text="KILITLI" color={S.red} />}
        </div>
        <div style={{ fontFamily: MONO, color: status?.dailyPnL >= 0 ? S.green : S.red }}>
          Günlük: {status?.dailyPnL >= 0 ? '+' : ''}${(status?.dailyPnL || 0).toFixed(2)}
        </div>
        {!status?.running && <button style={S.btn(S.green)} onClick={startBot}>Başlat</button>}
        {status?.running && <button style={S.btn(S.red)} onClick={stopBot}>Durdur</button>}
        {positions.length > 0 && <button style={S.btn(S.yellow)} onClick={closeAll}>Tümünü Kapat</button>}
      </div>

      {/* Analiz */}
      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: '#8B8B9A' }}>Coin Analiz Et</label>
          <select style={S.select} value={analyzeSymbol} onChange={e => setAnalyzeSymbol(e.target.value)}>
            {(status?.coins || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button style={S.btn(S.blue)} onClick={analyze}>Analiz Et</button>
      </div>

      {/* Analiz Sonuç */}
      {analysis && !analysis.error && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{analysis.symbol}</span>
              {analysis.direction && <Badge text={analysis.direction.toUpperCase()} color={analysis.direction === 'long' ? S.green : S.red} />}
              <LeverageBadge leverage={analysis.leverage} mode={analysis.leverageMode} />
            </div>
            <div>
              <Badge text={analysis.wouldTrade ? 'İŞLEME GİRİLİR' : 'İŞLEM YOK'} color={analysis.wouldTrade ? S.green : S.red} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#8B8B9A', marginBottom: 4 }}>Sinyal Puanı</div>
            <SignalScoreBar score={analysis.score} />
          </div>

          <div style={S.grid2}>
            <div>
              <div style={{ fontSize: 12, color: '#8B8B9A', marginBottom: 8 }}>7 Katman Puanlama</div>
              {analysis.layers?.trend && <LayerIndicator name="1. Trend Uyumu" score={analysis.layers.trend.score} maxScore={2} status={analysis.layers.trend.status} />}
              {analysis.layers?.rsi && <LayerIndicator name="2. RSI Onay" score={analysis.layers.rsi.score} maxScore={2} status={`RSI: ${analysis.layers.rsi.value?.toFixed(1) || '-'}`} />}
              {analysis.layers?.macd && <LayerIndicator name="3. MACD Onay" score={analysis.layers.macd.score} maxScore={2} status={analysis.layers.macd.status} />}
              {analysis.layers?.bollinger && <LayerIndicator name="4. Bollinger" score={analysis.layers.bollinger.score} maxScore={1} status={`Pos: ${analysis.layers.bollinger.position?.toFixed(2) || '-'}`} />}
              {analysis.layers?.ema && <LayerIndicator name="5. EMA Trend" score={analysis.layers.ema.score} maxScore={1} status={analysis.layers.ema.status} />}
              {analysis.layers?.volume && <LayerIndicator name="6. Hacim" score={analysis.layers.volume.score} maxScore={1} status={`Oran: ${analysis.layers.volume.ratio?.toFixed(2) || '-'}x`} />}
              {analysis.layers?.entry_timing && <LayerIndicator name="7. 15M Giriş" score={analysis.layers.entry_timing.score} maxScore={1} status={analysis.layers.entry_timing.status} />}
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#8B8B9A', marginBottom: 8 }}>Pozisyon Detayı</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>Giriş: <span style={{ fontFamily: MONO, fontWeight: 600 }}>${analysis.entryPrice?.toFixed(2)}</span></div>
                {analysis.sltp && <>
                  <div>SL: <span style={{ fontFamily: MONO, color: S.red }}>${analysis.sltp.stopLoss?.toFixed(2)} ({analysis.sltp.slDistance})</span></div>
                  <div>TP: <span style={{ fontFamily: MONO, color: S.green }}>${analysis.sltp.takeProfit?.toFixed(2)} ({analysis.sltp.tpDistance})</span></div>
                  <div>R:R: <span style={{ fontFamily: MONO, fontWeight: 700 }}>{analysis.sltp.rrRatio}</span></div>
                </>}
                {analysis.sizing && <>
                  <div>Risk: <span style={{ fontFamily: MONO, color: S.yellow }}>${analysis.sizing.riskUSD?.toFixed(2)}</span></div>
                  <div>Margin: <span style={{ fontFamily: MONO }}>${analysis.sizing.margin?.toFixed(2)}</span></div>
                  <div>Miktar: <span style={{ fontFamily: MONO }}>{analysis.sizing.amount?.toFixed(6)}</span></div>
                </>}
                <div>ATR: <span style={{ fontFamily: MONO }}>{analysis.atrPct?.toFixed(2)}%</span></div>
                <div>Zaman Dilimleri: <span style={{ fontSize: 11 }}>15m: {analysis.analysis?.['15m'] || '-'} | 1h: {analysis.analysis?.['1h'] || '-'} | 4h: {analysis.analysis?.['4h'] || '-'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Açık Pozisyonlar */}
      <div style={S.card}>
        <div style={S.cardTitle}>Açık Pozisyonlar ({positions.length})</div>
        {positions.length === 0 ? (
          <div style={{ color: '#4A4A5A', textAlign: 'center', padding: 20 }}>Açık pozisyon yok</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {positions.map(pos => (
              <div key={pos.id} style={{ background: '#0A0B0F', borderRadius: 8, padding: 16, border: '1px solid #1E1F2E' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{pos.symbol}</span>
                    <Badge text={pos.direction.toUpperCase()} color={pos.direction === 'long' ? S.green : S.red} />
                    <LeverageBadge leverage={pos.leverage} mode={pos.leverageMode} />
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: pos.pnl >= 0 ? S.green : S.red }}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl?.toFixed(2)} ({pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct?.toFixed(2)}%)
                  </div>
                </div>
                <div style={S.grid4}>
                  <div><span style={{ fontSize: 11, color: '#8B8B9A' }}>Giriş</span><div style={{ fontFamily: MONO }}>${pos.entryPrice?.toFixed(2)}</div></div>
                  <div><span style={{ fontSize: 11, color: '#8B8B9A' }}>Güncel</span><div style={{ fontFamily: MONO }}>${pos.currentPrice?.toFixed(2)}</div></div>
                  <div><span style={{ fontSize: 11, color: '#8B8B9A' }}>SL</span><div style={{ fontFamily: MONO, color: S.red }}>${pos.stopLoss?.toFixed(2)}</div></div>
                  <div><span style={{ fontSize: 11, color: '#8B8B9A' }}>TP</span><div style={{ fontFamily: MONO, color: S.green }}>${pos.takeProfit?.toFixed(2)}</div></div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <SLTPProgress entry={pos.entryPrice} current={pos.currentPrice} sl={pos.stopLoss} tp={pos.takeProfit} direction={pos.direction} />
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#6B6B7A' }}>
                  Puan: {pos.score}/10 | Margin: ${pos.margin?.toFixed(2)} | {pos.trailingStopActive ? 'TSL Aktif' : ''} {pos.partialClosed ? '| Kısmi Kâr Alındı' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Kaldıraç Tablosu */}
      <div style={S.card}>
        <div style={S.cardTitle}>Kaldıraç Kuralları</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Koşul</th><th style={S.th}>Kaldıraç</th><th style={S.th}>Açıklama</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Sinyal 9+ VE ATR {'<'} %2</td><td style={S.td}><LeverageBadge leverage={4} mode="GÜVEN" /></td><td style={S.td}>Düşük volatilite + güçlü sinyal</td></tr>
            <tr><td style={S.td}>ATR {'>'} %3</td><td style={S.td}><LeverageBadge leverage={2} /></td><td style={S.td}>Yüksek volatilite — kesinlikle 2x</td></tr>
            <tr><td style={S.td}>Varsayılan</td><td style={S.td}><LeverageBadge leverage={2} /></td><td style={S.td}>Normal takip modu</td></tr>
          </tbody>
        </table>
      </div>

      {/* İşlem Geçmişi */}
      <div style={S.card}>
        <div style={S.cardTitle}>Futures İşlem Geçmişi</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Tarih</th><th style={S.th}>Sembol</th><th style={S.th}>Yön</th><th style={S.th}>Fiyat</th><th style={S.th}>P&L</th><th style={S.th}>Not</th></tr></thead>
          <tbody>
            {(trades || []).map(t => (
              <tr key={t.id}>
                <td style={S.td}>{new Date(t.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{t.symbol}</td>
                <td style={S.td}><Badge text={t.side.toUpperCase()} color={t.side === 'buy' ? S.green : S.red} /></td>
                <td style={S.td}>${Number(t.price).toFixed(2)}</td>
                <td style={{ ...S.td, color: (t.pnl || 0) >= 0 ? S.green : S.red }}>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '-'}</td>
                <td style={{ ...S.td, fontSize: 10, color: '#8B8B9A', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 8. PORTFÖY ---
function PortfolioTab() {
  const { data } = useAPI('/portfolio', 30000);

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>Varlık Dağılımı</div>
        {data?.current && Object.entries(data.current).map(([exchange, bal]) => (
          <div key={exchange} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize', marginBottom: 8 }}>{exchange}</div>
            {bal.total && Object.entries(bal.total).filter(([, v]) => v > 0).map(([coin, amount]) => (
              <div key={coin} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0F1015' }}>
                <span>{coin}</span>
                <span style={{ fontFamily: MONO }}>{Number(amount).toFixed(6)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700 }}>
              <span>Toplam USD</span>
              <span style={{ fontFamily: MONO, color: S.green }}>${(bal.totalUSD || 0).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 9. İŞLEMLER ---
function TradesTab() {
  const { data: trades } = useAPI('/trades?limit=100', 10000);
  const { data: stats } = useAPI('/trades/stats', 10000);

  return (
    <div>
      {stats && (
        <div style={S.grid4}>
          <StatCard label="Toplam İşlem" value={stats.totalTrades} color="#fff" />
          <StatCard label="Kazanma Oranı" value={`${stats.winRate}%`} color={S.green} />
          <StatCard label="Profit Factor" value={stats.profitFactor} color={S.blue} />
          <StatCard label="Toplam P&L" value={`$${Number(stats.totalPnl).toFixed(2)}`} color={stats.totalPnl >= 0 ? S.green : S.red} />
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardTitle}>Tüm İşlemler</div>
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Tarih</th><th style={S.th}>Borsa</th><th style={S.th}>Sembol</th><th style={S.th}>Yön</th><th style={S.th}>Tip</th><th style={S.th}>Fiyat</th><th style={S.th}>Miktar</th><th style={S.th}>P&L</th><th style={S.th}>Strateji</th></tr>
          </thead>
          <tbody>
            {(trades || []).map(t => (
              <tr key={t.id}>
                <td style={S.td}>{new Date(t.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={S.td}>{t.exchange}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{t.symbol}</td>
                <td style={S.td}><Badge text={t.side.toUpperCase()} color={t.side === 'buy' ? S.green : S.red} /></td>
                <td style={S.td}>{t.type}</td>
                <td style={S.td}>${Number(t.price).toFixed(2)}</td>
                <td style={S.td}>{Number(t.amount).toFixed(6)}</td>
                <td style={{ ...S.td, color: (t.pnl || 0) >= 0 ? S.green : S.red }}>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '-'}</td>
                <td style={S.td}><Badge text={t.strategy || 'manual'} color={S.purple} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- 10. AYARLAR ---
function SettingsTab() {
  const { data: settings, refetch } = useAPI('/settings');
  const [editing, setEditing] = useState({});

  const save = async () => {
    await apiPut('/settings', editing);
    setEditing({});
    refetch();
  };

  if (!settings) return <div>Yükleniyor...</div>;

  const groups = {
    'Risk Yönetimi': ['risk.max_daily_loss_pct', 'risk.max_position_risk_pct', 'risk.max_open_positions', 'risk.max_margin_usage_pct', 'risk.min_rr_ratio'],
    'Futures': ['futures.default_leverage', 'futures.max_leverage', 'futures.min_signal_score', 'futures.trailing_stop_activate_pct', 'futures.trailing_stop_distance_pct', 'futures.partial_close_pct', 'futures.partial_close_amount', 'futures.scan_interval_sec', 'futures.position_check_sec', 'futures.coins'],
    'Grid': ['grid.check_interval_sec'],
    'Arbitraj': ['arbitrage.min_spread_pct', 'arbitrage.scan_interval_sec', 'arbitrage.auto_execute', 'arbitrage.coins'],
    'Telegram': ['telegram.enabled', 'telegram.trade_notifications', 'telegram.daily_report', 'telegram.risk_alerts'],
    'Bot': ['bot.locked', 'bot.initial_balance'],
  };

  return (
    <div>
      {Object.entries(groups).map(([group, keys]) => (
        <div key={group} style={S.card}>
          <div style={S.cardTitle}>{group}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {keys.map(key => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ fontSize: 12, color: '#8B8B9A', minWidth: 200 }}>{key}</span>
                <input
                  style={{ ...S.input, maxWidth: 200 }}
                  value={editing[key] !== undefined ? editing[key] : (settings[key] || '')}
                  onChange={e => setEditing({ ...editing, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {Object.keys(editing).length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn(S.green)} onClick={save}>Kaydet</button>
          <button style={S.btn('#374151')} onClick={() => setEditing({})}>Vazgeç</button>
        </div>
      )}
    </div>
  );
}

// ==================== MAIN APP ====================
const TABS = [
  { id: 'dashboard', label: 'Genel Bakış', component: DashboardTab },
  { id: 'market', label: 'Piyasa', component: MarketTab },
  { id: 'grid', label: 'Grid Trading', component: GridTab },
  { id: 'dca', label: 'DCA', component: DCATab },
  { id: 'ta', label: 'Teknik Analiz', component: TATab },
  { id: 'arbitrage', label: 'Arbitraj', component: ArbitrageTab },
  { id: 'futures', label: 'Futures $100', component: FuturesTab },
  { id: 'portfolio', label: 'Portföy', component: PortfolioTab },
  { id: 'trades', label: 'İşlemler', component: TradesTab },
  { id: 'settings', label: 'Ayarlar', component: SettingsTab },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { data: status, refetch: refetchStatus } = useAPI('/status', 15000);
  const wsMessage = useWebSocket();
  const [balance, setBalance] = useState(100);
  const [demoToggling, setDemoToggling] = useState(false);

  const isDemo = status?.demo?.forceDemo || status?.demo?.globalDemo;

  useEffect(() => {
    fetch(`${API}/dashboard`).then(r => r.json()).then(d => {
      if (d?.balance?.total) setBalance(d.balance.total);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (wsMessage?.type === 'market_update') {
      // Canlı güncelleme
    }
  }, [wsMessage]);

  const toggleDemo = async () => {
    setDemoToggling(true);
    try {
      await apiPost('/demo/toggle', { enabled: !isDemo });
      refetchStatus();
    } catch (err) {
      console.error('Demo toggle hatası:', err);
    } finally {
      setDemoToggling(false);
    }
  };

  const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || DashboardTab;

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={S.logo}>CRYPTOFORGE</div>
          <Badge text={status?.status === 'running' ? 'ONLINE' : 'OFFLINE'} color={status?.status === 'running' ? S.green : S.red} />
          {status?.botLocked && <Badge text="KİLİTLİ" color={S.red} />}
          <button
            onClick={toggleDemo}
            disabled={demoToggling}
            style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: demoToggling ? 'wait' : 'pointer',
              fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
              background: isDemo ? '#F59E0B22' : '#10B98122',
              color: isDemo ? '#F59E0B' : '#10B981',
              transition: 'all 0.2s',
              opacity: demoToggling ? 0.5 : 1,
            }}
          >
            {demoToggling ? '...' : isDemo ? 'DEMO MOD' : 'CANLI MOD'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 12, color: '#8B8B9A' }}>
            Borsalar: {(status?.exchanges || []).map(e => (
              <Badge key={e} text={e} color={S.purple} />
            ))}
          </div>
          <div style={S.balBadge}>${balance.toFixed(2)}</div>
        </div>
      </div>

      {/* Navigation */}
      <div style={S.nav}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            style={S.navBtn(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.main}>
        <ActiveComponent />
      </div>
    </div>
  );
}
