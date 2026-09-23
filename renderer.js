/* ===== 房产智能选房系统 · 渲染逻辑 ===== */
(function () {
  const D = window.__DATA__;
  const MST = D.MASTER, L = D.LISTINGS, CITIES = D.CITY_LIST, CTIERS = D.CITY_TIERS,
        STYLES = D.STYLE_LIST, PRODUCTS = D.PRODUCT_LIST, LOCS = D.LOC_LIST,
        FEEB = D.FEE_BANDS, VTS = D.VIEW_TIER_LIST, PBE = D.PRICE_BANDS,
        MIDX = D.MASTER_IDX, BLS = D.BAND_LABELS;

  /* ---------- 工具 ---------- */
  const $ = id => document.getElementById(id);
  let toastTimer = null;
  function toast(msg, err = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 2600);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtW = w => w >= 10000 ? (w / 10000).toFixed(2) + '亿' : w.toLocaleString() + '万';
  const fmtU = u => u >= 10000 ? (u / 10000).toFixed(1) + '万' : String(u);
  const bandClass = b => 'band-' + b;
  function buyCost(total) {
    const deed = total * (total < 300 ? 0.01 : total < 1000 ? 0.015 : 0.03);
    const agent = total * 0.02;
    return { deed, agent, sum: deed + agent };
  }
  function rentYield(x) {
    return (0.008 + x.life / 10 * 0.006 + (x.band >= 3 ? 0.002 : 0) + x.trans / 10 * 0.002) / (x.total / 10000);
  }
  function mortgage(total) {
    const down = total * 0.3;
    const loan = total - down;
    const r = 0.030 / 12, n = 360;
    const monthly = loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    return { down, loan, monthly };
  }

  let medianCache = null;
  function buildMedian() {
    const map = {};
    L.forEach(x => { const k = x.city + '|' + x.band; (map[k] = map[k] || []).push(x.unitPrice); });
    medianCache = {};
    Object.keys(map).forEach(k => {
      const arr = map[k].sort((a, b) => a - b);
      const mid = Math.floor(arr.length / 2);
      medianCache[k] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });
  }
  function valueIdx(x) {
    const med = medianCache[x.city + '|' + x.band];
    if (!med) return 60;
    return Math.max(40, Math.min(100, 100 - (x.unitPrice - med) / med * 60));
  }

  /* ---------- DeepSeek 调用（桌面桥接 / 浏览器直连） ---------- */
  async function deepseekChat(apiKey, messages) {
    if (window.deepseekBridge) {
      return await window.deepseekBridge.chat({ apiKey, messages });
    }
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 2500, stream: false })
    });
    const j = await resp.json();
    if (j.choices && j.choices[0]) return j.choices[0].message.content;
    throw new Error(j.error ? j.error.message : 'DeepSeek 返回异常');
  }

  /* ---------- 视图切换 ---------- */
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      $('view-' + b.dataset.view).classList.add('active');
    });
  });

  /* ---------- 浏览状态 ---------- */
  const state = {
    cities: new Set(), price: new Set(), products: new Set(), styles: new Set(),
    locs: new Set(), fees: new Set(), views: new Set(), ages: new Set(),
    search: '', sort: 'smart', page: 1, perPage: 30
  };
  let filtered = L;

  function applyFilter() {
    const kw = state.search.trim().toLowerCase();
    filtered = L.filter(x => {
      if (state.cities.size && !state.cities.has(x.city)) return false;
      if (state.price.size && !priceHit(x.total, state.price)) return false;
      if (state.products.size && !prodHit(x.house, state.products)) return false;
      if (state.styles.size && !x.styles.some(s => state.styles.has(s))) return false;
      if (state.locs.size && !state.locs.has(String(x.band))) return false;
      if (state.fees.size && !feeHit(x.fee, state.fees)) return false;
      if (state.views.size && !state.views.has(x.viewCode)) return false;
      if (state.ages.size && !ageHit(x.age, state.ages)) return false;
      if (kw) {
        const hay = (x.name + ' ' + x.city + ' ' + x.district + ' ' + x.metro + ' ' + x.house + ' ' + x.styles.join('')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    state.page = 1;
    renderBrowse();
  }
  function priceHit(t, set) {
    for (const b of set) {
      if (b === 'lt50' && t < 50) return true;
      if (b === 'gt1e' && t > 10000) return true;
      const m = b.match(/^(\d+)-(\d+)$/);
      if (m && t >= +m[1] && t < +m[2]) return true;
    }
    return false;
  }
  function prodHit(house, set) {
    for (const p of set) {
      const n = house.match(/^(\d)室/);
      if (n && p === PRODUCTS[Math.min(n[1] - 1, 5)]) return true;
      if (p === '6室+' && n && +n[1] >= 6) return true;
    }
    return false;
  }
  function feeHit(fee, set) {
    for (const f of set) {
      if (f === 'lt3' && fee < 3) return true;
      if (f === '3-6' && fee >= 3 && fee < 6) return true;
      if (f === '6-10' && fee >= 6 && fee < 10) return true;
      if (f === 'gt10' && fee >= 10) return true;
    }
    return false;
  }
  function ageHit(age, set) {
    for (const a of set) {
      if (a === 'lt5' && age <= 5) return true;
      if (a === '5-10' && age > 5 && age <= 10) return true;
      if (a === '10-20' && age > 10 && age <= 20) return true;
      if (a === 'gt20' && age > 20) return true;
    }
    return false;
  }

  /* ---------- 综合评分（浏览用） ---------- */
  function smartScore(x) {
    const loc = x.loc * 10, trans = x.trans * 10 + (x.metroOn ? 8 : 0),
          prop = Math.min(100, 55 + x.fee * 2.5 + (x.band >= 3 ? 10 : 0)),
          age = Math.max(50, 100 - x.age * 2.2),
          school = x.school * 10, life = x.life * 10, band = x.band * 22;
    return Math.round((loc * 0.18 + trans * 0.14 + prop * 0.12 + age * 0.10 + school * 0.10 + life * 0.10 + band * 0.14 + Math.min(100, 30 + x.greening * 100) * 0.12));
  }

  function sortList(arr) {
    const s = state.sort;
    if (s === 'priceAsc') return [...arr].sort((a, b) => a.total - b.total);
    if (s === 'priceDesc') return [...arr].sort((a, b) => b.total - a.total);
    if (s === 'areaDesc') return [...arr].sort((a, b) => b.area - a.area);
    if (s === 'scoreDesc') return [...arr].sort((a, b) => smartScore(b) - smartScore(a));
    return [...arr].sort((a, b) => smartScore(b) - smartScore(a));
  }

  /* ---------- 渲染卡片 ---------- */
  function cardHTML(x) {
    const sc = smartScore(x);
    return `<div class="card" data-id="${x.id}">
      <div class="card-top">
        <div><div class="card-name">${esc(x.name)}</div>
        <div class="card-sub">${esc(x.city)} · ${esc(x.district)} · ${esc(x.type)} · ${esc(x.house)}</div></div>
        <span class="band-tag ${bandClass(x.band)}">${esc(x.bandLabel)}</span>
      </div>
      <div class="card-price"><span class="price-main">${fmtW(x.total)}</span><span class="price-sub">${fmtU(x.unitPrice)}元/㎡</span></div>
      <div class="card-tags">
        <span class="mini-tag">${esc(x.floor)}</span><span class="mini-tag">${esc(x.view)}</span><span class="mini-tag">${esc(x.bldgNo)}</span>
        <span class="mini-tag">${esc(x.deco)}</span><span class="mini-tag">${x.age}年楼龄</span>
        ${x.metroOn ? '<span class="mini-tag">' + esc(x.metro) + '</span>' : '<span class="mini-tag">无地铁</span>'}
        <span class="mini-tag">月供约${fmtW(mortgage(x.total).monthly)}/月</span>
      </div>
      <div class="card-meta">
        <span>物业 ${x.fee}元/㎡·月</span><span>学区 ${x.school}/10</span><span>生活 ${x.life}/10</span>
        <span>${esc(x.styles.join(' · '))}</span>
      </div>
      <div class="card-score"><span class="score-num">${sc}</span><div class="score-bar"><div class="score-fill" style="width:${sc}%"></div></div></div>
    </div>`;
  }

  function renderBrowse() {
    const sorted = sortList(filtered);
    const totalPages = Math.max(1, Math.ceil(sorted.length / state.perPage));
    state.page = Math.min(state.page, totalPages);
    const pageItems = sorted.slice((state.page - 1) * state.perPage, state.page * state.perPage);
    $('browseBody').innerHTML = pageItems.length
      ? pageItems.map(cardHTML).join('')
      : `<div class="empty-state">没有符合条件的房源，试试放宽筛选条件</div>`;
    $('resultCount').textContent = sorted.length.toLocaleString();
    $('pageInfo').textContent = state.page + ' / ' + totalPages;
    $('prevPage').disabled = state.page <= 1;
    $('nextPage').disabled = state.page >= totalPages;
    $('browseBody').dataset.total = sorted.length;
  }

  $('browseBody').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) openDetail(+card.dataset.id);
  });
  $('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; renderBrowse(); } });
  $('nextPage').addEventListener('click', () => { if (state.page < Math.ceil(filtered.length / state.perPage)) { state.page++; renderBrowse(); } });
  $('searchInput').addEventListener('input', e => { state.search = e.target.value; applyFilter(); });
  $('sortSelect').addEventListener('change', e => { state.sort = e.target.value; renderBrowse(); });

  /* ---------- 价格段快捷栏 ---------- */
  (function buildPriceRail() {
    $('priceRail').innerHTML = PBE.map(b =>
      `<span class="chip" data-p="${b[0]}">${b[1]}</span>`).join('');
    $('priceRail').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const p = c.dataset.p;
      if (state.price.has(p)) { state.price.delete(p); c.classList.remove('on'); }
      else { state.price.add(p); c.classList.add('on'); }
      applyFilter();
    });
  })();

  /* ---------- 筛选抽屉 ---------- */
  function initSheet() {
    const mk = (id, list) => {
      $(id).innerHTML = list.map(([v, label]) =>
        `<span class="chip" data-v="${v}">${esc(label)}</span>`).join('');
    };
    mk('fCity', CITIES.map(c => [c, c]));
    mk('fPrice', PBE);
    mk('fProduct', PRODUCTS.map(p => [p, p]));
    mk('fStyle', STYLES.map(s => [s, s]));
    mk('fLoc', LOCS);
    mk('fFee', FEEB);
    mk('fViewTier', VTS);
    mk('fAge', [['lt5','5年内'],['5-10','5-10年'],['10-20','10-20年'],['gt20','20年以上']]);
    const bind = (key, list, elId, filterSet) => {
      $(elId).addEventListener('click', e => {
        const c = e.target.closest('.chip');
        if (!c) return;
        const v = c.dataset.v;
        if (filterSet.has(v)) { filterSet.delete(v); c.classList.remove('on'); }
        else { filterSet.add(v); c.classList.add('on'); }
      });
    };
    bind('city', CITIES, 'fCity', state.cities);
    bind('price', PBE, 'fPrice', state.price);
    bind('product', PRODUCTS, 'fProduct', state.products);
    bind('style', STYLES, 'fStyle', state.styles);
    bind('loc', LOCS, 'fLoc', state.locs);
    bind('fee', FEEB, 'fFee', state.fees);
    bind('view', VTS, 'fViewTier', state.views);
    bind('age', [['lt5','5年内'],['5-10','5-10年'],['10-20','10-20年'],['gt20','20年以上']], 'fAge', state.ages);
  }
  $('openSheet').addEventListener('click', () => { $('sheet').classList.add('open'); $('sheetMask').style.display = 'block'; });
  $('sheetMask').addEventListener('click', () => { $('sheet').classList.remove('open'); $('sheetMask').style.display = 'none'; });
  $('applyFilter').addEventListener('click', () => {
    $('sheet').classList.remove('open'); $('sheetMask').style.display = 'none';
    applyFilter();
  });
  $('resetFilter').addEventListener('click', () => {
    Object.values([state.cities, state.price, state.products, state.styles, state.locs, state.fees, state.views, state.ages]).forEach(s => s.clear());
    document.querySelectorAll('#sheet .chip').forEach(c => c.classList.remove('on'));
    state.search = ''; $('searchInput').value = '';
    applyFilter();
    $('sheet').classList.remove('open'); $('sheetMask').style.display = 'none';
  });

  /* ---------- 详情弹层 ---------- */
  let curId = null;
  function openDetail(id) {
    curId = id;
    const x = L[id];
    const m = MIDX[x.mid];
    const sameCount = L.filter(y => y.mid === x.mid).length;
    $('detailBody').innerHTML = `
      <div class="detail-title">${esc(x.name)}</div>
      <div class="detail-sub">${esc(x.city)} · ${esc(x.tier)} · ${esc(x.district)} · <span class="band-tag ${bandClass(x.band)}">${esc(x.bandLabel)}</span></div>
      <div class="detail-tabs">
        <button class="dtab on" data-tab="info">房源详情</button>
        <button class="dtab" data-tab="same">同盘房源对比（${sameCount}）</button>
      </div>
      <div id="tabInfo" class="tab-pane">
      <div class="detail-kv">
        <div><div class="k">总价</div><div class="v">${fmtW(x.total)}</div></div>
        <div><div class="k">房源号</div><div class="v">${esc(x.bldgNo)}</div></div>
        <div><div class="k">首付(30%)</div><div class="v">${fmtW(mortgage(x.total).down)}</div></div>
        <div><div class="k">月供(30年·3%)</div><div class="v">${fmtW(mortgage(x.total).monthly)}/月</div></div>
        <div><div class="k">购房税费</div><div class="v">契税${fmtW(buyCost(x.total).deed)}+中介${fmtW(buyCost(x.total).agent)}≈${fmtW(buyCost(x.total).sum)}</div></div>
        <div><div class="k">单价</div><div class="v">${fmtU(x.unitPrice)}元/㎡</div></div>
        <div><div class="k">户型</div><div class="v">${esc(x.house)} · ${x.area}㎡</div></div>
        <div><div class="k">楼层</div><div class="v">${esc(x.floor)}</div></div>
        <div><div class="k">景观</div><div class="v">${esc(x.view)}</div></div>
        <div><div class="k">装修</div><div class="v">${esc(x.deco)}</div></div>
        <div><div class="k">楼龄</div><div class="v">${x.age}年（${x.year}年建）</div></div>
        <div><div class="k">物业费</div><div class="v">${x.fee}元/㎡·月</div></div>
        <div><div class="k">地铁</div><div class="v">${x.metroOn ? esc(x.metro) : '无地铁'}</div></div>
        <div><div class="k">学区</div><div class="v">${x.school}/10</div></div>
        <div><div class="k">生活配套</div><div class="v">${x.life}/10</div></div>
        <div><div class="k">绿化率/容积率</div><div class="v">${(x.greening * 100).toFixed(0)}% / ${x.plot}</div></div>
      </div>
      <div class="detail-note"><b>楼盘简介：</b>${esc(x.note)}</div>
      <div class="detail-note"><b>风格：</b>${x.styles.map(esc).join('、')} ｜ <b>地段：</b>${x.loc}/10 ｜ <b>交通：</b>${x.trans}/10</div>
      </div>
      <div id="tabSame" class="tab-pane" style="display:none"></div>`;
    $('detail').classList.add('open');
    $('detailMask').style.display = 'block';
    bindDetailTabs();
  }
  function bindDetailTabs() {
    $('detailBody').querySelectorAll('.dtab').forEach(b => {
      b.addEventListener('click', () => {
        $('detailBody').querySelectorAll('.dtab').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        const isSame = b.dataset.tab === 'same';
        $('tabInfo').style.display = isSame ? 'none' : 'block';
        $('tabSame').style.display = isSame ? 'block' : 'none';
        if (isSame && curId != null) renderSameTab(L[curId].mid);
      });
    });
  }
  function renderSameTab(mid) {
    const same = L.filter(x => x.mid === mid);
    const rows = same.map(x => {
      const sc = smartScore(x);
      return `<tr data-id="${x.id}"><td>${esc(x.bldgNo)}</td><td>${esc(x.house)}</td><td>${esc(x.floor)}</td><td>${esc(x.view)}</td><td>${esc(x.deco)}</td><td>${x.area}㎡</td><td>${fmtU(x.unitPrice)}</td><td>${fmtW(x.total)}</td><td>${sc}</td></tr>`;
    }).join('');
    $('tabSame').innerHTML = `<div class="same-hint">同盘全部 ${same.length} 套房源 · 点击任意一行查看该房源详情</div>
      <div class="table-wrap"><table class="cmp-table same-table"><thead><tr><th>房源号</th><th>户型</th><th>楼层</th><th>景观</th><th>装修</th><th>面积</th><th>单价</th><th>总价</th><th>评分</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  $('detailBody').addEventListener('click', e => {
    const row = e.target.closest('.same-table tbody tr');
    if (row) openDetail(+row.dataset.id);
  });
  $('detailClose').addEventListener('click', closeDetail);
  $('detailMask').addEventListener('click', closeDetail);
  function closeDetail() { $('detail').classList.remove('open'); $('detailMask').style.display = 'none'; }

  /* ---------- 对比评估 ---------- */
  const cmpSet = [];
  function renderCmpList() {
    const wrap = $('cmpList');
    if (!cmpSet.length) {
      wrap.innerHTML = `<div class="cmp-slot">在搜索框添加楼盘进行对比（1-4个）</div>`;
      return;
    }
    wrap.innerHTML = cmpSet.map(x => `
      <div class="cmp-slot filled" data-cmp="${x.id}">
        <span class="slot-x" data-x="${x.id}">×</span>
        <div style="font-weight:700;color:var(--ink)">${esc(x.name)}</div>
        <div style="font-size:12px;color:var(--ink-2);margin-top:4px">${esc(x.city)} · ${esc(x.house)} · ${fmtW(x.total)}</div>
        <div style="font-size:12px;color:var(--warn);margin-top:4px;font-weight:700">${fmtU(x.unitPrice)}元/㎡</div>
      </div>`).join('');
  }
  $('cmpSearch').addEventListener('input', debounceSearch);
  let cmpTimer;
  function debounceSearch(e) {
    clearTimeout(cmpTimer);
    cmpTimer = setTimeout(() => {
      const kw = e.target.value.trim().toLowerCase();
      if (!kw) return;
      const hits = L.filter(x => (x.name + x.city + x.district).toLowerCase().indexOf(kw) >= 0)
        .filter(x => !cmpSet.find(c => c.id === x.id)).slice(0, 8);
      if (!hits.length) { toast('没有匹配楼盘', true); return; }
      const first = hits[0];
      if (cmpSet.length >= 4) { toast('最多对比 4 个楼盘', true); return; }
      cmpSet.push(first);
      renderCmpList();
      renderCompare();
      e.target.value = '';
      toast('已添加「' + first.name + '」');
    }, 300);
  }
  $('cmpList').addEventListener('click', e => {
    const x = e.target.closest('.slot-x');
    if (x) {
      const id = +x.dataset.x;
      const i = cmpSet.findIndex(c => c.id === id);
      if (i >= 0) { cmpSet.splice(i, 1); renderCmpList(); renderCompare(); }
    }
  });
  $('cmpClear').addEventListener('click', () => { cmpSet.length = 0; renderCmpList(); renderCompare(); });

  const CMP_DIMS = [
    ['总价', x => x.total, w => fmtW(w), 'low'],
    ['单价', x => x.unitPrice, w => fmtU(w) + '元/㎡', 'low'],
    ['月供', x => mortgage(x.total).monthly, w => fmtW(w) + '/月', 'low'],
    ['面积', x => x.area, w => w + '㎡', 'high'],
    ['地段', x => x.loc * 10, w => w + '/100', 'high'],
    ['交通', x => x.trans * 10 + (x.metroOn ? 10 : 0), w => w + '/100', 'high'],
    ['通勤', x => x.metroOn ? 100 : 55, w => w + '/100', 'high'],
    ['物业费', x => x.fee, w => w + '元', 'low'],
    ['学区', x => x.school * 10, w => w + '/100', 'high'],
    ['生活配套', x => x.life * 10, w => w + '/100', 'high'],
    ['房龄', x => x.age, w => w + '年', 'low'],
    ['绿化率', x => x.greening * 100, w => w.toFixed(0) + '%', 'high'],
    ['楼层', x => ({low:1,mid:2,high:3,top:4,whole:3})[x.floorCode] * 25, w => w + '/100', 'high'],
    ['景观', x => ({none:1,part:2,full:3})[x.viewCode] * 33, w => w + '/100', 'high'],
    ['性价比', x => valueIdx(x), w => w + '/100', 'high']
  ];

  function renderCompare() {
    if (cmpSet.length < 2) {
      $('cmpTable').innerHTML = '';
      clearRadar();
      return;
    }
    // 表
    const head = `<tr><th>维度</th>${cmpSet.map(x => `<th>${esc(x.name)}<br><small>${esc(x.city)}</small></th>`).join('')}</tr>`;
    const rows = CMP_DIMS.map(([name, fn, fmt, dir]) => {
      const vals = cmpSet.map(fn);
      const best = dir === 'high' ? Math.max(...vals) : Math.min(...vals);
      return `<tr><td>${name}</td>${vals.map((v, i) =>
        `<td class="${v === best ? 'highlight-cell' : ''}">${fmt(v)}</td>`).join('')}</tr>`;
    }).join('');
    const scoreRow = `<tr><td><b>综合评分</b></td>${cmpSet.map(x => `<td class="${smartScore(x) === Math.max(...cmpSet.map(smartScore)) ? 'highlight-cell' : ''}"><b>${smartScore(x)}</b></td>`).join('')}</tr>`;
    $('cmpTable').innerHTML = `<thead>${head}</thead><tbody>${rows}${scoreRow}</tbody>`;
    drawRadar();
  }
  function clearRadar() {
    const cv = $('cmpRadar'); const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
  }
  function drawRadar() {
    const cv = $('cmpRadar');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2 + 6, R = 150;
    const dims = CMP_DIMS.map(d => d[0]);
    const n = dims.length;
    const COLORS = ['#1d3f8f', '#b78a3a', '#2e8b57', '#c0392b'];
    ctx.strokeStyle = '#dfe6f2'; ctx.fillStyle = '#8a97b2'; ctx.font = '12px sans-serif';
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const a = -Math.PI / 2 + j * 2 * Math.PI / n;
        const x = cx + Math.cos(a) * R * i / 4, y = cy + Math.sin(a) * R * i / 4;
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + j * 2 * Math.PI / n;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      const lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 18);
      ctx.textAlign = lx > cx + 10 ? 'left' : lx < cx - 10 ? 'right' : 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dims[j], lx, ly);
    }
    cmpSet.forEach((x, idx) => {
      const c = COLORS[idx % COLORS.length];
      ctx.beginPath();
      const vals = CMP_DIMS.map(d => d[1](x));
      const maxs = CMP_DIMS.map(d => Math.max(...cmpSet.map(d[1])));
      const mins = CMP_DIMS.map(d => Math.min(...cmpSet.map(d[1])));
      vals.forEach((v, j) => {
        const norm = maxs[j] === mins[j] ? 0.8 : (v - mins[j]) / (maxs[j] - mins[j]);
        const a = -Math.PI / 2 + j * 2 * Math.PI / n;
        const px = cx + Math.cos(a) * R * (0.12 + norm * 0.88), py = cy + Math.sin(a) * R * (0.12 + norm * 0.88);
        j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = c + '44'; ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
    });
    cmpSet.forEach((x, idx) => {
      const c = COLORS[idx % COLORS.length];
      ctx.fillStyle = c; ctx.font = 'bold 13px sans-serif';
      ctx.fillText('● ' + x.name.slice(0, 8), 20, 24 + idx * 22);
    });
  }

  /* ---------- AI 对比报告 ---------- */
  $('genCmpReport').addEventListener('click', async () => {
    const key = $('cmpAiKey').value.trim();
    if (!key) { toast('请先填写 DeepSeek API Key', true); return; }
    if (cmpSet.length < 2) { toast('请先添加至少 2 个楼盘', true); return; }
    const btn = $('genCmpReport');
    btn.disabled = true; btn.textContent = '生成中…';
    const rep = $('cmpReport');
    rep.style.display = 'block'; rep.textContent = '正在请求 DeepSeek…';
    const prompt = `你是一位资深房产分析师。请对以下 ${cmpSet.length} 个房源做全面对比评估报告（中文，800字内，分节）：
${cmpSet.map((x, i) => `
【房源${i + 1}】${x.name}（${x.city}${x.district}，${x.bandLabel}板块）
- ${x.house} ${x.area}㎡，${x.floor}，${x.view}，${x.deco}
- 总价 ${fmtW(x.total)}，单价 ${fmtU(x.unitPrice)}元/㎡
- ${x.year}年建，物业费 ${x.fee}元/㎡·月，地铁：${x.metro}
- 学区 ${x.school}/10，生活配套 ${x.life}/10，地段 ${x.loc}/10，交通 ${x.trans}/10
- 风格：${x.styles.join('、')}
- 简介：${x.note}`).join('\n')}
请对比：性价比、自住舒适度、投资价值、风险提示，最后给出明确推荐排序和理由。`;
    try {
      const out = await deepseekChat(key, [{ role: 'user', content: prompt }]);
      rep.textContent = out;
    } catch (e) { rep.textContent = '生成失败：' + e.message; }
    btn.disabled = false; btn.textContent = '生成 AI 对比报告';
  });

  /* ---------- 智能匹配 ---------- */
  const recPref = { budget: 500, city: '', mode: 'self', styles: [], product: '', floor: '', view: '', weights: {}, profile: { commute: 50, school: 30, view: 40, fresh: 40 } };
  const DEF_W = { price: 30, loc: 28, trans: 20, prop: 18, type: 20, area: 15, age: 15, school: 18, life: 15, style: 10, value: 15 };
  let recResult = [];

  function initRec() {
    $('matchCity').innerHTML = '<option value="">全国（不限城市）</option>' + CITIES.map(c => `<option value="${c}">${c}</option>`).join('');
    $('matchProduct').innerHTML = '<option value="">不限</option>' + PRODUCTS.map(p => `<option value="${p}">${p}</option>`).join('');
    $('matchStyles').innerHTML = STYLES.map(s => `<span class="chip" data-s="${s}">${esc(s)}</span>`).join('');
    $('matchStyles').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const s = c.dataset.s;
      if (recPref.styles.includes(s)) { recPref.styles = recPref.styles.filter(x => x !== s); c.classList.remove('on'); }
      else { recPref.styles.push(s); c.classList.add('on'); }
    });
    $('matchCity').addEventListener('change', e => recPref.city = e.target.value);
    $('matchProduct').addEventListener('change', e => recPref.product = e.target.value);
    $('matchFloor').addEventListener('change', e => recPref.floor = e.target.value);
    $('matchView').addEventListener('change', e => recPref.view = e.target.value);
    $('budgetSlider').addEventListener('input', e => {
      recPref.budget = +e.target.value;
      $('budgetVal').textContent = fmtW(recPref.budget);
    });
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        recPref.mode = b.dataset.mode;
      });
    });
    [['prefCommute','commute'],['prefSchool','school'],['prefView','view'],['prefFresh','fresh']].forEach(([id, k]) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => recPref.profile[k] = +el.value);
    });
    try {
      const saved = JSON.parse(localStorage.getItem('housePrefs') || 'null');
      if (saved) {
        recPref.budget = saved.budget || recPref.budget;
        recPref.city = saved.city || '';
        recPref.mode = saved.mode || 'self';
        recPref.profile = Object.assign(recPref.profile, saved.profile || {});
        recPref.weights = saved.weights || {};
        $('budgetSlider').value = recPref.budget; $('budgetVal').textContent = fmtW(recPref.budget);
        $('matchCity').value = recPref.city;
        document.querySelectorAll('.mode-btn').forEach(x => x.classList.toggle('active', x.dataset.mode === recPref.mode));
        [['prefCommute','commute'],['prefSchool','school'],['prefView','view'],['prefFresh','fresh']].forEach(([id, k]) => {
          document.getElementById(id).value = recPref.profile[k];
        });
        Object.keys(recPref.weights).forEach(k => {
          const inp = document.querySelector('.w-sliders input[data-w="' + k + '"]');
          if (inp) inp.value = recPref.weights[k];
        });
      }
    } catch (e) {}
    document.addEventListener('beforeunload', () => {
      try { localStorage.setItem('housePrefs', JSON.stringify({ budget: recPref.budget, city: recPref.city, mode: recPref.mode, profile: recPref.profile, weights: recPref.weights })); } catch (e) {}
    });
    document.querySelectorAll('.w-sliders input').forEach(inp => {
      inp.addEventListener('input', () => { recPref.weights[inp.dataset.w] = +inp.value; });
    });
    $('doMatch').addEventListener('click', doRecommend);
    $('budgetSlider').dispatchEvent(new Event('input'));
  }

  function profileWeights() {
    const base = Object.assign({}, DEF_W, recPref.weights);
    const p = recPref.profile;
    base.trans = base.trans * (0.5 + p.commute / 100 * 1.2);
    base.school = base.school * (0.5 + p.school / 100 * 1.4);
    base.age = base.age * (0.6 + p.fresh / 100 * 1.2);
    base.view = 8 + p.view / 100 * 22;
    if (recPref.mode === 'invest') { base.value = base.value * 1.4; base.prop = base.prop * 1.15; base.trans = base.trans * 1.15; }
    return base;
  }
  function typeScore(x, prefProduct) {
    const n = x.house.match(/^(\d)室/);
    const rooms = n ? +n[1] : 3;
    if (!prefProduct) return 60 + rooms * 5;
    const want = PRODUCTS.indexOf(prefProduct) + 1;
    if (prefProduct === '6室+') return rooms >= 6 ? 100 : Math.max(40, 100 - (6 - rooms) * 18);
    return Math.max(40, 100 - Math.abs(rooms - want) * 18);
  }
  function styleScore(styles, prefs) {
    if (!prefs.length) return 70;
    return styles.some(s => prefs.includes(s)) ? 100 : 55;
  }
  function scoreListing(x, pref) {
    const budget = pref.budget;
    const w = profileWeights();
    const ratio = x.total / budget;
    let price;
    if (pref.mode === 'invest') {
      price = ratio <= 1 ? (100 - Math.abs(ratio - 0.92) * 45) : (62 - (ratio - 1) * 90);
    } else {
      price = ratio <= 1 ? (100 - (1 - ratio) * 32 - Math.abs(ratio - 0.88) * 22) : (55 - (ratio - 1) * 95);
    }
    price = Math.max(0, Math.min(100, price));
    const loc = x.loc * 10;
    const trans = Math.min(100, x.trans * 10 + (x.metroOn ? 10 : 0));
    const prop = Math.min(100, 55 + x.fee * 2.5 + (x.band >= 3 ? 10 : 0));
    const type = typeScore(x, pref.product);
    const area = Math.max(30, 100 - Math.abs(Math.log2(x.area / 100) + (budget / 1000)) * 18);
    const age = Math.max(52, 100 - x.age * 1.9);
    const school = x.school * 10;
    const life = x.life * 10;
    const style = styleScore(x.styles, pref.styles);
    const value = valueIdx(x);
    const viewS = Math.min(100, ({none:30,part:60,full:100})[x.viewCode] * (0.6 + pref.profile.view / 100 * 0.8));
    const dims = { price, loc, trans, prop, type, area, age, school, life, style, value, view: viewS };
    const wSum = Object.keys(w).reduce((s, k) => s + (w[k] || 0), 0) || 1;
    const total = Object.keys(dims).reduce((s, k) => s + dims[k] * (w[k] || 0), 0) / wSum;
    const mg = mortgage(x.total);
    const cost = buyCost(x.total);
    const reasons = [];
    if (pref.profile.school >= 70 && x.school >= 8) reasons.push('契合学区画像（' + x.school + '/10）');
    if (pref.profile.view >= 70 && x.viewCode === 'full') reasons.push('契合景观偏好');
    if (pref.profile.fresh >= 70 && x.age <= 3) reasons.push('契合新盘偏好');
    if (price >= 85) reasons.push('价格贴合预算' + fmtW(budget));
    if (value >= 85) reasons.push('性价比高（低于同类' + x.city + x.bandLabel + '均价）');
    if (loc >= 85) reasons.push('地段核心');
    if (trans >= 88) reasons.push('交通便利' + (x.metroOn ? '（' + x.metro + '）' : ''));
    if (prop >= 85) reasons.push('物业品质高');
    if (type >= 90) reasons.push('房型契合需求');
    if (area >= 80) reasons.push('面积合适');
    if (age >= 85) reasons.push('楼龄新');
    if (school >= 80) reasons.push('学区优质');
    if (life >= 80) reasons.push('配套成熟');
    if (style >= 95) reasons.push('风格契合偏好');
    if (pref.mode === 'invest') {
      if (x.band >= 3) reasons.push('板块稀缺性强');
      if (x.viewCode === 'full') reasons.push('景观资源稀缺');
      reasons.push('月供约' + fmtW(mg.monthly) + '/月（30年）');
      reasons.push('预计年租金回报约' + (rentYield(x) * 100).toFixed(2) + '%');
    } else {
      if (mg.monthly / budget < 0.02) reasons.push('月供压力小（' + fmtW(mg.monthly) + '/月）');
      reasons.push('税费合计约' + fmtW(cost.sum) + '（契税+中介）');
    }
    if (!reasons.length) reasons.push('综合条件均衡');
    return { x, score: Math.round(total), dims, reasons: reasons.slice(0, 5) };
  }

  function doRecommend() {
    let pool = L;
    if (recPref.city) pool = pool.filter(x => x.city === recPref.city);
    if (recPref.floor) pool = pool.filter(x => x.floorCode === recPref.floor);
    if (recPref.view) pool = pool.filter(x => x.viewCode === recPref.view);
    if (recPref.product) pool = pool.filter(x => typeScore(x, recPref.product) >= 70);
    if (recPref.styles.length) pool = pool.filter(x => x.styles.some(s => recPref.styles.includes(s)));
    const budget = recPref.budget;
    const flexible = pool.filter(x => x.total <= budget * 1.3);
    const scored = flexible.map(x => scoreListing(x, recPref)).sort((a, b) => b.score - a.score).slice(0, 10);
    recResult = scored;
    $('matchMeta').textContent = `预算 ${fmtW(budget)} · ${recPref.city || '全国'} · ${recPref.mode === 'invest' ? '投资模式' : '自住模式'} · 候选 ${flexible.length} 套 · 画像驱动权重 + 11维评分`;
    $('matchResult').innerHTML = scored.length ? scored.map((r, i) => `
      <div class="match-item ${i === 0 ? 'top1' : ''}" data-id="${r.x.id}">
        <div class="match-rank">${i === 0 ? '★ 最优推荐' : 'TOP ' + (i + 1)} · 综合评分 ${r.score}</div>
        <div class="match-name">${esc(r.x.name)}</div>
        <div class="match-line">${esc(r.x.city)} · ${esc(r.x.district)} · ${esc(r.x.house)} ${r.x.area}㎡ · ${esc(r.x.floor)} · ${esc(r.x.view)} · ${esc(r.x.deco)}</div>
        <div class="match-line" style="color:var(--warn);font-weight:700">${fmtW(r.x.total)} · ${fmtU(r.x.unitPrice)}元/㎡ · ${r.x.age}年楼龄</div>
        <div class="match-score"><span class="score-num">${r.score}</span><div class="score-bar"><div class="score-fill" style="width:${r.score}%"></div></div></div>
        <div class="dim-bars">${Object.keys(r.dims).map(k => `<div class="mini-row"><span>${({price:'价格',loc:'地段',trans:'交通',prop:'物业',type:'房型',area:'面积',age:'房龄',school:'学区',life:'生活',style:'风格',value:'性价比',view:'景观'})[k] || k}</span><div class="score-bar"><div class="score-fill" style="width:${r.dims[k]}%"></div></div><b>${Math.round(r.dims[k])}</b></div>`).join('')}</div>
        <div class="match-reason">${r.reasons.map(esc).join('；')}</div>
      </div>`).join('') : '<div class="empty-state">没有匹配的房源，尝试提高预算或放宽条件</div>';
  }
  $('matchResult').addEventListener('click', e => {
    const item = e.target.closest('.match-item');
    if (item) openDetail(+item.dataset.id);
  });

  /* ---------- AI 置业解读 ---------- */
  $('matchAiBtn').addEventListener('click', async () => {
    const key = $('matchAiKey').value.trim();
    if (!key) { toast('请先填写 DeepSeek API Key', true); return; }
    if (!recResult.length) { toast('请先点击「智能匹配」', true); return; }
    const btn = $('matchAiBtn');
    btn.disabled = true; btn.textContent = '生成中…';
    const rep = $('matchReport');
    rep.style.display = 'block'; rep.textContent = '正在请求 DeepSeek…';
    const top3 = recResult.slice(0, 3);
    const prompt = `你是资深房产置业顾问。用户预算 ${fmtW(recPref.budget)} 万元，城市 ${recPref.city || '不限'}，模式：${recPref.mode === 'invest' ? '投资' : '自住'}，风格偏好：${recPref.styles.join('、') || '不限'}，偏好画像：通勤重要度${recPref.profile.commute}/100、学区需求${recPref.profile.school}/100、景观偏好${recPref.profile.view}/100、新盘偏好${recPref.profile.fresh}/100。以下是系统智能匹配的 TOP3：
${top3.map((r, i) => `
【推荐${i + 1}】${r.x.name}（${r.x.city}${r.x.district}）评分${r.score}
- ${r.x.house} ${r.x.area}㎡ ${r.x.floor} ${r.x.view} ${r.x.deco}
- 总价 ${fmtW(r.x.total)} 单价 ${fmtU(r.x.unitPrice)}元/㎡ ${r.x.year}年建
- 物业 ${r.x.fee}元/㎡·月，学区${r.x.school}/10，生活${r.x.life}/10
- 匹配理由：${r.reasons.join('；')}
- 简介：${r.x.note}`).join('\n')}
请给出 600 字内的置业建议：三个方案的对比、最推荐哪个及原因、议价与风险提示、购房时机建议。`;
    try {
      const out = await deepseekChat(key, [{ role: 'user', content: prompt }]);
      rep.textContent = out;
    } catch (e) { rep.textContent = '生成失败：' + e.message; }
    btn.disabled = false; btn.textContent = '生成 AI 置业解读';
  });

  /* ---------- 启动 ---------- */
  window.addEventListener('DOMContentLoaded', () => {
    $('statLine').textContent = `${L.length.toLocaleString()} 套房源 · ${MST.length} 个真实楼盘 · ${CITIES.length} 城 · 覆盖 12 个价格段`;
    buildMedian();
    initSheet();
    initRec();
    applyFilter();
    renderCmpList();
  });
})();
