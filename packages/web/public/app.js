/* Stock Survival — 바닐라 JS 웹 클라이언트 (프레임워크 금지) */

const state = {
  characterId: null,
  username: null,
  companies: [],
  selectedCompanyId: null,
  companyDetail: null,
  world: null,
  character: null,
  portfolio: null,
  orders: [],
  news: [],
  gameOver: false,
};

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

const START_HINTS = {
  quotes: 'Arrows show why a price moved. No numbers — figure it out.',
  news: 'A shock hits one sector first, then spreads. Watch the delay.',
  survival: 'Eat or you die. Food price follows CPI.',
  orders: 'Stop-loss is sell-only. It protects you while you sleep.',
};

function showStartScreen() {
  $('#start-screen').style.display = 'flex';
  document.querySelector('.tabs').style.display = 'none';
  document.querySelector('main').style.display = 'none';
  $('#status-bar').style.display = 'none';
  const input = $('#start-nickname');
  input.value = localStorage.getItem('username') || '';
  input.focus();
}

function hideStartScreen() {
  $('#start-screen').style.display = 'none';
  document.querySelector('.tabs').style.display = '';
  document.querySelector('main').style.display = '';
  $('#status-bar').style.display = '';
}

async function handleStart() {
  const username = $('#start-nickname').value.trim();
  if (!username) {
    toast('Enter a nickname to start.');
    return;
  }
  localStorage.setItem('username', username);
  state.username = username;
  try {
    const user = await api('/users', { method: 'POST', body: { username } });
    const res = await api('/characters', {
      method: 'POST',
      body: { userId: user.userId, name: username },
    });
    localStorage.setItem('characterId', res.character.id);
    state.characterId = res.character.id;
    hideStartScreen();
    await startGame();
  } catch (err) {
    toast(err.message);
  }
}

async function startGame() {
  try {
    connectWs();
    state.companies = await api('/companies');
    state.news = await api('/news');
    state.world = await api('/world');
    await loadCharacter();
    if (isDead()) {
      await renderGameOver();
      return;
    }
    renderStatusBar();
    renderQuotes();
    renderNews();
    renderSurvival();
    renderOrders();
    renderRanking();
    showTabHint('quotes');
  } catch (err) {
    toast(err.message);
  }
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (state.gameOver) return;
    if (msg.type === 'company_prices') {
      const payload = msg.payload || [];
      const byId = new Map(payload.map((c) => [c.id, c]));
      state.companies = state.companies.map((c) => {
        const next = byId.get(c.id);
        if (!next) return c;
        return {
          ...c,
          currentPrice: next.price,
          status: next.status,
          factors: next.factors,
        };
      });
      renderQuotes();
    } else if (msg.type === 'news') {
      state.news.unshift(msg.payload || {});
      if (state.news.length > 50) state.news.length = 50;
      renderNews();
    } else if (msg.type === 'world_state') {
      state.world = msg.payload;
      renderStatusBar();
      renderSurvival();
      renderOrders();
    }
  };
}

async function loadCharacter() {
  const [character, portfolio, orders] = await Promise.all([
    api(`/characters/${state.characterId}`),
    api(`/characters/${state.characterId}/portfolio`),
    api(`/characters/${state.characterId}/orders`),
  ]);
  state.character = character;
  state.portfolio = portfolio;
  state.orders = orders.orders || [];
}

async function refreshSurvivalAndOrders() {
  await loadCharacter();
  if (isDead()) {
    await renderGameOver();
    return;
  }
  renderStatusBar();
  renderSurvival();
  renderOrders();
}

// ---------- 결과 화면 ----------
function isDead() {
  return Boolean(
    state.character &&
      state.character.character &&
      state.character.character.isAlive === false
  );
}

