      (function() {
        const originalConsole = window.console;
        window.console = {
          log: (...args) => { originalConsole.log(...args); window.parent.postMessage({ type: 'console', message: args.join(' ') }, '*'); },
          error: (...args) => { originalConsole.error(...args); window.parent.postMessage({ type: 'console', message: 'Error: ' + args.join(' ') }, '*'); },
          warn: (...args) => { originalConsole.warn(...args); window.parent.postMessage({ type: 'console', message: 'Warning: ' + args.join(' ') }, '*'); }
        };
        let requestId = 0;
        let callbacksMap = new Map();
        let streamControllers = new Map();
        window.claude = { complete: (prompt) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'claudeComplete', id, prompt }, '*'); }) };
        window.storage = {
          get: (key, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageGet', id, key, shared }, '*'); }),
          set: (key, value, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageSet', id, key, value, shared }, '*'); }),
          delete: (key, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageDelete', id, key, shared }, '*'); }),
          list: (prefix, shared = false) => new Promise((resolve, reject) => { const id = requestId++; callbacksMap.set(id, { resolve, reject }); window.parent.postMessage({ type: 'storageList', id, prefix, shared }, '*'); })
        };
        let pendingBlobs = new Map();
        URL.createObjectURL = (blob) => { const blobId = `blob-${Date.now()}-${Math.random()}`; pendingBlobs.set(blobId, blob); return `blob-request://${blobId}`; };
        URL.revokeObjectURL = (url) => { const blobId = url.replace("blob-request://", ""); pendingBlobs.delete(blobId); };
        const getBlobFromURL = (url) => { const blobId = url.replace("blob-request://", ""); return pendingBlobs.get(blobId); };
        window.fetch = (url, init = {}) => new Promise((resolve, reject) => {
          const id = requestId++;
          const channelId = `fetch-${id}-${Date.now()}`;
          callbacksMap.set(id, { resolve: (response) => {
            const stream = new ReadableStream({ start(controller) { streamControllers.set(channelId, controller); }, cancel() { streamControllers.delete(channelId); } });
            resolve(new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers }));
          }, reject, channelId });
          window.parent.postMessage({ type: 'proxyFetch', id, url, init, channelId }, '*');
        });
        window.addEventListener('message', async (event) => {
          if (event.data.type === 'takeScreenshot') {
            const rootElement = document.getElementById('artifacts-component-root-html');
            if (!rootElement) { window.parent.postMessage({ type: 'screenshotError', error: new Error('Root element not found') }, '*'); return; }
            try { const screenshot = await htmlToImage.toPng(rootElement, { imagePlaceholder: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjePDgwX8ACOQDoNsk0PMAAAAASUVORK5CYII=" }); window.parent.postMessage({ type: 'screenshotData', data: screenshot }, '*'); } catch (err) { window.parent.postMessage({ type: 'screenshotError', error: err instanceof Error ? err : new Error(String(err)) }, '*'); }
          } else if (event.data.type === 'claudeComplete') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.completion); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'proxyFetchResponse') { const cb = callbacksMap.get(event.data.id); if (event.data.error) { cb.reject(new Error(event.data.error)); callbacksMap.delete(event.data.id); } else { cb.resolve({ status: event.data.status, statusText: event.data.statusText, headers: event.data.headers }); if (!event.data.body) callbacksMap.delete(event.data.id); }
          } else if (event.data.type === 'proxyFetchStream') { const controller = streamControllers.get(event.data.channelId); if (controller) { if (event.data.error) { controller.error(new Error(event.data.error)); streamControllers.delete(event.data.channelId); } else if (event.data.done) { controller.close(); streamControllers.delete(event.data.channelId); const cb = Array.from(callbacksMap.entries()).find(([_, v]) => v.channelId === event.data.channelId); if (cb) callbacksMap.delete(cb[0]); } else if (event.data.chunk) controller.enqueue(new Uint8Array(event.data.chunk)); }
          } else if (event.data.type === 'storageGet') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageSet') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageDelete') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id);
          } else if (event.data.type === 'storageList') { const cb = callbacksMap.get(event.data.id); if (event.data.error) cb.reject(new Error(event.data.error)); else cb.resolve(event.data.result); callbacksMap.delete(event.data.id); }
        });
        window.addEventListener('click', (event) => {
          const isEl = event.target instanceof HTMLElement; if (!isEl) return;
          const linkEl = event.target.closest("a"); if (!linkEl || !linkEl.href) return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (linkEl.href.startsWith("blob-request:")) { const blob = getBlobFromURL(linkEl.href); if (!blob) return; void blob.arrayBuffer().then((data) => { window.parent.postMessage({ type: "downloadFile", filename: linkEl.download, data, mimeType: blob.type || "application/octet-stream" }); });
          } else if (linkEl.href.startsWith("data:")) { const [header, base64Data] = linkEl.href.split(","); const mimeMatch = header.match(/data:([^;]+)/); const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream"; const binaryString = atob(base64Data); const data = Uint8Array.from(binaryString, (c) => c.charCodeAt(0)).buffer; window.parent.postMessage({ type: "downloadFile", filename: linkEl.download, data, mimeType });
          } else { let linkUrl; try { linkUrl = new URL(linkEl.href); } catch (error) { return; } if (linkUrl.hostname === window.location.hostname) return; window.parent.postMessage({ type: 'openExternal', href: linkEl.href }, '*'); }
        });
        const originalOpen = window.open;
        window.open = function (url) { window.parent.postMessage({ type: "openExternal", href: url }, "*"); };
        window.addEventListener('error', (event) => { window.parent.postMessage({ type: 'console', message: 'Uncaught Error: ' + event.message }, '*'); });
      })();

    const PRESETS = {
      'mtt-freebuy-888':    { label:'MTT Freebuy (888) – $0',    name:'888 MTT Freebuy',   buyIn:'0',    players:'',  gameType:'MTT' },
      'freeroll-zilnic-888':{ label:'Freeroll Zilnic (888) – $0', name:'Freeroll Zilnic',   buyIn:'0',    players:'',  gameType:'MTT' },
      'sng010-3max':        { label:'SNG $0.10 – 3-max',          name:'SNG $0.10 – 3-max', buyIn:'0.10', players:'3', gameType:'SNG' },
      'sng025-3max':        { label:'SNG $0.25 – 3-max',          name:'SNG $0.25 – 3-max', buyIn:'0.25', players:'3', gameType:'SNG' },
        'sng050-3max':        { label:'SNG $0.50 – 3-max',          name:'SNG $0.50 – 3-max', buyIn:'0.50', players:'3', gameType:'SNG' },
      'sng025-6max':        { label:'SNG $0.25 – 6-max',          name:'SNG $0.25 – 6-max', buyIn:'0.25', players:'6', gameType:'SNG' },
      'sng1-3max':          { label:'SNG $1.00 – 3-max',          name:'SNG $1.00 – 3-max', buyIn:'1.00', players:'3', gameType:'SNG' },
      'sng1-6max':          { label:'SNG $1.00 – 6-max',          name:'SNG $1.00 – 6-max', buyIn:'1.00', players:'6', gameType:'SNG' },
      'mystery-freeroll-gg':{ label:'Mystery Freeroll (GG) – $0', name:'Mystery Freeroll',  buyIn:'0',    players:'18',gameType:'MTT' },
    };
    const ROOM_PRESET_KEYS = {
      '888': ['sng010-3max','sng050-3max','mtt-freebuy-888','freeroll-zilnic-888'],
      'gg':  ['sng025-3max','sng025-6max','sng1-3max','sng1-6max','mystery-freeroll-gg'],
    };
    function updateQuickPresetOptions(room) {
      const qp = document.getElementById('quick-preset');
      if (!qp) return;
      const allowed = ROOM_PRESET_KEYS[room] || [];
      Array.from(qp.options).forEach(opt => { if (opt.value !== '') opt.remove(); });
      allowed.forEach(key => {
        const p = PRESETS[key]; if (!p) return;
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = p.label; qp.appendChild(opt);
      });
      qp.value = '';
    }
    document.addEventListener('DOMContentLoaded', () => {
      const qp = document.getElementById('quick-preset');
      if (qp) {
        qp.addEventListener('change', () => {
          const val = qp.value; if (!val) return;
          const p = PRESETS[val]; if (!p) return;
          document.getElementById('name').value = p.name;
          document.getElementById('buyIn').value = p.buyIn;
          document.getElementById('players').value = p.players;
          document.getElementById('gameType').value = p.gameType;
          document.getElementById('rebuys').value = '0';
          document.getElementById('addon').value = '0';
          qp.value = '';
          const pos = document.getElementById('position'); if (pos) pos.focus();
        });
      }
    });

    const STORAGE_KEY = 'poker-tracker-v1';
    const DEFAULT_BALANCE = { '888': 58.99, 'gg': 49.92 };

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { room:'888', view:'888', games:{'888':[],'gg':[]}, baseBalances:{'888':DEFAULT_BALANCE['888'],'gg':DEFAULT_BALANCE['gg']} };
        const parsed = JSON.parse(raw);
        if (!parsed.games) parsed.games = {'888':[],'gg':[]};
        if (!parsed.games['888']) parsed.games['888'] = [];
        if (!parsed.games['gg']) parsed.games['gg'] = [];
        if (!parsed.room) parsed.room = '888';
        if (!parsed.view) parsed.view = parsed.room;
        if (!parsed.baseBalances) {
          const p888 = parsed.games['888'].reduce((s,g)=>s+(Number(g.profit)||0),0);
          const pgg  = parsed.games['gg'].reduce((s,g)=>s+(Number(g.profit)||0),0);
          parsed.baseBalances = { '888':+(DEFAULT_BALANCE['888']-p888).toFixed(2), 'gg':+(DEFAULT_BALANCE['gg']-pgg).toFixed(2) };
        }
        return parsed;
      } catch(e) { return { room:'888', view:'888', games:{'888':[],'gg':[]}, baseBalances:{'888':DEFAULT_BALANCE['888'],'gg':DEFAULT_BALANCE['gg']} }; }
    }
    function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

    function createGameEntry(room, data) {
      const buyIn = Number(data.buyIn)||0, rebuys = Number(data.rebuys)||0, addon = Number(data.addon)||0;
      const players = Number(data.players)||0, position = Number(data.position)||0, prize = Number(data.prize)||0;
      const totalCost = buyIn + rebuys*buyIn + addon, profit = prize - totalCost, itm = prize > 0;
      let percentile = null;
      if (players > 0 && position > 0 && position <= players)
        percentile = players === 1 ? 0 : ((position-1)/(players-1))*100;
      return { id: Date.now()+'_'+Math.random().toString(36).slice(2), room, name:data.name||'', gameType:data.gameType||'MTT', date:data.date||getLocalDateString(), buyIn, rebuys, addon, players, position, prize, totalCost, profit, itm, percentile, notes:data.notes||'', createdAt:new Date().toISOString() };
    }
    function formatMoney(val) { return (Number(val)||0).toFixed(2); }
    function formatPercent(val) { return (val===null||val===undefined||isNaN(val)) ? '-' : val.toFixed(1)+'%'; }

    function buildCumulativeData(games) {
      if (!games || games.length === 0) return [];
      const sorted = games.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      const firstDate = sorted[0].date||'';
      let startLabel = '';
      if (firstDate) { const d = new Date(firstDate+'T00:00:00'); if (!isNaN(d)) { d.setDate(d.getDate()-1); startLabel = getLocalDateString(d); } }
      const result = [{ date:startLabel, cum:0, name:'Start', profit:0, isStart:true }];
      let cum = 0;
      sorted.forEach(g => { cum += g.profit; result.push({ date:g.date||'?', cum:parseFloat(cum.toFixed(2)), name:g.name||'-', profit:g.profit }); });
      return result;
    }

    // FIX 2+4: drawChart – no dots, opts param, fixed tooltip formatting
    function drawChart(containerId, data, color, opts) {
      opts = opts || {};
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!data || data.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:12px;">Még nincs adat</div>';
        return;
      }
      const rect = el.getBoundingClientRect();
      const width = (rect.width && rect.width > 0 ? rect.width : (el.clientWidth || window.innerWidth-40 || 320));
      const height = el.clientHeight || 190;
      const pad = { top:14, right:12, bottom:26, left:46 };
      const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
      const vals = data.map(d => d.cum);
      const minV = Math.min(0,...vals), maxV = Math.max(0,...vals), range = maxV-minV || 1;
      function xPos(i) { return data.length === 1 ? W/2 : (i/(data.length-1))*W; }
      function yPos(v) { return H - ((v-minV)/range)*H; }

      // FIX 4: format value with correct unit based on opts
      function fmtCumVal(v) {
        if (opts.percent) return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
        if (opts.intOnly) return v.toFixed(0) + ' db';
        return (v >= 0 ? '+' : '') + v.toFixed(2) + '$';
      }

      const pts = data.map((d,i) => xPos(i)+','+yPos(d.cum)).join(' ');
      const zeroY = yPos(0);
      const ticks = [{v:minV,y:yPos(minV)},{v:0,y:zeroY},{v:maxV,y:yPos(maxV)}];
      const xLabels = [];
      const step = Math.max(1, Math.floor(data.length/5));
      for (let i=1; i<data.length; i+=step) xLabels.push({i, date:data[i].date});
      if (xLabels.length === 0 || xLabels[xLabels.length-1].i !== data.length-1)
        xLabels.push({i:data.length-1, date:data[data.length-1].date});

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="overflow:visible;display:block;">
        <g transform="translate(${pad.left},${pad.top})">
          ${ticks.map(t => `<text x="-6" y="${t.y+3}" text-anchor="end" fill="#6b7280" font-size="10">${fmtCumVal(t.v)}</text>`).join('')}
          <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="4,3"/>
          <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          ${xLabels.map(l => `<text x="${xPos(l.i)}" y="${H+18}" text-anchor="middle" fill="#6b7280" font-size="10">${/^\d{4}-\d{2}-\d{2}/.test(l.date||'') ? (l.date||'').slice(5) : (l.date||'')}</text>`).join('')}
          <line x1="0" y1="0" x2="0" y2="${H}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <line class="hover-guide" x1="0" y1="0" x2="0" y2="${H}" stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>
          <circle class="hover-dot" cx="0" cy="0" r="4" fill="${color}" stroke="#020617" stroke-width="1.5" opacity="0"/>
          <rect class="hover-area" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:crosshair"/>
        </g>
      </svg>
      <div class="chart-tooltip"></div>`;
      el.innerHTML = svg;

      const svgEl = el.querySelector('svg');
      const tip = el.querySelector('.chart-tooltip');
      const guide = el.querySelector('.hover-guide');
      const dot = el.querySelector('.hover-dot');
      const area = el.querySelector('.hover-area');

      function showAt(clientX) {
        const r = svgEl.getBoundingClientRect();
        const localX = clientX - r.left - pad.left;
        let idx = 0;
        if (data.length > 1) idx = Math.round((localX/W)*(data.length-1));
        idx = Math.max(0, Math.min(data.length-1, idx));
        const d = data[idx];
        const cx = xPos(idx), cy = yPos(d.cum);
        guide.setAttribute('x1',cx); guide.setAttribute('x2',cx); guide.setAttribute('opacity','0.6');
        dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('opacity','1');
        const profitStr = d.isStart ? 'Kezdés' : `${d.profit>=0?'+':''}${d.profit.toFixed(2)}$`;
        const cumLabel = d.cumLabel || 'Kum';
        const valueStr = fmtCumVal(d.cum);
        const cumulativeValue = typeof d.cumulativeProfit === 'number' ? d.cumulativeProfit : d.cum;
        const cumulativeStr = `${cumulativeValue>=0?'+':''}${cumulativeValue.toFixed(2)}$`;
        if (d.isStart) {
          tip.innerHTML = `<strong>${d.date||'-'}</strong><div>Kezdés: +0.00$</div>`;
        } else if (d.showPeriodAndCumulative) {
          tip.innerHTML = `<strong>${d.date||'-'}</strong>${d.name?`<div>${d.name}</div>`:''}<div>Időszaki profit: ${profitStr}</div><div>Kumulált profit: ${cumulativeStr}</div>`;
        } else {
          // FIX 4: metric first, no dollar on non-money, no duplicate count for 'games' metric
          const showCount = !opts.intOnly && d.name;
          tip.innerHTML = `<strong>${d.date||'-'}</strong><div>${cumLabel}: ${valueStr}</div>${showCount?`<div>${d.name}</div>`:''}`;
        }
        tip.style.display = 'block';
        let left = pad.left + cx;
        const tipW = tip.offsetWidth;
        if (left - tipW/2 < 4) left = tipW/2 + 4;
        if (left + tipW/2 > width-4) left = width - tipW/2 - 4;
        tip.style.left = left + 'px';
        tip.style.top = (pad.top + cy - 8) + 'px';
      }
      function hide() { tip.style.display='none'; guide.setAttribute('opacity','0'); dot.setAttribute('opacity','0'); }
      area.addEventListener('mousemove', e => showAt(e.clientX));
      area.addEventListener('mouseleave', hide);
      area.addEventListener('touchstart', e => { if (e.touches[0]) showAt(e.touches[0].clientX); }, { passive:true });
      area.addEventListener('touchmove',  e => { if (e.touches[0]) showAt(e.touches[0].clientX); }, { passive:true });
      area.addEventListener('click', e => showAt(e.clientX));
    }

    let activePeriod = 'all';
    function filterByPeriod(games, period) {
      if (period === 'all') return games;
      const now = new Date(); let cutoff;
      if (period === 'day') cutoff = getLocalDateString(now);
      else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate()-7); cutoff = getLocalDateString(d); }
      else if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth()-1); cutoff = getLocalDateString(d); }
      return games.filter(g => (g.date||'') >= cutoff);
    }
    function renderCharts() {
      const f888 = filterByPeriod(state.games['888'], activePeriod);
      const fgg  = filterByPeriod(state.games['gg'],  activePeriod);
      const fall = filterByPeriod([...state.games['888'],...state.games['gg']], activePeriod);
      drawChart('chart-888', buildCumulativeData(f888), '#22c55e');
      drawChart('chart-gg',  buildCumulativeData(fgg),  '#eab308');
      drawChart('chart-all', buildCumulativeData(fall), '#a855f7');
    }

    let newChartsPeriod = 'week';
    function isoWeekKey(date) {
      const d = new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
      const dayNum = d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      const weekNum = Math.ceil((((d-yearStart)/86400000)+1)/7);
      return d.getUTCFullYear()+'-W'+String(weekNum).padStart(2,'0');
    }
    function monthKey(date) { return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0'); }
    function dayKey(date) { return getLocalDateString(date); }
    function yearKey(date) { return String(date.getFullYear()); }

    function aggregateBy(games, grouping, metric) {
      const buckets = {};
      games.forEach(g => {
        if (!g.date) return;
        const d = new Date(g.date+'T00:00:00'); if (isNaN(d.getTime())) return;
        let key;
        if (grouping==='week') key = isoWeekKey(d);
        else if (grouping==='month') key = monthKey(d);
        else if (grouping==='year') key = yearKey(d);
        else key = dayKey(d);
        if (!buckets[key]) buckets[key] = {key, games:[]};
        buckets[key].games.push(g);
      });
      const arr = Object.values(buckets).sort((a,b) => a.key.localeCompare(b.key));
      let cumulativeProfit = 0;
      return arr.map(b => {
        const s = calcStats(b.games);
        const periodProfit = +s.totalProfit.toFixed(2);
        cumulativeProfit += periodProfit;
        let value = 0;
        if (metric==='profit') value = periodProfit;
        else if (metric==='cumprofit') value = cumulativeProfit;
        else if (metric==='roi') value = s.roi;
        else if (metric==='itm') value = s.itmRate;
        else if (metric==='games') value = s.games;
        else if (metric==='cost') value = s.totalCost;
        else if (metric==='prize') value = s.totalPrize;
        return { date:b.key, value:+value.toFixed(2), profit:periodProfit, cumulativeProfit:+cumulativeProfit.toFixed(2), n:s.games };
      });
    }

    function formatBucketLabel(key) {
      if (!key) return '';
      let m = key.match(/^(\d{4})-W(\d{2})$/); if (m) return 'W'+m[2]+" '"+m[1].slice(2);
      m = key.match(/^(\d{4})-(\d{2})$/); if (m) { const months=['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Sze','Okt','Nov','Dec']; return months[parseInt(m[2],10)-1]+" '"+m[1].slice(2); }
      if (/^\d{4}$/.test(key)) return key;
      m = key.match(/^\d{4}-(\d{2})-(\d{2})$/); if (m) return m[1]+'.'+m[2];
      return key;
    }

    // FIX 4: drawBarChart – correct fmt/fmtShort with units, fixed tooltip
    function drawBarChart(containerId, data, color, opts) {
      opts = opts || {};
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!data || data.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:12px;">Még nincs adat</div>';
        return;
      }
      const rect = el.getBoundingClientRect();
      const width = Math.max(280, (rect.width && rect.width > 0 ? rect.width : (el.clientWidth || el.offsetWidth || 320)));
      const height = Math.max(170, el.clientHeight || el.offsetHeight || 190);
      const pad = { top:18, right:14, bottom:34, left:48 };
      const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
      const vals = data.map(d => d.value);
      const minV = Math.min(0,...vals), maxV = Math.max(0,...vals), range = (maxV-minV)||1;
      const zeroY = H - ((0-minV)/range)*H;
      const n = data.length, slot = W/n;
      const barW = Math.min(48, Math.max(6, slot*0.6));
      // FIX 4: fmt includes correct unit
      const fmt = (v) => {
        if (opts.percent) return v.toFixed(1)+'%';
        if (opts.intOnly) return v.toFixed(0)+' db';
        return (v>=0?'+':'')+v.toFixed(2)+'$';
      };
      const fmtShort = (v) => {
        if (opts.percent) return v.toFixed(0)+'%';
        if (opts.intOnly) return v.toFixed(0);
        const dec = Math.abs(v)>=100?0:Math.abs(v)>=10?1:2;
        return (v>=0?'+':'')+v.toFixed(dec);
      };
      const ticks = [{v:minV},{v:0},{v:maxV}].filter((t,i,a) => a.findIndex(x=>Math.abs(x.v-t.v)<0.001)===i);
      const stepLabel = Math.max(1, Math.ceil(n/Math.max(3,Math.floor(W/60))));
      const bars = data.map((d,i) => {
        const cx = i*slot + slot/2;
        const y = d.value>=0 ? H-((d.value-minV)/range)*H : zeroY;
        const h = Math.max(1, Math.abs((d.value/range)*H));
        const fill = d.value>=0 ? color : '#ef4444';
        const labelY = d.value>=0 ? y-4 : (y+h+11);
        const showLabel = barW >= 20;
        const valueLabel = showLabel ? `<text x="${cx}" y="${labelY}" text-anchor="middle" fill="#cbd5e1" font-size="10" font-weight="600">${fmtShort(d.value)}</text>` : '';
        return `<g><rect x="${cx-barW/2}" y="${y}" width="${barW}" height="${h}" fill="${fill}" rx="3" data-i="${i}"><title>${formatBucketLabel(d.date)}: ${fmt(d.value)} (${d.n} db)</title></rect>${valueLabel}</g>`;
      }).join('');
      const xlabels = data.map((d,i) => {
        if (i%stepLabel!==0 && i!==n-1) return '';
        return `<text x="${i*slot+slot/2}" y="${H+22}" text-anchor="middle" fill="#94a3b8" font-size="10">${formatBucketLabel(d.date)}</text>`;
      }).join('');
      const tickEls = ticks.map(t => {
        const y = H-((t.v-minV)/range)*H;
        return `<text x="-6" y="${y+3}" text-anchor="end" fill="#6b7280" font-size="10">${fmt(t.v)}</text>
                <line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
      }).join('');
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;display:block;">
        <g transform="translate(${pad.left},${pad.top})">
          ${tickEls}
          <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="rgba(255,255,255,0.30)" stroke-width="1"/>
          ${bars}
          ${xlabels}
        </g>
      </svg><div class="chart-tooltip"></div>`;
      const tip = el.querySelector('.chart-tooltip');
      const rects = el.querySelectorAll('rect[data-i]');
      function showBarTip(idx, clientX) {
        const d = data[idx];
        if (!d || !tip) return;
        const svgRect = el.querySelector('svg').getBoundingClientRect();
        const cx = (idx*slot + slot/2) + pad.left;
        const value = fmt(d.value);
        // FIX 4: show metric label (not generic "Érték"), correct unit already in fmt
        const metricLabel = opts.metricLabel || 'Érték';
        tip.innerHTML = `<strong>${formatBucketLabel(d.date)}</strong><div>${metricLabel}: ${value}</div><div>Verseny: ${d.n} db</div>`;
        tip.style.display = 'block';
        let left = clientX ? clientX - svgRect.left : cx;
        const tipW = tip.offsetWidth;
        if (left - tipW/2 < 4) left = tipW/2 + 4;
        if (left + tipW/2 > width-4) left = width - tipW/2 - 4;
        tip.style.left = left + 'px';
        tip.style.top = (pad.top + 8) + 'px';
      }
      function hideBarTip() { if (tip) tip.style.display='none'; }
      rects.forEach(rect => {
        const idx = Number(rect.getAttribute('data-i'));
        rect.addEventListener('mousemove', e => showBarTip(idx, e.clientX));
        rect.addEventListener('mouseleave', hideBarTip);
        rect.addEventListener('click', e => showBarTip(idx, e.clientX));
        rect.addEventListener('touchstart', e => { if (e.touches[0]) showBarTip(idx, e.touches[0].clientX); }, { passive:true });
        rect.addEventListener('touchmove',  e => { if (e.touches[0]) showBarTip(idx, e.touches[0].clientX); }, { passive:true });
      });
    }

    function aggregatedToLineDataV2(agg, options) {
      options = options || {};
      const plotCumulative = !!options.cumulative || !!options.plotCumulative;
      const includeStart = !!options.includeStart;
      const showPeriodAndCumulative = options.showPeriodAndCumulative !== false;
      const lineLabel = options.cumLabel || (plotCumulative ? 'Kumulált profit' : 'Profit');
      const arr = agg.map(d => ({
        date: formatBucketLabel(d.date),
        cum: +(plotCumulative ? d.cumulativeProfit : d.value).toFixed(2),
        profit: d.profit, cumulativeProfit: d.cumulativeProfit,
        name: d.n + ' verseny', cumLabel: lineLabel,
        showPeriodAndCumulative, isStart: false,
      }));
      if (arr.length === 0) return arr;
      return includeStart ? [{ date:'Start', cum:0, profit:0, cumulativeProfit:0, name:'', isStart:true, cumLabel:lineLabel }, ...arr] : arr;
    }

    function renderNewCharts() {
      const g = newChartsPeriod;
      const a888 = aggregateBy(state.games['888'], g, 'profit');
      const agg  = aggregateBy(state.games['gg'], g, 'profit');
      const aall = aggregateBy([...state.games['888'],...state.games['gg']], g, 'profit');
      const periodLineOptions = { plotCumulative:true, includeStart:true, showPeriodAndCumulative:true, cumLabel:'Kumulált profit' };
      drawChart('nchart-888', aggregatedToLineDataV2(a888, periodLineOptions), '#22c55e');
      drawChart('nchart-gg',  aggregatedToLineDataV2(agg,  periodLineOptions), '#eab308');
      drawChart('nchart-all', aggregatedToLineDataV2(aall, periodLineOptions), '#a855f7');
      renderCustomChart();
    }

    // FIX 4: renderCustomChart passes metricLabel and opts to chart functions
    function renderCustomChart() {
      const metric = document.getElementById('cc-metric')?.value || 'profit';
      const group  = document.getElementById('cc-group')?.value  || 'week';
      const room   = document.getElementById('cc-room')?.value   || 'all';
      const type   = document.getElementById('cc-type')?.value   || 'bar';
      const from   = document.getElementById('cc-from')?.value   || '';
      const to     = document.getElementById('cc-to')?.value     || '';
      let games = room === 'all' ? [...state.games['888'],...state.games['gg']] : state.games[room].slice();
      if (from) games = games.filter(g => (g.date||'') >= from);
      if (to)   games = games.filter(g => (g.date||'') <= to);
      const data = aggregateBy(games, group, metric);
      const metricLabels = { profit:'Profit', cumprofit:'Kumulált profit', roi:'ROI', itm:'ITM arány', games:'Versenyek száma', cost:'Befizetés', prize:'Visszakapott' };
      const groupLabels  = { day:'napi', week:'heti', month:'havi', year:'éves' };
      const roomLabels   = { all:'Összes', '888':'888poker', gg:'GGPoker' };
      const metricLabel  = metricLabels[metric];
      document.getElementById('cc-title').textContent = `${metricLabel} – ${groupLabels[group]} (${roomLabels[room]})`;
      const color = room === '888' ? '#22c55e' : room === 'gg' ? '#eab308' : '#a855f7';
      const isPct   = metric === 'roi' || metric === 'itm';
      const isInt   = metric === 'games';
      const chartOpts = { percent: isPct, intOnly: isInt, metricLabel };
      if (type === 'line') {
        const lineData = aggregatedToLineDataV2(data, {
          cumulative: metric === 'cumprofit',
          plotCumulative: metric === 'profit',
          includeStart: metric === 'profit' || metric === 'cumprofit',
          showPeriodAndCumulative: metric === 'profit' || metric === 'cumprofit',
          cumLabel: (metric === 'profit' || metric === 'cumprofit') ? 'Kumulált profit' : metricLabel
        });
        drawChart('cc-chart', lineData, color, chartOpts);
      } else {
        drawBarChart('cc-chart', data, color, chartOpts);
      }
    }

    function calcStats(games) {
      if (!games || games.length === 0)
        return { games:0,totalProfit:0,totalCost:0,totalPrize:0,itmCount:0,itmRate:0,avgPercentile:null,roi:0,paidGames:0,paidProfit:0,paidCost:0,freeGames:0,freeProfit:0 };
      let totalProfit=0,totalCost=0,totalPrize=0,itmCount=0,percSum=0,percCount=0,paidGames=0,paidProfit=0,paidCost=0,freeGames=0,freeProfit=0;
      for (const g of games) {
        totalProfit += g.profit; totalCost += g.totalCost; totalPrize += g.prize;
        if (g.itm) itmCount += 1;
        if (typeof g.percentile === 'number') { percSum += g.percentile; percCount += 1; }
        const isFree = (Number(g.buyIn)||0) === 0 && (Number(g.totalCost)||0) === 0;
        if (isFree) { freeGames += 1; freeProfit += g.profit; }
        else { paidGames += 1; paidProfit += g.profit; paidCost += g.totalCost; }
      }
      return { games:games.length, totalProfit, totalCost, totalPrize, itmCount, itmRate:games.length?(itmCount/games.length)*100:0, avgPercentile:percCount?percSum/percCount:null, roi:paidCost?(paidProfit/paidCost)*100:0, paidGames, paidProfit, paidCost, freeGames, freeProfit };
    }

    function applySparkline(el, needleEl, textEl, stats, label) {
      if (stats.games === 0 || stats.totalCost === 0) {
        needleEl.style.left='calc(50% - 2px)'; needleEl.style.background='#94a3b8'; needleEl.style.boxShadow='0 0 10px rgba(148,163,184,0.9)'; textEl.textContent='Még nincs elég adat'; return;
      }
      const roi = stats.roi, clamped = Math.max(-150,Math.min(150,roi)), pct = 50+(clamped/150)*50;
      needleEl.style.left = 'calc('+pct+'% - 2px)';
      let r,g,b;
      if (pct<=50) { const t=pct/50; r=Math.round(239-(239-100)*t); g=Math.round(68+(116-68)*t); b=Math.round(68+(139-68)*t); }
      else { const t=(pct-50)/50; r=Math.round(100-(100-34)*t); g=Math.round(116+(197-116)*t); b=Math.round(139-(139-94)*t); }
      const col='rgb('+r+','+g+','+b+')';
      needleEl.style.background = col; needleEl.style.boxShadow = '0 0 14px '+col;
      if (roi > 0.3) textEl.textContent='Pluszban vagy '+label+' ('+formatPercent(roi)+' ROI)';
      else if (roi < -0.3) textEl.textContent='Mínuszban vagy '+label+' ('+formatPercent(roi)+' ROI)';
      else textEl.textContent='Közel breakeven '+label+' ('+formatPercent(roi)+' ROI)';
    }

    // === FIX 3: Mentett szűrők (localStorage) ===
    const SAVED_FILTERS_KEY = 'poker-tracker-saved-filters-v1';
    function loadSavedFilters() {
      try { const raw = localStorage.getItem(SAVED_FILTERS_KEY); return raw ? JSON.parse(raw) : []; }
      catch { return []; }
    }
    function storeSavedFilters(filters) { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters)); }
    function renderSavedFilterDropdown() {
      const sel = document.getElementById('saved-filter-select');
      if (!sel) return;
      const current = sel.value;
      const saved = loadSavedFilters();
      sel.innerHTML = '<option value="">Válassz mentett szűrőt...</option>';
      saved.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id; opt.textContent = f.name; sel.appendChild(opt);
      });
      if (current && saved.find(f=>f.id===current)) sel.value = current;
    }
    function applySavedFilter(id) {
      const saved = loadSavedFilters();
      const f = saved.find(x => x.id === id); if (!f) return;
      Object.assign(roomFilters, f.filters);
      syncRoomFilterInputs();
      renderRoomTable();
    }
    function saveCurrentFilter(name) {
      if (!name || !name.trim()) return false;
      const saved = loadSavedFilters();
      saved.push({ id: Date.now()+'_'+Math.random().toString(36).slice(2), name:name.trim(), filters: { search:roomFilters.search, costMode:roomFilters.costMode, exact:roomFilters.exact, min:roomFilters.min, max:roomFilters.max, gameType:roomFilters.gameType, preset:roomFilters.preset||'' } });
      storeSavedFilters(saved);
      renderSavedFilterDropdown();
      return true;
    }
    function deleteSavedFilter(id) {
      storeSavedFilters(loadSavedFilters().filter(f=>f.id!==id));
      renderSavedFilterDropdown();
    }

    let state = loadState();
    let editId = null;
    const roomFilters = { search:'', costMode:'all', exact:'', min:'', max:'', gameType:'all', preset:'' };

    const noteBackdrop = document.getElementById('note-viewer-backdrop');
    const noteBody = document.getElementById('note-viewer-body');
    const tableBody = document.getElementById('table-body');
    const roomLayout = document.getElementById('room-layout');
    const summaryLayout = document.getElementById('summary-layout');
    const roomLabel = document.getElementById('room-label');
    const roomText = document.getElementById('room-text');

    function installEdgeSwipeGuard() {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
      const isStandalone = window.navigator.standalone===true||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
      const isEmbeddedPreview = window.parent && window.parent !== window;
      if (!isIOS||(isEmbeddedPreview&&!isStandalone)) return;
      let startX=0,startY=0,edgeSwipe=false;
      const edgeSize=32;
      document.addEventListener('touchstart',(e)=>{ const t=e.touches&&e.touches[0]; if(!t)return; startX=t.clientX; startY=t.clientY; edgeSwipe=startX<=edgeSize||startX>=window.innerWidth-edgeSize; },{passive:true});
      document.addEventListener('touchmove',(e)=>{ if(!edgeSwipe)return; const t=e.touches&&e.touches[0]; if(!t)return; const dx=t.clientX-startX,dy=t.clientY-startY; const horizontal=Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>8; const leavingRight=startX>=window.innerWidth-edgeSize&&dx<0; const leavingLeft=startX<=edgeSize&&dx>0; if(horizontal&&(leavingRight||leavingLeft)){e.preventDefault();e.stopPropagation();} },{passive:false});
    }
    function openNoteViewer(text) { if (!text) return; noteBody.textContent=text; noteBackdrop.style.display='flex'; }
    function closeNoteViewer() { noteBackdrop.style.display='none'; noteBody.textContent=''; }
    noteBackdrop.addEventListener('click', e => { if(e.target===noteBackdrop) closeNoteViewer(); });
    document.getElementById('note-viewer-close-top').addEventListener('click', closeNoteViewer);
    document.getElementById('note-viewer-close-bottom').addEventListener('click', closeNoteViewer);

    function setEditMode(game) {
      document.getElementById('name').value=game.name||''; document.getElementById('buyIn').value=game.buyIn||'';
      document.getElementById('rebuys').value=game.rebuys||0; document.getElementById('addon').value=game.addon||0;
      document.getElementById('players').value=game.players||''; document.getElementById('position').value=game.position||'';
      document.getElementById('prize').value=game.prize||''; document.getElementById('gameType').value=game.gameType||'MTT';
      document.getElementById('notes').value=game.notes||'';
      const d=document.getElementById('date'); if(d) d.value=game.date||getLocalDateString();
      editId=game.id;
      document.getElementById('submit-btn').textContent='Mentés';
      document.getElementById('btn-cancel-edit').classList.remove('hidden');
      document.getElementById('editing-indicator').classList.remove('hidden');
      document.getElementById('tournament-form').scrollIntoView({behavior:'smooth',block:'start'});
    }
    function clearEditMode() {
      document.getElementById('tournament-form').reset();
      document.getElementById('rebuys').value='0'; document.getElementById('addon').value='0';
      const d=document.getElementById('date'); if(d) d.value=getLocalDateString();
      editId=null;
      document.getElementById('submit-btn').textContent='+ Verseny hozzáadása';
      document.getElementById('btn-cancel-edit').classList.add('hidden');
      document.getElementById('editing-indicator').classList.add('hidden');
    }
    function deleteGameEntry(id) {
      if (!confirm('Biztosan törölni szeretnéd ezt a versenyt?')) return;
      const idx = state.games[state.room].findIndex(x=>x.id===id);
      if (idx !== -1) { state.games[state.room].splice(idx,1); saveState(state); render(); }
    }
    function normalizeFilterText(value) { return String(value||'').trim().toLowerCase(); }
    function parseFilterMoney(value) { const n=parseFloat(String(value||'').replace(',','.')); return isNaN(n)?null:n; }
    function getGameBuyIn(g) { return Number(g.buyIn)||0; }
    function hasActiveRoomFilters() {
      return !!(roomFilters.search||roomFilters.costMode!=='all'||roomFilters.exact||roomFilters.min||roomFilters.max||roomFilters.gameType!=='all'||roomFilters.preset);
    }
    function gameMatchesRoomFilters(g) {
      const search = normalizeFilterText(roomFilters.search);
      if (search) { const hay=normalizeFilterText([g.name,g.notes,g.gameType,g.date].join(' ')); if(!hay.includes(search))return false; }
      if (roomFilters.gameType!=='all'&&(g.gameType||'').toUpperCase()!==roomFilters.gameType)return false;
      const buyIn=getGameBuyIn(g),exact=parseFilterMoney(roomFilters.exact),min=parseFilterMoney(roomFilters.min),max=parseFilterMoney(roomFilters.max);
      const isFree=buyIn===0&&(Number(g.totalCost)||0)===0;
      if (roomFilters.costMode==='free'&&!isFree)return false;
      if (roomFilters.costMode==='paid'&&isFree)return false;
      if (roomFilters.costMode==='exact'&&(exact===null||Math.abs(buyIn-exact)>0.001))return false;
      if (roomFilters.costMode==='gte'&&(min===null||buyIn<min))return false;
      if (roomFilters.costMode==='lte'&&(max===null||buyIn>max))return false;
      if (roomFilters.costMode==='range'){if(min!==null&&buyIn<min)return false;if(max!==null&&buyIn>max)return false;}
      if (roomFilters.preset==='sng6max025'){const name=normalizeFilterText(g.name);const players=Number(g.players)||0;const looks6Max=players===6||name.includes('6-max')||name.includes('6 max');if((g.gameType||'').toUpperCase()!=='SNG'||Math.abs(buyIn-0.25)>0.001||!looks6Max)return false;}
      return true;
    }
    function filteredRoomGames() { return state.games[state.room].filter(gameMatchesRoomFilters); }
    function syncRoomFilterInputs() {
      const map={'rf-search':'search','rf-cost-mode':'costMode','rf-buyin-exact':'exact','rf-buyin-min':'min','rf-buyin-max':'max','rf-game-type':'gameType'};
      Object.entries(map).forEach(([id,key])=>{ const el=document.getElementById(id); if(el) el.value=roomFilters[key]; });
    }
    function activeRoomFilterLabel() {
      const parts=[];
      if(roomFilters.search)parts.push('kereses: "'+roomFilters.search+'"');
      if(roomFilters.gameType!=='all')parts.push(roomFilters.gameType);
      if(roomFilters.costMode==='free')parts.push('freebuy');
      if(roomFilters.costMode==='paid')parts.push('pénzes');
      if(roomFilters.costMode==='exact'&&roomFilters.exact)parts.push('$'+formatMoney(parseFilterMoney(roomFilters.exact)));
      if(roomFilters.costMode==='gte'&&roomFilters.min)parts.push('$'+formatMoney(parseFilterMoney(roomFilters.min))+'+');
      if(roomFilters.costMode==='lte'&&roomFilters.max)parts.push('max $'+formatMoney(parseFilterMoney(roomFilters.max)));
      if(roomFilters.costMode==='range')parts.push('$'+(roomFilters.min||'0')+' - $'+(roomFilters.max||''));
      if(roomFilters.preset==='sng6max025')parts.push('SNG 6-max $0.25');
      return parts.length ? parts.join(' - ') : 'Szűrt versenyek';
    }
    function updateRoomFilterSummary(filtered) {
      const box = document.getElementById('room-filter-summary');
      if (!box) return;
      const active = hasActiveRoomFilters();
      box.classList.toggle('hidden', !active);
      // FIX 3: update active indicator on toggle button
      const indicator = document.getElementById('filter-active-indicator');
      if (indicator) indicator.classList.toggle('hidden', !active);
      if (!active) return;
      const s = calcStats(filtered);
      const positions = filtered.map(g=>Number(g.position)).filter(n=>!isNaN(n)&&n>0);
      const avgPos = positions.length ? positions.reduce((a,b)=>a+b,0)/positions.length : null;
      document.getElementById('room-filter-summary-title').textContent = (state.room==='gg'?'GGPoker':'888poker')+' - '+activeRoomFilterLabel();
      document.getElementById('room-filter-summary-stats').innerHTML =
        '<span>Db: '+s.games+'</span><span>Profit: '+formatMoney(s.totalProfit)+' $</span>'+
        '<span>ROI: '+formatPercent(s.roi)+'</span><span>Átlag hely: '+(avgPos===null?'-':avgPos.toFixed(1))+'</span>'+
        '<span>ITM: '+formatPercent(s.itmRate)+'</span><span>Költség: '+formatMoney(s.totalCost)+' $</span>';
    }

    function renderRoomTable() {
      tableBody.innerHTML = '';
      const filteredGames = filteredRoomGames();
      updateRoomFilterSummary(filteredGames);
      const sortedGames = filteredGames.slice().sort((a,b)=>{ const da=a.date||'',db=b.date||''; const dc=db.localeCompare(da); return dc!==0?dc:(b.createdAt||'').localeCompare(a.createdAt||''); });
      sortedGames.forEach(g => {
        const row = document.createElement('div');
        row.className = 'table-row';
        const profitSpanClass = g.profit>0?'badge-profit-positive':g.profit<0?'badge-profit-negative':'badge-profit-even';
        const profitText = g.profit>0?'+'+formatMoney(g.profit):g.profit<0?formatMoney(g.profit):'0.00';
        function addCell(text,cls){ const d=document.createElement('div'); if(cls) d.className=cls; d.textContent=text; row.appendChild(d); return d; }
        addCell(g.name||'-',''); addCell(g.date||'-','cell-center'); addCell(formatMoney(g.totalCost),'cell-right'); addCell(formatMoney(g.prize),'cell-right');
        const profitCell=document.createElement('div'); profitCell.className='cell-right'; const profitSpan=document.createElement('span'); profitSpan.className=profitSpanClass; profitSpan.textContent=profitText; profitCell.appendChild(profitSpan); row.appendChild(profitCell);
        const itmCell=document.createElement('div'); itmCell.className='cell-center'; const itmSpan=document.createElement('span'); itmSpan.className=g.itm?'badge-itm-yes':'badge-itm-no'; itmSpan.textContent=g.itm?'Pénzben':'Nem'; itmCell.appendChild(itmSpan); row.appendChild(itmCell);
        addCell(g.gameType||'-','cell-center');
        const percCell=document.createElement('div'); percCell.className='cell-center'; const percSpan=document.createElement('span'); percSpan.className='badge-percentile'; percSpan.textContent=typeof g.percentile==='number'?formatPercent(g.percentile):'-'; percCell.appendChild(percSpan); row.appendChild(percCell);
        addCell(g.players||'-','cell-center'); addCell(g.position||'-','cell-center');
        const notesCell=document.createElement('div');
        if (g.notes&&g.notes.trim()!=='') { notesCell.className='cell-notes'; notesCell.textContent=g.notes; notesCell.title='Kattints a teljes megjegyzéshez'; notesCell.addEventListener('click',e=>{e.stopPropagation();openNoteViewer(g.notes);}); }
        else { notesCell.className='cell-notes cell-notes-empty'; notesCell.textContent='-'; }
        row.appendChild(notesCell);
        const actionCell=document.createElement('div'); actionCell.className='cell-center';
        const editBtn=document.createElement('button'); editBtn.className='action-btn edit'; editBtn.textContent='✏️'; editBtn.title='Szerkesztés'; editBtn.addEventListener('click',e=>{e.stopPropagation();setEditMode(g);}); 
        const delBtn=document.createElement('button'); delBtn.className='action-btn delete'; delBtn.textContent='🗑️'; delBtn.title='Törlés'; delBtn.addEventListener('click',e=>{e.stopPropagation();deleteGameEntry(g.id);});
        actionCell.appendChild(editBtn); actionCell.appendChild(delBtn); row.appendChild(actionCell);
        tableBody.appendChild(row);
      });
    }

    const periodState = { mode:'today', from:'', to:'' };
    function periodRange() {
      const today = new Date(), todayStr = getLocalDateString(today);
      if (periodState.mode==='custom') return { from:periodState.from||'0000-01-01', to:periodState.to||'9999-12-31' };
      if (periodState.mode==='today') return { from:todayStr, to:todayStr };
      const d = new Date(today);
      if (periodState.mode==='week') d.setDate(d.getDate()-6);
      else if (periodState.mode==='month') d.setDate(d.getDate()-29);
      else if (periodState.mode==='year') d.setDate(d.getDate()-364);
      return { from:getLocalDateString(d), to:todayStr };
    }
    function renderPeriodSummary() {
      const {from,to}=periodRange();
      const all=[...state.games['888'],...state.games['gg']];
      const filtered=all.filter(g=>g.date&&g.date>=from&&g.date<=to);
      const s=calcStats(filtered);
      document.getElementById('period-range-label').textContent=from+' → '+to;
      document.getElementById('period-games').textContent=s.games;
      document.getElementById('period-profit').textContent=formatMoney(s.totalProfit)+' $';
      document.getElementById('period-roi').textContent=formatPercent(s.roi);
      document.getElementById('period-itm').textContent=formatPercent(s.itmRate);
      document.getElementById('period-cost').textContent=formatMoney(s.totalCost)+' $';
      document.getElementById('period-prize').textContent=formatMoney(s.totalPrize)+' $';
    }
    function tourneyTypeKey(g) {
      const room=g.room==='gg'?'GG':'888', gt=g.gameType||'MTT', bi=Number(g.buyIn)||0;
      const nameRaw=(g.name||'').trim(), nameKey=nameRaw.toLowerCase().replace(/\s+/g,' ');
      const biLabel=bi===0?'Freebuy':'$'+formatMoney(bi);
      const label=nameRaw?(room+' · '+nameRaw+' · '+biLabel):(room+' · '+gt+' · '+biLabel);
      const key=nameKey?(room+'|'+nameKey):(room+'|'+gt+'|bi:'+bi.toFixed(2));
      return {key,label,room,gt,bi};
    }
    function renderTourneyTypes() {
      const all=[...state.games['888'],...state.games['gg']];
      const groups={};
      all.forEach(g=>{ const t=tourneyTypeKey(g); if(!groups[t.key])groups[t.key]={label:t.label,bi:t.bi,games:[]}; groups[t.key].games.push(g); });
      const arr=Object.values(groups).sort((a,b)=>b.games.length-a.games.length||a.bi-b.bi);
      const table=document.getElementById('tourney-type-table');
      table.innerHTML='<tr><th>Típus</th><th>Db</th><th>Profit</th><th>ROI</th><th>ITM%</th></tr>';
      if(arr.length===0){table.innerHTML+='<tr><td colspan="5" style="color:var(--muted);text-align:center;">Még nincs adat</td></tr>';return;}
      arr.forEach(grp=>{
        const s=calcStats(grp.games);
        const pc=s.totalProfit>0?'color:#22c55e;':s.totalProfit<0?'color:#ef4444;':'';
        const tr=document.createElement('tr');
        tr.innerHTML='<td>'+grp.label+'</td><td>'+s.games+'</td><td style="'+pc+'">'+formatMoney(s.totalProfit)+' $</td><td>'+formatPercent(s.roi)+'</td><td>'+formatPercent(s.itmRate)+'</td>';
        table.appendChild(tr);
      });
    }

    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('#period-summary-filter .period-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('#period-summary-filter .period-btn').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active'); periodState.mode=btn.getAttribute('data-psum');
          document.getElementById('period-custom-range').style.display=periodState.mode==='custom'?'flex':'none';
          renderPeriodSummary();
          if(periodState.mode==='custom'){const fromEl=document.getElementById('period-from');setTimeout(()=>{try{fromEl.focus();}catch(e){}if(typeof fromEl.showPicker==='function'){try{fromEl.showPicker();}catch(e){}}},60);}
        });
      });
      const fromEl=document.getElementById('period-from'),toEl=document.getElementById('period-to');
      if(fromEl)fromEl.addEventListener('change',()=>{periodState.from=fromEl.value;renderPeriodSummary();setTimeout(()=>{try{toEl.focus();}catch(e){}if(typeof toEl.showPicker==='function'){try{toEl.showPicker();}catch(e){}}},60);});
      if(toEl)toEl.addEventListener('change',()=>{periodState.to=toEl.value;renderPeriodSummary();});
    });

    function render() {
      const isSummary=state.view==='summary';
      const statsAll=calcStats([...state.games['888'],...state.games['gg']]);
      const statsRoom=calcStats(state.games[state.room]);
      const sum888=calcStats(state.games['888']), sumGg=calcStats(state.games['gg']);
      const roomName=state.room==='888'?'888poker':'GGPoker';
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      const activeTab=document.querySelector('.tab[data-tab="'+state.view+'"]');
      if(activeTab)activeTab.classList.add('active');
      const isCharts=state.view==='charts', isNewCharts=state.view==='new-charts';
      const isRoom=state.view==='888'||state.view==='gg';
      roomLayout.classList.toggle('hidden',!isRoom);
      summaryLayout.classList.toggle('hidden',!isSummary);
      const chartsLayout=document.getElementById('charts-layout');
      if(chartsLayout){chartsLayout.classList.remove('hidden');chartsLayout.style.display=isCharts?'block':'none';}
      const newChartsLayout=document.getElementById('new-charts-layout');
      if(newChartsLayout){newChartsLayout.classList.remove('hidden');newChartsLayout.style.display=isNewCharts?'block':'none';}
      if(isCharts)requestAnimationFrame(()=>renderCharts());
      if(isNewCharts)requestAnimationFrame(()=>renderNewCharts());
      const headerStats=document.querySelector('.header-stats');
      if(headerStats)headerStats.style.display=(isCharts||isNewCharts)?'none':'';
      updateQuickPresetOptions(state.room);
      document.getElementById('header-label-1').textContent=isSummary?'Lejátszott versenyek összesen':'Lejátszott versenyek ('+(state.room==='888'?'888':'GG')+')';
      document.getElementById('header-label-2').textContent=isSummary?'Összes profit':'Profit ('+(state.room==='888'?'888':'GG')+')';
      document.getElementById('header-label-3').textContent=isSummary?'Összes ITM arány':'ITM arány ('+(state.room==='888'?'888':'GG')+')';
      document.getElementById('header-total-games').textContent=isSummary?statsAll.games:statsRoom.games;
      document.getElementById('header-total-profit').textContent=formatMoney(isSummary?statsAll.totalProfit:statsRoom.totalProfit);
      document.getElementById('header-itm-rate').textContent=formatPercent(isSummary?statsAll.itmRate:statsRoom.itmRate);
      roomText.textContent=roomName;
      document.getElementById('summary-room-label').textContent=roomName;
      roomLabel.classList.toggle('room-888',state.room==='888');
      roomLabel.classList.toggle('room-gg',state.room==='gg');
      const gt=document.getElementById('gameType'); if(gt&&!editId)gt.value=state.room==='gg'?'SNG':'MTT';
      renderRoomTable();
      document.getElementById('room-profit').textContent=formatMoney(statsRoom.totalProfit)+' $';
      document.getElementById('room-profit-nofree').textContent=formatMoney(statsRoom.paidProfit)+' $';
      document.getElementById('room-games').textContent=statsRoom.games;
      document.getElementById('room-itm-rate').textContent=formatPercent(statsRoom.itmRate);
      document.getElementById('room-cost').textContent=formatMoney(statsRoom.totalCost)+' $';
      document.getElementById('room-prize').textContent=formatMoney(statsRoom.totalPrize)+' $';
      document.getElementById('room-itm-count').textContent=statsRoom.itmCount+'x';
      document.getElementById('room-roi-chip').textContent='ROI: '+formatPercent(statsRoom.roi);
      document.getElementById('room-avg-percentile-chip').textContent='Átlagos mezőny%: '+(statsRoom.avgPercentile===null?'-':formatPercent(statsRoom.avgPercentile));
      const balance=(state.baseBalances?.[state.room]??0)+statsRoom.totalProfit;
      const balEl=document.getElementById('room-balance');
      if(balEl){balEl.textContent=formatMoney(balance)+' $';balEl.style.color=balance>=0?'#22c55e':'#ef4444';}
      document.getElementById('all-profit').textContent=formatMoney(statsAll.totalProfit)+' $';
      document.getElementById('all-profit-nofree').textContent=formatMoney(statsAll.paidProfit)+' $';
      document.getElementById('all-games').textContent=statsAll.games;
      document.getElementById('all-itm-rate').textContent=formatPercent(statsAll.itmRate);
      document.getElementById('all-cost').textContent=formatMoney(statsAll.totalCost)+' $';
      document.getElementById('all-prize').textContent=formatMoney(statsAll.totalPrize)+' $';
      document.getElementById('all-itm-count').textContent=statsAll.itmCount+'x';
      document.getElementById('all-roi-chip').textContent='ROI: '+formatPercent(statsAll.roi);
      document.getElementById('all-avg-percentile-chip').textContent='Átlag mezőny%: '+(statsAll.avgPercentile===null?'-':formatPercent(statsAll.avgPercentile));
      ['888','gg'].forEach(r=>{
        const s=r==='888'?sum888:sumGg, pfx='sum-'+r+'-';
        document.getElementById(pfx+'games').textContent=s.games;
        document.getElementById(pfx+'profit').textContent=formatMoney(s.totalProfit)+' $';
        document.getElementById(pfx+'profit-nofree').textContent=formatMoney(s.paidProfit)+' $';
        document.getElementById(pfx+'roi').textContent=formatPercent(s.roi);
        document.getElementById(pfx+'itm').textContent=formatPercent(s.itmRate);
        document.getElementById(pfx+'itm-count').textContent=s.itmCount+'x';
        document.getElementById(pfx+'cost').textContent=formatMoney(s.totalCost)+' $';
        document.getElementById(pfx+'prize').textContent=formatMoney(s.totalPrize)+' $';
        document.getElementById(pfx+'avg-percentile').textContent=s.avgPercentile===null?'-':formatPercent(s.avgPercentile);
      });
      document.getElementById('sum-all-games').textContent=statsAll.games;
      document.getElementById('sum-all-profit').textContent=formatMoney(statsAll.totalProfit)+' $';
      document.getElementById('sum-all-profit-nofree').textContent=formatMoney(statsAll.paidProfit)+' $';
      document.getElementById('sum-all-roi').textContent=formatPercent(statsAll.roi);
      document.getElementById('sum-all-itm').textContent=formatPercent(statsAll.itmRate);
      document.getElementById('sum-all-itm-count').textContent=statsAll.itmCount+'x';
      document.getElementById('sum-all-cost').textContent=formatMoney(statsAll.totalCost)+' $';
      document.getElementById('sum-all-prize').textContent=formatMoney(statsAll.totalPrize)+' $';
      document.getElementById('sum-all-avg-percentile').textContent=statsAll.avgPercentile===null?'-':formatPercent(statsAll.avgPercentile);
      renderPeriodSummary(); renderTourneyTypes();
      applySparkline(document.getElementById('sparkline-room'),document.getElementById('sparkline-room-needle'),document.getElementById('sparkline-room-text'),statsRoom,'ebben a teremben');
      applySparkline(document.getElementById('sparkline-all'),document.getElementById('sparkline-all-needle'),document.getElementById('sparkline-all-text'),statsAll,'összesen');
    }

    document.querySelectorAll('.tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        const t=tab.getAttribute('data-tab'); state.view=t;
        if(t==='888'||t==='gg'){state.room=t;const gt=document.getElementById('gameType');if(gt&&!editId)gt.value=t==='gg'?'SNG':'MTT';}
        saveState(state); render();
      });
    });

    document.getElementById('import-json-input').addEventListener('change',(e)=>{
      const file=e.target.files&&e.target.files[0]; if(!file)return;
      const reader=new FileReader();
      reader.onload=(ev)=>{
        try {
          const parsed=JSON.parse(ev.target.result);
          if(!parsed||!parsed.games)throw new Error('Hibás JSON szerkezet');
          const replace=confirm('OK = Lecserélés a fájlban lévő adatokra\nMégse = Egyesítés a meglévő adatokkal');
          if(replace){
            state={room:parsed.room||'888',view:parsed.view||'888',games:{'888':Array.isArray(parsed.games['888'])?parsed.games['888']:[],'gg':Array.isArray(parsed.games['gg'])?parsed.games['gg']:[]},baseBalances:parsed.baseBalances||null};
          } else {
            const ids=new Set([...state.games['888'].map(x=>x.id),...state.games['gg'].map(x=>x.id)]);
            ['888','gg'].forEach(r=>{(parsed.games[r]||[]).forEach(g=>{if(!ids.has(g.id))state.games[r].push(g);});});
          }
          if(!state.baseBalances){const p888=state.games['888'].reduce((s,g)=>s+(Number(g.profit)||0),0);const pgg=state.games['gg'].reduce((s,g)=>s+(Number(g.profit)||0),0);state.baseBalances={'888':+(DEFAULT_BALANCE['888']-p888).toFixed(2),'gg':+(DEFAULT_BALANCE['gg']-pgg).toFixed(2)};}
          saveState(state); render(); alert('Sikeres betöltés!');
        } catch(err){alert('Hiba a JSON betöltésekor: '+err.message);}
        finally{e.target.value='';}
      };
      reader.readAsText(file);
    });

    document.getElementById('tournament-form').addEventListener('submit',(e)=>{
      e.preventDefault(); document.getElementById('form-error').textContent='';
      const data=Object.fromEntries(new FormData(e.target).entries());
      if(!data.players||!data.position){document.getElementById('form-error').textContent='Kötelező a résztvevők száma és a saját helyezés.';return;}
      if(editId){
        const idx=state.games[state.room].findIndex(x=>x.id===editId);
        if(idx!==-1){const orig=state.games[state.room][idx];const updated=createGameEntry(state.room,data);updated.id=orig.id;updated.createdAt=orig.createdAt;state.games[state.room][idx]=updated;saveState(state);clearEditMode();render();return;}
      }
      state.games[state.room].push(createGameEntry(state.room,data)); saveState(state); clearEditMode(); render();
    });

    // Okos fájlmentés: iframe (Claude) → postMessage, PWA/standalone → Web Share API, fallback → data URI
    function saveFileToDevice(filename, blob) {
      const isEmbedded = window.parent && window.parent !== window;
      if (isEmbedded) {
        blob.arrayBuffer().then(data => {
          window.parent.postMessage({ type:'downloadFile', filename, data, mimeType: blob.type || 'application/octet-stream' });
        });
        return;
      }
      // PWA / Safari standalone – Web Share API (fájlmegosztás)
      if (typeof navigator.share === 'function') {
        const file = new File([blob], filename, { type: blob.type });
        const canShare = typeof navigator.canShare === 'function' ? navigator.canShare({ files:[file] }) : true;
        if (canShare) {
          navigator.share({ files:[file], title: filename }).catch(() => fallbackSave(filename, blob));
          return;
        }
      }
      fallbackSave(filename, blob);
    }
    function fallbackSave(filename, blob) {
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement('a');
        a.href = reader.result; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      };
      reader.readAsDataURL(blob);
    }

    document.getElementById('btn-export-json').addEventListener('click',()=>{
      saveFileToDevice('poker-tracker-backup.json', new Blob([JSON.stringify(state,null,2)], {type:'application/json'}));
    });

    document.getElementById('btn-download-app').addEventListener('click',()=>{
      saveFileToDevice('ptracker.html', new Blob(['<!DOCTYPE html>\n'+document.documentElement.outerHTML], {type:'text/html'}));
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', clearEditMode);

    document.addEventListener('DOMContentLoaded',()=>{
      installEdgeSwipeGuard();
      // Charts period filters
      document.querySelectorAll('.period-btn[data-period]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('.period-btn[data-period]').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active'); activePeriod=btn.getAttribute('data-period');
          if(state.view==='charts')renderCharts();
        });
      });
      document.querySelectorAll('.period-btn[data-nperiod]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          document.querySelectorAll('.period-btn[data-nperiod]').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active'); newChartsPeriod=btn.getAttribute('data-nperiod');
          if(state.view==='new-charts')renderNewCharts();
        });
      });
      ['cc-metric','cc-group','cc-room','cc-type','cc-from','cc-to'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.addEventListener('change',()=>{if(state.view==='new-charts')renderCustomChart();});
      });
      // Room filter inputs
      const filterMap={'rf-search':'search','rf-cost-mode':'costMode','rf-buyin-exact':'exact','rf-buyin-min':'min','rf-buyin-max':'max','rf-game-type':'gameType'};
      Object.entries(filterMap).forEach(([id,key])=>{
        const el=document.getElementById(id); if(!el)return;
        el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{roomFilters[key]=el.value;roomFilters.preset='';renderRoomTable();});
      });
      document.querySelectorAll('[data-filter-preset]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const preset=btn.getAttribute('data-filter-preset');
          Object.assign(roomFilters,{search:'',costMode:'all',exact:'',min:'',max:'',gameType:'all',preset});
          if(preset==='free')roomFilters.costMode='free';
          if(preset==='paid')roomFilters.costMode='paid';
          if(preset==='buyin025')Object.assign(roomFilters,{costMode:'exact',exact:'0.25'});
          if(preset==='buyin1plus')Object.assign(roomFilters,{costMode:'gte',min:'1'});
          if(preset==='sng6max025')Object.assign(roomFilters,{costMode:'exact',exact:'0.25',gameType:'SNG'});
          syncRoomFilterInputs(); renderRoomTable();
        });
      });
      const clearFilters=document.getElementById('rf-clear');
      if(clearFilters)clearFilters.addEventListener('click',()=>{Object.assign(roomFilters,{search:'',costMode:'all',exact:'',min:'',max:'',gameType:'all',preset:''});syncRoomFilterInputs();renderRoomTable();});
      const editBalBtn=document.getElementById('btn-edit-balance');
      if(editBalBtn)editBalBtn.addEventListener('click',()=>{
        const statsRoom=calcStats(state.games[state.room]);
        const current=((state.baseBalances?.[state.room]??0)+statsRoom.totalProfit);
        const input=prompt('Jelenlegi egyenleg ('+(state.room==='888'?'888poker':'GGPoker')+'):',current.toFixed(2));
        if(input===null)return;
        const v=parseFloat(input.replace(',','.'));
        if(isNaN(v)){alert('Érvénytelen szám');return;}
        if(!state.baseBalances)state.baseBalances={'888':0,'gg':0};
        state.baseBalances[state.room]=+(v-statsRoom.totalProfit).toFixed(2);
        saveState(state); render();
      });
      window.addEventListener('resize',()=>{if(state.view==='charts')renderCharts();if(state.view==='new-charts')renderNewCharts();});
      document.querySelectorAll('.table-wrapper').forEach(wrap=>{
        wrap.addEventListener('wheel',e=>{const canScrollX=wrap.scrollWidth>wrap.clientWidth;if(!canScrollX)return;if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){wrap.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
      });

      // FIX 3: Filter toggle button
      const btnToggleFilters=document.getElementById('btn-toggle-filters');
      if(btnToggleFilters){
        btnToggleFilters.addEventListener('click',()=>{
          const panel=document.getElementById('room-filter-panel');
          const arrow=document.getElementById('filter-toggle-arrow');
          const isHidden=panel.classList.contains('hidden');
          panel.classList.toggle('hidden',!isHidden);
          if(arrow) arrow.textContent=isHidden?'▼':'▶';
        });
      }

      // FIX 3: Saved filters event listeners
      renderSavedFilterDropdown();
      const savedFilterSel=document.getElementById('saved-filter-select');
      if(savedFilterSel){
        savedFilterSel.addEventListener('change',()=>{
          if(savedFilterSel.value) applySavedFilter(savedFilterSel.value);
        });
      }
      const btnSaveFilter=document.getElementById('btn-save-filter');
      if(btnSaveFilter){
        btnSaveFilter.addEventListener('click',()=>{
          const nameEl=document.getElementById('save-filter-name');
          const name=(nameEl?.value||'').trim();
          if(!name){if(nameEl)nameEl.focus();return;}
          if(saveCurrentFilter(name)){
            if(nameEl)nameEl.value='';
            const orig=btnSaveFilter.textContent;
            btnSaveFilter.textContent='✓ Elmentve!';
            setTimeout(()=>btnSaveFilter.textContent=orig,1500);
          }
        });
      }
      const btnDeleteSaved=document.getElementById('btn-delete-saved-filter');
      if(btnDeleteSaved){
        btnDeleteSaved.addEventListener('click',()=>{
          const sel=document.getElementById('saved-filter-select');
          if(!sel?.value)return;
          if(confirm('Törlöd a "'+sel.options[sel.selectedIndex]?.text+'" szűrőt?')){
            deleteSavedFilter(sel.value); sel.value='';
          }
        });
      }
    });

    function getLocalDateString(date=new Date()){
      const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
      return `${year}-${month}-${day}`;
    }
    function setTodayDate(){ const d=document.getElementById('date'); if(d)d.value=getLocalDateString(); }
    setTodayDate();
    render();