async function renderGameOver() {
  if (state.gameOver) return;
  state.gameOver = true;

  const c = state.character.character;
  const causeLabel =
    { starvation: 'Starvation', exposure: 'Exposure', season_end: 'Season ended' }[c.deathCause] ||
    (c.deathCause ? c.deathCause : '—');

  let rank = null;
  try {
    const ranking = await api(`/ranking?characterId=${state.characterId}`);
    rank = ranking.myRank;
  } catch (err) {
    rank = null;
  }

  document.querySelector('.tabs').style.display = 'none';
  document.querySelector('.onboarding').textContent = 'Your character has died.';
  document.querySelector('main').innerHTML = `
    <div class="card">
      <h2>Game Over</h2>
      <p>Cause of death: <strong>${esc(causeLabel)}</strong></p>
      <p>Days survived: <strong>${c.survivedGameDays}</strong></p>
      <p>Peak net worth: <strong>${fmt(c.peakNetWorth)}</strong></p>
      <p>Final net worth: <strong>${fmt(state.character.netWorth)}</strong></p>
      <p>Final rank: <strong>${rank ? rank : '—'}</strong></p>
      <button id="btn-restart">Restart</button>
    </div>
  `;
  $('#btn-restart').addEventListener('click', restartGame);
}

async function restartGame() {
  try {
    localStorage.removeItem('characterId');
    const user = await api('/users', { method: 'POST', body: { username: state.username } });
    const res = await api('/characters', {
      method: 'POST',
      body: { userId: user.userId, name: state.username },
    });
    localStorage.setItem('characterId', res.character.id);
    location.reload();
  } catch (err) {
    toast(err.message);
  }
}

async function checkDeath() {
  if (state.gameOver || !state.characterId) return;
  try {
    await loadCharacter();
  } catch (err) {
    return;
  }
  if (isDead()) await renderGameOver();
}

// ---------- 시세 ----------
async function selectCompany(id) {
  state.selectedCompanyId = id;
  state.companyDetail = await api(`/companies/${id}`);
  renderCompanyDetail();
}

function sparkline(values) {
  if (!values || values.length < 2) return '<span class="empty">—</span>';
  const data = values.slice(-20);
  const first = data[0];
  const last = data[data.length - 1];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const bars = data
    .map((v) => {
      const pct = range > 0 ? Math.round(((v - min) / range) * 100) : 50;
      return `<div class="spark-bar" style="height:${Math.max(pct, 6)}%"></div>`;
    })
    .join('');
  const cls = last < first ? 'spark-bad' : 'spark-good';
  return `<div class="sparkline ${cls}" aria-hidden="true">${bars}</div>`;
}

function renderFactors(factors) {
  return (factors || [])
    .map((f) => {
      const cls = f.direction === '▲' ? 'good' : f.direction === '▼' ? 'bad' : 'flat';
      return `<span class="factor">${esc(f.name)}<span class="dir-${cls}">${f.direction}</span></span>`;
    })
    .join(' ');
}

function renderCompanyDetail() {
  const el = $('#company-detail');
  if (!state.companyDetail) {
    el.innerHTML = '';
    return;
  }
  const d = state.companyDetail;
  const c = d.company;
  el.innerHTML = `
    <div class="card">
      <h3>${esc(c.name)}</h3>
      <p>Current price: <strong>${fmt(c.currentPrice)}</strong></p>
      <p>Factors: ${renderFactors(d.priceFactors) || '—'}</p>
      <div class="history-block">
        <p class="history-label">Price history (past → recent)</p>
        ${sparkline(d.priceHistory)}
      </div>
    </div>
  `;
}

function renderQuotes() {
  const el = $('#tab-quotes');
  const list = state.companies.map((c) => {
    const sel = c.id === state.selectedCompanyId ? ' selected' : '';
    const factors = renderFactors(c.factors);
    return `<button class="company-row${sel}" data-company="${esc(c.id)}">
      <span class="cname">${esc(c.name)}</span>
      <span class="cprice">${fmt(c.currentPrice)}</span>
      <span class="cstatus">${esc(c.status)}</span>
      <span class="cfactors">${factors}</span>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="company-list">${list}</div><div id="company-detail"></div>`;
  el.querySelectorAll('.company-row').forEach((btn) => {
    btn.addEventListener('click', () => selectCompany(btn.dataset.company));
  });
  renderCompanyDetail();
}

// ---------- 뉴스 ----------
function renderNews() {
  const el = $('#tab-news');
  const items = state.news.map((n) => {
    const time = n.createdAt ? new Date(n.createdAt).toLocaleTimeString('en-US') : '';
    return `<li>
      <div class="news-title">${esc(n.title)}</div>
      <div class="news-body">${esc(n.body || '')}</div>
      <div class="news-meta">${esc(time)}</div>
    </li>`;
  }).join('');
  el.innerHTML = `<ul class="news-list">${items || '<li class="empty">No news</li>'}</ul>`;
}

// ---------- 랭킹 ----------
async function renderRanking() {
  const el = $('#tab-ranking');
  if (!el) return;
  try {
    const ranking = await api(`/ranking?characterId=${state.characterId}`);
    const top20 = (ranking.board || []).slice(0, 20);
    const rows = top20
      .map((row) => {
        const mine = row.characterId === state.characterId ? ' ranking-mine' : '';
        return `<li class="ranking-row${mine}">
          <span class="rank-num">${row.rank}</span>
          <span class="rank-name">${esc(row.name)}</span>
          <span class="rank-nw">${fmt(row.netWorth)}</span>
        </li>`;
      })
      .join('');
    const meLine =
      ranking.myRank !== null && ranking.myRank !== undefined
        ? `<div class="ranking-me">Your rank: <strong>${ranking.myRank}</strong> / ${ranking.total} · net worth ${fmt(ranking.myNetWorth)}</div>`
        : '';
    el.innerHTML = `
      <div class="card">
        <h3>Season ranking — top 20</h3>
        ${meLine}
        <ol class="ranking-list">${rows || '<li class="empty">No players yet</li>'}</ol>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="empty">Ranking unavailable: ${esc(err.message)}</p></div>`;
  }
}

// ---------- 생존 ----------
function renderSurvival() {
  const el = $('#tab-survival');
  if (!state.character || !state.portfolio) {
    el.innerHTML = '<p class="empty">Loading…</p>';
    return;
  }
  const c = state.character.character;
  const job = state.character.job;
  const cpi = state.world ? state.world.macro.cpiIndex : null;
  const jobLabel = job ? (job.kind === 'regular' ? 'Full-time' : 'Part-time') : 'Unemployed';
  el.innerHTML = `
    <div class="card">
      <p><strong>${esc(c.name)}</strong> (${c.isAlive ? 'Alive' : 'Dead'})</p>
      <p>Health: ${c.health}</p>
      <p>Cash: ${fmt(state.character.balance)}</p>
      <p>Stock value: ${fmt(state.portfolio.stockValue)}</p>
      <p>Net worth: ${fmt(state.portfolio.netWorth)}</p>
      <p>Job: ${jobLabel}</p>
      <p>Prices (CPI): ${fmt(cpi)}</p>
    </div>
    <div class="card actions">
      <button id="btn-eat">Eat</button>
      <button id="btn-rest">Rest</button>
      <button id="btn-job-regular">Full-time job</button>
      <button id="btn-job-parttime">Part-time</button>
      <button id="btn-job-quit">Quit</button>
    </div>
  `;
  $('#btn-eat').addEventListener('click', async () => {
    try {
      await api('/survival/eat', { method: 'POST', body: { characterId: state.characterId } });
      toast('You ate.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
  $('#btn-rest').addEventListener('click', async () => {
    try {
      await api('/survival/rest', { method: 'POST', body: { characterId: state.characterId } });
      toast('You rested.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
  $('#btn-job-regular').addEventListener('click', async () => {
    try {
      await api('/jobs', { method: 'POST', body: { characterId: state.characterId, kind: 'regular' } });
      toast('You got a full-time job.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
  $('#btn-job-parttime').addEventListener('click', async () => {
    try {
      await api('/jobs', { method: 'POST', body: { characterId: state.characterId, kind: 'parttime' } });
      toast('You started a part-time job.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
  $('#btn-job-quit').addEventListener('click', async () => {
    try {
      await api('/jobs', { method: 'DELETE', body: { characterId: state.characterId } });
      toast('You quit your job.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
}

// ---------- 주문 ----------
function renderOrders() {
  const el = $('#tab-orders');
  const open = state.world ? (state.world.market.open ? 'Open' : 'Closed') : '—';
  const holdings = (state.portfolio ? state.portfolio.entries : []).map((e) =>
    `<li>${esc(e.companyName)} — ${e.shares} × ${fmt(e.currentPrice)} = ${fmt(e.value)}</li>`
  ).join('');
  const orders = (state.orders || []).map((o) =>
    `<li>
      ${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type === 'stop' ? 'Stop' : 'Limit'}
      ${esc(o.companyId)} ${o.quantity} @ ${fmt(o.price)}
      <button class="cancel-order" data-id="${esc(o.id)}">Cancel</button>
    </li>`
  ).join('');
  const options = state.companies.map((c) =>
    `<option value="${esc(c.id)}">${esc(c.name)}</option>`
  ).join('');
  el.innerHTML = `
    <p>Market: <strong>${open}</strong></p>
    <div class="card">
      <h3>Holdings</h3>
      <ul>${holdings || '<li class="empty">No holdings</li>'}</ul>
    </div>
    <div class="card">
      <h3>My orders</h3>
      <ul>${orders || '<li class="empty">No orders</li>'}</ul>
    </div>
    <div class="card">
      <h3>New order</h3>
      <div class="order-form">
        <select id="order-company">${options}</select>
        <select id="order-side">
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <select id="order-type" class="full">
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop (sell only)</option>
        </select>
        <input id="order-qty" type="number" min="1" placeholder="Quantity" />
        <input id="order-price" type="number" min="0" step="any" placeholder="Price (limit/stop only)" />
        <button id="btn-place" class="full">Place order</button>
      </div>
    </div>
  `;
  el.querySelectorAll('.cancel-order').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/orders/${btn.dataset.id}`, {
          method: 'DELETE',
          body: { characterId: state.characterId },
        });
        toast('Order cancelled.');
        await refreshSurvivalAndOrders();
      } catch (err) { toast(err.message); }
    });
  });
  $('#btn-place').addEventListener('click', async () => {
    try {
      const companyId = $('#order-company').value;
      const side = $('#order-side').value;
      const type = $('#order-type').value;
      const quantity = parseInt($('#order-qty').value, 10);
      const priceRaw = $('#order-price').value;
      if (!quantity || quantity <= 0) throw new Error('Enter a quantity');

      const body = { characterId: state.characterId, companyId, side, quantity };
      if (type === 'limit') {
        if (!priceRaw) throw new Error('Enter a limit price');
        body.orderType = 'limit';
        body.limitPrice = Number(priceRaw);
      } else if (type === 'stop') {
        if (side !== 'sell') throw new Error('Stop-loss is sell-only');
        if (!priceRaw) throw new Error('Enter a trigger price');
        body.orderType = 'stop';
        body.limitPrice = Number(priceRaw);
      }
      await api('/trade', { method: 'POST', body });
      toast('Order placed.');
      await refreshSurvivalAndOrders();
    } catch (err) { toast(err.message); }
  });
}

function renderStatusBar() {
  const el = $('#status-bar');
  if (!el) return;
  const gt = state.world ? state.world.gameTime : null;
  const date = gt
    ? `${gt.year}-${String(gt.month).padStart(2, '0')}-${String(gt.day).padStart(2, '0')}`
    : '—';
  const market = state.world ? (state.world.market.open ? 'Open' : 'Closed') : '—';
  const cash = state.character ? state.character.balance : null;
  const netWorth = state.portfolio ? state.portfolio.netWorth : null;
  el.innerHTML = `
    <span>Day <strong>${esc(date)}</strong></span>
    <span>Market <strong>${market}</strong></span>
    <span>Cash <strong>${fmt(cash)}</strong></span>
    <span>Net worth <strong>${fmt(netWorth)}</strong></span>
  `;
}

function showTabHint(tab) {
  const key = 'hint_seen_' + tab;
  if (localStorage.getItem(key)) return;
  const hint = START_HINTS[tab];
  if (!hint) return;
  const panel = $('#tab-' + tab);
  if (!panel || panel.querySelector('.tab-hint')) return;

  const div = document.createElement('div');
  div.className = 'tab-hint';
  const label = document.createElement('span');
  label.textContent = hint;
  const close = document.createElement('button');
  close.className = 'hint-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss hint');
  close.textContent = '×';
  close.addEventListener('click', () => {
    localStorage.setItem(key, '1');
    div.remove();
  });
  div.appendChild(label);
  div.appendChild(close);
  panel.prepend(div);
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
      showTabHint(btn.dataset.tab);
    });
  });
}

async function init() {
  bindTabs();
  $('#btn-start').addEventListener('click', handleStart);
  setInterval(checkDeath, 10000);
  setInterval(renderRanking, 30000);

  const characterId = localStorage.getItem('characterId');
  if (!characterId) {
    showStartScreen();
    return;
  }
  state.characterId = characterId;
  state.username = localStorage.getItem('username');
  await startGame();
}

init();



