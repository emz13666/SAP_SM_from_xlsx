// ==UserScript==
// @name         SAP SM: XLSX → Incident (Выполненные работы)
// @namespace    https://sapsm3.sap.metinvest.com/
// @version      1.56
// @description  Переносит строки из листа "Выполненные работы" в SAP SM как инциденты AIC_OB_INCIDENT
// @match        https://sapsm3.sap.metinvest.com/*
// @match        https://sapsm3ci.sap.metinvest.com/*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        GM_addStyle
// @grant        GM_info
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/emz13666/SAP_SM_from_xlsx/main/sap-sm-from-xlsx.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/SAP_SM_from_xlsx/main/sap-sm-from-xlsx.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ==================== ПЕРЕХВАТЧИК СЕТИ ====================
  (function installNetworkHook() {
    const hookFn = function() {
      if (window.__SM_NET_HOOKED__) return;
      window.__SM_NET_HOOKED__ = true;

      window.__SM_WAITERS__ = [];
      window.__SM_LAST_POST_TS__ = 0;
      window.__SM_NET_IDLE_MS__ = () => {
        if (!window.__SM_LAST_POST_TS__) return 999999;
        return Date.now() - window.__SM_LAST_POST_TS__;
      };

      function triggerWaiters(url) {
        if (!url) return;
        window.__SM_WAITERS__ = window.__SM_WAITERS__.filter(w => {
          if (url.includes(w.urlPart)) { w.resolve(); return false; }
          return true;
        });
      }

      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = async function(...args) {
          const url = args[0] ? args[0].toString() : '';
          const response = await origFetch.apply(this, args);
          if (url.indexOf('BSPWDApplication.do') >= 0) window.__SM_LAST_POST_TS__ = Date.now();
          triggerWaiters(url);
          return response;
        };
      }

      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(body) {
        const isSapPost = body && typeof body === 'string' && body.indexOf('htmlbevt_oid') >= 0;
        try {
          if (isSapPost) {
            const mOid = body.match(/htmlbevt_oid=([^&]+)/);
            const mTy  = body.match(/htmlbevt_ty=([^&]+)/);
            const mId  = body.match(/htmlbevt_id=([^&]+)/);
            if (mOid) {
              console.log('[SM][net] POST',
                'ty=' + decodeURIComponent(mTy ? mTy[1] : ''),
                'oid=' + decodeURIComponent(mOid[1]),
                'id='  + decodeURIComponent(mId ? mId[1] : ''));
            }
          }
        } catch (e) {}
        if (isSapPost) window.__SM_LAST_POST_TS__ = Date.now();
        this.addEventListener('load', function() {
          const url = this.responseURL || '';
          if (url.indexOf('BSPWDApplication.do') >= 0) window.__SM_LAST_POST_TS__ = Date.now();
          triggerWaiters(url);
        });
        return origSend.apply(this, arguments);
      };

      window.__SM_WAIT_FOR_NET__ = function(urlPart, timeoutMs) {
        return new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), timeoutMs);
          window.__SM_WAITERS__.push({
            urlPart: urlPart,
            resolve: () => { clearTimeout(timer); resolve(true); }
          });
        });
      };
    };

    function inject(doc, win) {
      if (!win) return;
      try {
        const script = doc.createElement('script');
        script.textContent = `(${hookFn.toString()})();`;
        (doc.head || doc.documentElement).appendChild(script);
        script.remove();
      } catch(e) {}
    }

    setInterval(() => {
      (function walk(doc, win) {
        inject(doc, win);
        try {
          doc.querySelectorAll('iframe,frame').forEach(fr => {
            try { if (fr.contentDocument) walk(fr.contentDocument, fr.contentWindow); } catch(e){}
          });
        } catch(e){}
      })(document, window);
    }, 1000);
  })();

  // ==================== ДИАГНОСТИКА ====================
  (function installDiagAny() {
    window.__SM_DIAG_ANY = function() {
      const out = [];
      (function walk(doc, win, depth) {
        try { out.push({ depth, url: win.location.href.slice(0, 120), title: doc.title }); }
        catch(e) { out.push({ depth, url: '?', title: '?' }); }
        try {
          doc.querySelectorAll('iframe,frame').forEach(fr => {
            try { if (fr.contentDocument) walk(fr.contentDocument, fr.contentWindow, depth + 1); } catch(e){}
          });
        } catch(e){}
      })(document, window, 0);
      console.table(out);
      return out;
    };
  })();

  if (window.top !== window.self) return;
  if (window.top.__SM_LOADED__) return;
  window.top.__SM_LOADED__ = true;
  if (document.getElementById('sm-panel')) return;

  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version)
    ? String(GM_info.script.version)
    : 'dev';

  const CFG = {
    sheetName: 'Выполненные работы',
    col: { A_date: 0, B_priem: 1, C_start: 2, D_end: 3, E_category: 4, F_object: 5, G_fault: 6, H_works: 7, I_sapCat: 8, J_system: 9, K_exec: 10, L_dept: 11, M_comment: 12 },
    guid: { category_otherSystems: '005056A081D31EEE96A83576BCEA81C6' },
    groups: { modular: 'MODULAR Поддержка Модулар', telecom: 'LGOK-Telekom ЛГОК: Связь' },
    modularSystems: ['Modular', 'КОБУС', 'Серверное оборудование', 'Серверное программное обеспечение'],
    status: { inProgress: 'E0002', solution: 'E0005' },
    fixed: { author: 'Общий ЛГОК', handler: 'Евгений Михайлович Зиновьев' },
    lsKey: 'sap_sm_xlsx_state',
    textAddTimeoutMs: 60000
  };

  GM_addStyle(`
    #sm-panel{position:fixed;top:8px;right:8px;width:520px;min-width:320px;z-index:999999;
      background:#fff;border:1px solid #888;border-radius:6px;font:12px/1.4 Arial,sans-serif;
      box-shadow:0 4px 12px rgba(0,0,0,.3)}
    #sm-panel.sm-collapsed{width:auto !important;min-width:320px}
    #sm-panel h3{margin:0;padding:6px 10px;background:#0a6ed1;color:#fff;border-radius:6px 6px 0 0;
      font-size:13px;cursor:move;user-select:none;display:flex;justify-content:space-between;
      align-items:center;gap:8px;white-space:nowrap}
    #sm-panel h3 .sm-hdr-btns{display:flex;gap:4px;flex-shrink:0}
    #sm-panel h3 .sm-hdr-btns button{background:transparent;border:0;color:#fff;cursor:pointer;
      font-size:14px;padding:0 6px;line-height:1}
    #sm-body{padding:8px 10px;max-height:68vh;overflow:auto}
    #sm-log{font:11px Consolas,monospace;background:#111;color:#0f0;padding:6px;height:210px;
      overflow:auto;border-radius:4px;white-space:pre-wrap}
    #sm-panel button{margin:2px 4px 2px 0;padding:4px 10px;cursor:pointer}
    #sm-panel progress{width:100%;height:14px}
    #sm-panel .row{margin:4px 0}
    #sm-panel input[type="number"]{width:90px;padding:2px 4px}
  `);

  const panel = document.createElement('div');
  panel.id = 'sm-panel';
  panel.dataset.version = SCRIPT_VERSION;
  panel.innerHTML = `
    <h3 id="sm-title">
      <span>SAP SM: XLSX → Incident (v${SCRIPT_VERSION})</span>
      <span class="sm-hdr-btns">
        <button id="sm-copy-log" title="Копировать лог в буфер обмена">📋</button>
        <button id="sm-clear-log" title="Очистить лог">🗑</button>
        <button id="sm-collapse" title="Свернуть">–</button>
      </span>
    </h3>
    <div id="sm-body">
      <div class="row">
        <input type="file" id="sm-file" accept=".xlsx,.xls"/>
        <div id="sm-fileName" style="margin-top:3px;color:#555;">Текущий файл: —</div>
        <div id="sm-savedInfo" style="margin-top:2px;color:#888;font-size:11px;"></div>
      </div>
      <div class="row">
        <label><span id="sm-startRowLabel">Начать со строки:</span>
          <input type="number" id="sm-startRow" min="1" value="1"/>
        </label>
      </div>
      <div class="row">
        <label><input type="checkbox" id="sm-step"/> пошагово (строки)</label>
        <label style="margin-left:10px;color:#0a6ed1;font-weight:bold;"><input type="checkbox" id="sm-debugActions"/> ДЕТАЛЬНАЯ ОТЛАДКА</label>
        <label style="margin-left:10px;"><input type="checkbox" id="sm-verboseLog"/> подробный лог</label>
      </div>
      <div class="row">
        <button id="sm-start" disabled>▶ Старт</button>
        <button id="sm-pause" disabled>⏸ Пауза</button>
        <button id="sm-continue" disabled>⏭ Продолжить</button>
        <button id="sm-stop"  disabled>⏹ Стоп</button>
      </div>
      <progress id="sm-progress" value="0" max="0"></progress>
      <div id="sm-stat" class="row">Ожидание файла…</div>
      <div id="sm-log"></div>
    </div>`;
  document.body.appendChild(panel);

  const $ = (s) => panel.querySelector(s);
  const ui = {
    file: $('#sm-file'), fileName: $('#sm-fileName'), savedInfo: $('#sm-savedInfo'),
    startRow: $('#sm-startRow'), startRowLabel: $('#sm-startRowLabel'),
    step: $('#sm-step'), debugActions: $('#sm-debugActions'), verboseLog: $('#sm-verboseLog'),
    start: $('#sm-start'), pause: $('#sm-pause'), cont: $('#sm-continue'), stop: $('#sm-stop'),
    prog: $('#sm-progress'), stat: $('#sm-stat'), log: $('#sm-log'), title: $('#sm-title'),
  };

  (function () {
    const body = $('#sm-body'); const btn = $('#sm-collapse'); let collapsed = false;
    btn.addEventListener('click', () => {
      collapsed = !collapsed; body.style.display = collapsed ? 'none' : 'block';
      btn.textContent = collapsed ? '+' : '–'; panel.classList.toggle('sm-collapsed', collapsed);
    });
    $('#sm-clear-log').addEventListener('click', () => { ui.log.innerHTML = ''; });
  })();

  $('#sm-copy-log').addEventListener('click', async () => {
    const text = ui.log.textContent || '';
    if (!text) { log('Лог пуст — нечего копировать.'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        log('📋 Лог скопирован в буфер обмена.');
        return;
      }
      throw new Error('clipboard API недоступен');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        const ok2 = document.execCommand('copy');
        ta.remove();
        if (ok2) log('📋 Лог скопирован (fallback).');
        else log('📋 Не удалось скопировать: ' + e.message, 'color:#f88');
      } catch (e2) {
        log('📋 Не удалось скопировать: ' + e2.message, 'color:#f88');
      }
    }
  });

  (function makeDraggable() {
    let dragging = false, dx = 0, dy = 0;
    ui.title.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; const r = panel.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      let x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth,  e.clientX - dx));
      let y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ==================== ЛОГИ ====================
  function log(msg, cls='') {
    const d = new Date();
    const t = d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
    const esc = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    ui.log.insertAdjacentHTML('beforeend', `<span style="${cls}">[${t}] ${esc}\n</span>`);
    ui.log.scrollTop = ui.log.scrollHeight; console.log('[SM]', msg);
  }
  function dbg(msg, cls='') {
    if (!ui.verboseLog || !ui.verboseLog.checked) return;
    log(msg, cls);
  }
  const err  = (m) => log(m, 'color:#f88');
  const warn = (m) => log(m, 'color:#ff0');
  const ok   = (m) => log(m, 'color:#8f8');

  function warnItem(m) { state.stats.warn++; warn(m); updateStat(); }

  function updateStat() {
    const cur = state.rows[state.idx];
    const excel = cur ? `Excel#${cur.excelRowNum}` : '—';
    const pos = Math.min(state.idx + 1, state.rows.length);
    ui.stat.textContent = `Обработка ${pos} / ${state.rows.length} (${excel}) — ✅ ${state.stats.ok} / ⚠ ${state.stats.warn} / ✖ ${state.stats.err}`;
  }

  function logPartners(prefix = '') {
    const getVal = (el) => {
      if (!el) return '—';
      if (el.value !== undefined && el.value !== null) return el.value;
      return (el.textContent || '').trim() || '—';
    };
    const f2 = findEl('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_02');
    const f3 = findEl('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_03');
    const f4 = findEl('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_04');
    log(`    [Состояние полей] ${prefix}`);
    log(`      Автор: "${getVal(f2)}"`);
    log(`      Группа: "${getVal(f3)}"`);
    log(`      Обработчик: "${getVal(f4)}"`);
  }

  async function debugPause(msg) {
    if (!ui.debugActions.checked) return;
    checkStop();
    logPartners(`Перед паузой: ${msg}`);
    ui.cont.disabled = false;
    warn(`⏸ ПАУЗА (Действие): ${msg}. Нажмите «Продолжить».`);
    await new Promise(resolve => {
      const finish = () => { ui.cont.removeEventListener('click', onCont); clearInterval(stopPoll); ui.cont.disabled = true; resolve(); };
      const onCont = () => finish();
      ui.cont.addEventListener('click', onCont);
      const stopPoll = setInterval(() => { if (state.stopped) finish(); }, 200);
    });
    checkStop();
  }

  function walkFrames(onEach, rootDoc, rootWin, depth) {
    rootDoc = rootDoc || document; rootWin = rootWin || window; depth = depth || 0;
    try { onEach(rootDoc, rootWin, depth); } catch (e) { console.warn('[SM] onEach:', e); }
    let frames; try { frames = rootDoc.querySelectorAll('iframe, frame'); } catch (e) { return; }
    for (const fr of frames) {
      let w, d;
      try { w = fr.contentWindow; } catch (e) { continue; }
      try { d = fr.contentDocument || (w && w.document); } catch (e) { continue; }
      if (!d) continue;
      walkFrames(onEach, d, w, depth + 1);
    }
  }

  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function findInFramesExact(id) {
    let firstMatch = null, visibleMatch = null;
    walkFrames((doc, win, depth) => {
      if (visibleMatch) return;
      let el; try { el = doc.getElementById(id); } catch (e) { return; }
      if (!el) return;
      const rec = { doc, win, el, depth };
      if (!firstMatch) firstMatch = rec;
      if (isVisible(el)) visibleMatch = rec;
    });
    return visibleMatch || firstMatch;
  }

  function findInFramesRegex(re) {
    let firstMatch = null, visibleMatch = null;
    walkFrames((doc, win, depth) => {
      if (visibleMatch) return;
      let els; try { els = doc.querySelectorAll('[id]'); } catch (e) { return; }
      for (const el of els) {
        if (!re.test(el.id)) continue;
        const rec = { doc, win, el, depth };
        if (!firstMatch) firstMatch = rec;
        if (isVisible(el)) { visibleMatch = rec; return; }
      }
    });
    return visibleMatch || firstMatch;
  }

  function findInFrames(id) {
    const exact = findInFramesExact(id);
    if (exact) return exact;
    const stripped = String(id).replace(/^C\d+(?:_[WV]\d+)+_/, '');
    if (stripped === id) return null;
    const re = new RegExp('^C\\d+(?:_[WV]\\d+)+_' + escapeRegex(stripped) + '$');
    return findInFramesRegex(re);
  }

  function findEl(id) { const r = findInFrames(id); return r ? r.el : null; }

  // ==================== ХЕЛПЕРЫ ТЕКУЩЕГО ФРЕЙМА ====================
  function findInDoc(doc, id) {
    if (!doc) return null;
    try { const el = doc.getElementById(id); if (el) return el; } catch (e) {}
    const stripped = String(id).replace(/^C\d+(?:_[WV]\d+)+_/, '');
    if (stripped === id) return null;
    const re = new RegExp('^C\\d+(?:_[WV]\\d+)+_' + escapeRegex(stripped) + '$');
    let all; try { all = doc.querySelectorAll('[id]'); } catch (e) { return null; }
    for (const el of all) if (re.test(el.id)) return el;
    return null;
  }

  // v1.55: Улучшенный поиск формы (учитывает View Mode, где текст лежит в textContent)
  function getFormDoc(expectedDesc) {
    let bestDoc = null;
    let maxScore = -1;

    walkFrames((doc, win, depth) => {
      if (win && win.frameElement) {
        try {
          const rect = win.frameElement.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return; // игнорируем скрытые iframe
        } catch (e) { return; }
      }

      let score = 0;
      const editBtn = findInDoc(doc, 'C32_W39_V41_EDIT');
      const saveBtn = findInDoc(doc, 'C32_W39_V41_SAVE');
      
      if (editBtn && isVisible(editBtn)) score += 10;
      if (saveBtn && isVisible(saveBtn)) score += 10;
      
      const descEl = findInDoc(doc, 'C32_W39_V41_V52_btadminh_struct.description');
      if (descEl && isVisible(descEl)) {
        let text = descEl.value;
        if (text === undefined || text === null) text = descEl.textContent || descEl.innerText || '';
        text = String(text).trim();
        
        if (expectedDesc) {
          const exp = String(expectedDesc).trim();
          if (exp && text && (text.includes(exp.substring(0, 15)) || exp.includes(text.substring(0, 15)))) {
            score += 5;
          }
        } else {
          score += 5;
        }
      }
      
      try {
        if (doc.title && expectedDesc && doc.title.includes(expectedDesc.substring(0, 15))) {
          score += 3;
        }
      } catch(e) {}

      if (score > maxScore && score > 0) {
        maxScore = score;
        bestDoc = doc;
      }
    });
    return bestDoc;
  }

  function parseDropdownItemsInDoc(doc, itemsId) {
    const byId = {};
    if (!doc) return { byId };
    const el = findInDoc(doc, itemsId);
    if (!el) return { byId };
    const html = el.innerHTML || '';
    const re = /a\["([^"]+)"\]\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const key = m[1];
      const text = (m[2] || '')
        .replace(/&nbsp;/g, ' ').replace(/&minus;/g, '-').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
      if (!key || !text || text === ' ') continue;
      byId[key] = text;
    }
    return { byId };
  }

  function getLabelInFormFrame(itemsId, key, expectedDesc) {
    const doc = getFormDoc(expectedDesc);
    if (!doc) return null;
    return parseDropdownItemsInDoc(doc, itemsId).byId[key] || null;
  }
  // ========================================================================

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = el.ownerDocument.defaultView.getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    } catch (e) { return false; }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  class SMStoppedError extends Error {
    constructor() { super('Остановлено пользователем'); this.name = 'SMStoppedError'; }
  }
  function checkStop() { if (state.stopped) throw new SMStoppedError(); }

  async function waitForNetIdle(idleMs = 2000, timeoutMs = 30000) {
    const t0 = Date.now();
    let lastLog = 0;
    while (Date.now() - t0 < timeoutMs) {
      checkStop();
      let minIdle = 999999;
      walkFrames((doc, win) => {
        try {
          if (win && typeof win.__SM_NET_IDLE_MS__ === 'function') {
            const idle = win.__SM_NET_IDLE_MS__();
            if (typeof idle === 'number' && idle < minIdle) minIdle = idle;
          }
        } catch (e) {}
      });
      
      if (minIdle >= idleMs) return true;
      if (Date.now() - t0 - lastLog > 3000) {
        lastLog = Date.now() - t0;
        dbg(`    … ждём сетевой тишины (minIdle=${minIdle} мс < ${idleMs})`);
      }
      await sleep(200);
    }
    dbg(`    ⚠ сетевой тишины не дождались за ${timeoutMs} мс`);
    return false;
  }

  function realClick(el) {
    if (!el) return;
    const win = el.ownerDocument.defaultView || window;
    const opts = { bubbles: true, cancelable: true, view: win, button: 0 };
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup',   opts)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click',     opts)); } catch (e) {}
  }

  function nativeSubmitButton(btn, evtType, oid, id, cnt) {
    if (!btn) { dbg('[nativeSubmit] кнопка не найдена: ' + oid, 'color:#ff0'); return false; }
    const win = btn.ownerDocument.defaultView;
    const oc = (btn.getAttribute('onclick') || '').trim();
    const unesc = (s) => String(s).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

    const mLib = oc.match(/htmlbSubmitLib\s*\(\s*'htmlb'\s*,\s*this\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*([^,]+?)\s*,\s*'([^']*)'\s*,\s*(\d+)/);
    if (mLib && typeof win.htmlbSubmitLib === 'function') {
      const [_, evt, frm, oidRaw, idRaw, cntRaw] = mLib;
      const oidVal = oidRaw === 'null' ? null : unesc(oidRaw.replace(/^'|'$/g, ''));
      const idVal  = unesc(idRaw);
      try {
        win.htmlbSubmitLib('htmlb', btn, evt, frm, oidVal, idVal, parseInt(cntRaw, 10));
        dbg(`    [nativeSubmit] htmlbSubmitLib: ${evt} | ${frm} | oid=${oidVal} | id=${idVal}`);
        return true;
      } catch (e) { dbg('[nativeSubmit] htmlbSubmitLib error: ' + e.message, 'color:#ff0'); }
    }

    const mSL = oc.match(/htmlbSL\s*\(\s*this\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
    if (mSL) {
      const [_, n, evtId, cntRaw] = mSL;
      try { btn.focus(); } catch (e) {}
      try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}
      try {
        if (typeof btn.click === 'function') {
          btn.click();
          dbg(`    [nativeSubmit] btn.click() for htmlbSL: ${oid} | ${evtId} | n=${n}`);
          return true;
        }
      } catch (e) {
        dbg('[nativeSubmit] btn.click() error: ' + e.message, 'color:#ff0');
      }
      realClick(btn);
      dbg(`    [nativeSubmit] realClick(btn) for htmlbSL: ${oid} | ${evtId} | n=${n}`);
      return true;
    }

    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    realClick(btn);
    dbg(`    [nativeSubmit] realClick(btn): ${oid}`);
    return true;
  }

  function formatDate(val) {
    if (!val) return '';
    let d;
    if (val instanceof Date) d = val; else d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  }

  async function setFieldValue(id, value, isLookup = false) {
    const r = findInFrames(id);
    if (!r) { dbg('setFieldValue: нет #' + id, 'color:#ff0'); return false; }
    const el = r.el;
    const win = r.win;

    if (el.disabled || el.readOnly) {
      dbg(`setFieldValue: #${id.split('/').pop()} disabled/readOnly — пропускаю`, 'color:#ff0');
      return false;
    }

    if (id.includes('description')) value = value.substring(0, 40);
    try { el.focus(); } catch (e) {}

    if (isLookup) {
      el.value = value;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e){}

      const pNet = win.__SM_WAIT_FOR_NET__
        ? win.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;

      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
      } catch(e){}

      if (pNet) {
        const netOk = await pNet;
        if (!netOk) dbg(`  ⚠ lookup #${id.split('/').pop()}: POST не дождались`, 'color:#ff0');
      }

      await waitForCondition(
        () => el.value && !el.value.includes('отсутствует'),
        5000, 50, `F4 #${id.split('/').pop()}`);

      if (!el.value || el.value.includes('отсутствует')) {
        dbg(`  ⚠ lookup #${id.split('/').pop()} не выбрался (значение "${el.value}")`, 'color:#ff0');
        return false;
      }
      dbg(`    [F4] ✔ #${id.split('/').pop()} = "${el.value}"`);
    } else {
      el.value = value;
      try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}

      const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');
      if (norm(el.value) !== norm(value)) {
        dbg(`  ⚠ #${id.split('/').pop()}: записано "${norm(el.value).slice(0,60)}", ожидалось "${norm(value).slice(0,60)}"`, 'color:#ff0');
        return false;
      }
      const preview = el.value.length > 80 ? el.value.slice(0, 80) + '…' : el.value;
      dbg(`    [field] ✔ #${id.split('/').pop()} = "${String(preview).replace(/\n/g, '⏎')}"`);
    }
    return true;
  }

  function setElementValue(el, value, fireInput = false, fireChange = false) {
    if (!el) return false;
    try { el.focus(); } catch(e) {}
    el.value = value;
    if (fireInput)  { try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch(e) {} }
    if (fireChange) { try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {} }
    const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');
    return norm(el.value) === norm(value);
  }

  // Строгий поиск поля решения. Игнорируем журнал (C27_...).
  function findSolutionTextarea(preferredDoc) {
    let bestMatch = null;

    walkFrames((doc, win, depth) => {
      if (bestMatch && bestMatch.doc === preferredDoc) return; // Если уже нашли в целевом фрейме

      let tas; try { tas = doc.querySelectorAll('textarea'); } catch(e) { return; }
      for (const ta of tas) {
        if (!isVisible(ta)) continue;
        const id = ta.id || '';
        
        // Отсекаем журнал (C27) и ищем только поле решения (C38 или text_longtext)
        if (id.includes('text_longtext') && !id.includes('C27_W84_V85_V87')) {
          if (doc === preferredDoc) {
             bestMatch = { doc, win, el: ta, depth };
             return;
          }
          if (!bestMatch) {
             bestMatch = { doc, win, el: ta, depth };
          }
        }
      }
    });

    if (bestMatch) return { r: bestMatch, id: bestMatch.el.id };
    return { r: null, id: null };
  }

  function dumpDiagnostics(label) {
    const textareas = [], susEls = [], actionBtns = [];
    walkFrames((doc, win, depth) => {
      try {
        const tas = doc.querySelectorAll('textarea');
        for (const ta of tas) {
          if (!isVisible(ta)) continue;
          textareas.push({ id: ta.id || '(no-id)', v: (ta.value || '').slice(0, 40), depth });
        }
        const ses = doc.querySelectorAll('[id*="_SUSO"], [id*="_SUSI"], [id*="_SUSN"], [id*="_TextAdd"], [id*="_text_longtext"]');
        for (const el of ses) {
          if (!isVisible(el)) continue;
          susEls.push({ id: el.id, tag: el.tagName.toLowerCase(), depth });
        }
        const btns = doc.querySelectorAll('button, a');
        for (const el of btns) {
          if (!isVisible(el)) continue;
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (/сохран|обработ|верну|назад|закры|отмен|решен/i.test(txt)) {
            actionBtns.push({ id: el.id || '(no-id)', text: txt.slice(0, 50), depth });
          }
        }
      } catch(e) {}
    });
    warn(`  [diag ${label}] textareas(visible) = ${JSON.stringify(textareas)}`);
    warn(`  [diag ${label}] _SUS*/_TextAdd/_longtext = ${JSON.stringify(susEls)}`);
    warn(`  [diag ${label}] action buttons = ${JSON.stringify(actionBtns)}`);
  }

  function isIncidentFormVisible() {
    const r = findInFrames('C32_W39_V41_V52_btadminh_struct.description');
    return !!(r && isVisible(r.el));
  }

  function parseDropdownItems(itemsId) {
    const r = findInFrames(itemsId);
    if (!r) return { byId: {} };
    const html = r.el.innerHTML || '';
    const byId = {};
    const re = /a\["([^"]+)"\]\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const key = m[1];
      const text = (m[2] || '')
        .replace(/&nbsp;/g, ' ').replace(/&minus;/g, '-').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
      if (!key || !text || text === ' ') continue;
      byId[key] = text;
    }
    return { byId };
  }

  function getLabelByKey(itemsId, key) { return parseDropdownItems(itemsId).byId[key] || null; }

  function findGuidByNum(itemsId, num) {
    const byId = parseDropdownItems(itemsId).byId;
    for (const [key, text] of Object.entries(byId)) {
      const m = text.match(/^(\d+(?:\.\d+)?)\./);
      if (m && m[1] === num) return key;
    }
    return null;
  }

  async function setDropdownByLabel(id, label, preferredDoc) {
    let r;
    if (preferredDoc) {
      const el = findInDoc(preferredDoc, id);
      if (!el) { dbg(`setDropdownByLabel: нет #${id.split('/').pop()} в formDoc`, 'color:#ff0'); return false; }
      r = { doc: preferredDoc, el, win: preferredDoc.defaultView, depth: 0 };
    } else {
      r = findInFrames(id);
    }
    if (!r) { dbg('setDropdownByLabel: нет #' + id.split('/').pop(), 'color:#ff0'); return false; }
    const el = r.el;

    if (el.disabled) { dbg(`setDropdownByLabel: #${id.split('/').pop()} disabled`, 'color:#ff0'); return false; }

    if ((el.value || '').trim() === label) {
      dbg(`    [dropdown] #${id.split('/').pop()} уже = "${label}"`);
      return true;
    }

    const btn = preferredDoc ? findInDoc(preferredDoc, id + '-btn') : findEl(id + '-btn');
    if (!btn) { dbg(`setDropdownByLabel: нет #${id.split('/').pop()}-btn`, 'color:#ff0'); return false; }

    if (!isVisible(btn)) {
      dbg(`setDropdownByLabel: #${id.split('/').pop()}-btn существует но НЕВИДИМ (форма улетела?)`, 'color:#ff0');
      return false;
    }

    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    realClick(btn);

    let target = null;
    const appeared = await waitForCondition(() => {
      let anchors; try { anchors = r.doc.querySelectorAll('a'); } catch(e) { return false; }
      for (const a of anchors) {
        if (!a.offsetParent) continue;
        if ((a.textContent || '').replace(/\s+/g, ' ').trim() === label) { target = a; return true; }
      }
      return false;
    }, 8000, 50, `меню "${label}"`);

    if (!appeared) {
      const sample = Array.from(r.doc.querySelectorAll('a')).filter(a => a.offsetParent)
        .slice(0, 12).map(a => JSON.stringify((a.textContent || '').trim().slice(0, 50)));
      dbg(`    [dropdown] пункт "${label}" не появился за 8 с. Видимые <A>: ${sample.join(', ')}`, 'color:#ff0');
      return false;
    }

    const win = r.win;
    const pNet = win.__SM_WAIT_FOR_NET__
      ? win.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : Promise.resolve(false);

    dbg(`    [dropdown] клик по <A>: "${(target.textContent||'').trim()}"`);
    realClick(target);

    const netOk = await pNet;
    if (!netOk) dbg(`    [dropdown] POST BSPWDApplication.do не дождались`, 'color:#ff0');

    const val = (el.value || '').trim();
    if (val === label) {
      dbg(`    [dropdown] ✔ #${id.split('/').pop()} = "${val}"`);
      return true;
    }
    dbg(`    [dropdown] #${id.split('/').pop()}: значение "${val}" ≠ ожидаемому "${label}"`, 'color:#ff0');
    return false;
  }

  async function waitForCondition(fn, timeoutMs = 8000, pollMs = 50, label = '') {
    const t0 = Date.now();
    let last = 0;
    while (Date.now() - t0 < timeoutMs) {
      checkStop();
      try { if (fn()) return true; } catch(e){}
      if (Date.now() - t0 - last > 2000) {
        last = Date.now() - t0;
        dbg(`    … ждём ${label || 'условие'} (${Math.round(last/1000)} с)`);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
  }

  async function fillLongTextWithRetries(value, attempts = 3, label = 'text') {
    for (let i = 1; i <= attempts; i++) {
      const found = await waitForCondition(
        () => findInFrames('C38_W62_V63_V65_text_longtext') !== null,
        5000, 100, `${label} text_longtext (попытка ${i}/${attempts})`);
      if (!found) { dbg(`  [${label}] поле не появилось за 5 с`); diagTextLongtext(); continue; }
      if (await setFieldValue('C38_W62_V63_V65_text_longtext', value)) {
        dbg(`  [${label}] ✔ записано (попытка ${i}/${attempts})`);
        return true;
      }
      dbg(`  [${label}] setFieldValue вернул false (попытка ${i}/${attempts})`);
      await sleep(1000);
    }
    return false;
  }

  function diagTextLongtext() {
    const parts = [];
    walkFrames((doc) => {
      try {
        const all = doc.querySelectorAll('[id^="C38_W62_V63_V65_"]');
        for (const el of all) parts.push(el.id);
      } catch(e) {}
    });
    if (parts.length) dbg(`    [diag] C38_* : ${parts.slice(0, 15).join(' | ')}`);
    else dbg(`    [diag] нет ни одного C38_* в DOM`);
  }

  async function waitForVisible(id, timeoutMs = 60000, label = '') {
    const t0 = Date.now(); let lastLog = 0;
    while (Date.now() - t0 < timeoutMs) {
      checkStop();
      const r = findInFrames(id);
      if (r && isVisible(r.el)) return r.el;
      const elapsed = Date.now() - t0;
      if (elapsed - lastLog > 5000) {
        lastLog = elapsed;
        dbg(`    … ждём ${label || '#' + id} (${Math.round(elapsed/1000)} с)`);
      }
      await sleep(300);
    }
    return null;
  }

  function findVisibleCreateButton() {
    let found = null;
    walkFrames((doc) => {
      if (found) return;
      const nodes = doc.querySelectorAll('a, button');
      for (const n of nodes) {
        if (!isVisible(n)) continue;
        const txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt === 'Создать сообщение') {
          const oc = n.getAttribute('onclick') || '';
          if (oc.includes('htmlbSL') || oc.includes('htmlbSubmitLib') || oc.includes('htmlbSubmit')) { found = n; return; }
        }
      }
    });
    return found;
  }

  function findTextAddButton(preferredDoc) {
    if (preferredDoc) {
      let el = findInDoc(preferredDoc, 'C38_W62_V63_V65_TextAdd__SUSO')
            || findInDoc(preferredDoc, 'C38_W62_V63_V65_TextAdd')
            || findInDoc(preferredDoc, 'C38_W62_V63_V65_TextAdd__items____SUSO_btn');
      if (el) return el;
      const nodes = preferredDoc.querySelectorAll('[onclick*="thtmlbDynamenuCreate"], [onmousedown*="thtmlbDynamenuCreate"]');
      for (const n of nodes) {
        if (/TextAdd/i.test(n.getAttribute('onclick') || n.getAttribute('onmousedown') || '')) return n;
      }
      const spans = preferredDoc.querySelectorAll('a,button,span');
      for (const n of spans) if ((n.textContent || '').trim() === 'Добавить текст') return n;
    }

    let el = findEl('C38_W62_V63_V65_TextAdd__SUSO')
          || findEl('C38_W62_V63_V65_TextAdd')
          || findEl('C38_W62_V63_V65_TextAdd__items____SUSO_btn');
    if (el) return el;
    let found = null;
    walkFrames((doc) => {
      if (found) return;
      const nodes = doc.querySelectorAll('[onclick*="thtmlbDynamenuCreate"], [onmousedown*="thtmlbDynamenuCreate"]');
      for (const n of nodes) {
        if (/TextAdd/i.test(n.getAttribute('onclick') || n.getAttribute('onmousedown') || '')) { found = n; return; }
      }
    });
    if (found) return found;
    return findElByText('Добавить текст', 'a,button,span');
  }

  function findElByText(text, sel) {
    let found = null;
    walkFrames((doc) => {
      if (found) return;
      const nodes = doc.querySelectorAll(sel || '*');
      for (const n of nodes) if ((n.textContent || '').trim() === text) { found = n; return; }
    });
    return found;
  }

  // ==================== СОСТОЯНИЕ ====================
  const state = {
    rows: [], idx: 0, running: false, paused: false, stopped: false,
    stats: { ok: 0, warn: 0, err: 0 },
    fileBuffer: null, fileName: null, parsedFrom: null,
    lastFilledExcelRow: null, totalFilled: 0,
    allRows: null,
    currentDesc: ''
  };

  function loadSavedState() {
    try {
      const raw = localStorage.getItem(CFG.lsKey);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || !obj.fileName) return null;
      return obj;
    } catch (e) { return null; }
  }

  function saveState(fileName, lastExcelRow) {
    if (!fileName) return;
    try { localStorage.setItem(CFG.lsKey, JSON.stringify({ fileName, lastExcelRow })); } catch (e) {}
  }

  function refreshSavedInfo(fileName) {
    const saved = loadSavedState();
    if (!saved) { ui.savedInfo.textContent = ''; return; }
    if (fileName && saved.fileName === fileName) {
      ui.savedInfo.textContent = `В LocalStorage: этот файл, последняя успешная строка Excel#${saved.lastExcelRow}.`;
    } else {
      ui.savedInfo.textContent = `В LocalStorage: другой файл (${saved.fileName}), строка Excel#${saved.lastExcelRow}. Подсказка не применится.`;
    }
  }

  function parseXlsxBuffer(buffer) {
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true, dense: true, sheets: CFG.sheetName });
    const ws = wb.Sheets[CFG.sheetName];
    if (!ws) throw new Error(`Лист "${CFG.sheetName}" не найден`);
    const ref = ws['!ref'];
    if (!ref) return { allRows: [], totalFilled: 0, lastFilled: 0 };
    const range = XLSX.utils.decode_range(ref);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
    const allRows = [];
    for (let i = 0; i < aoa.length; i++) {
      const excelRowNum = range.s.r + i + 1;
      if (excelRowNum === 1) continue;
      const r = aoa[i];
      let hasData = false;
      for (let c = 0; c <= CFG.col.K_exec; c++) if (String(r[c] ?? '').trim()) { hasData = true; break; }
      if (!hasData) continue;
      allRows.push({ excelRowNum, cells: r });
    }
    const totalFilled = allRows.length;
    const lastFilled = totalFilled ? allRows[totalFilled - 1].excelRowNum : 0;
    return { allRows, totalFilled, lastFilled };
  }

  function filterRowsFrom(allRows, fromExcelRow) {
    const from = Math.max(1, parseInt(fromExcelRow, 10) || 1);
    return from > 1 ? allRows.filter(x => x.excelRowNum >= from) : allRows.slice();
  }

  ui.file.addEventListener('click', () => { ui.file.value = ''; });

  ui.file.addEventListener('change', async (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) { input.value = ''; return; }
    if (state.running) { warn('Идёт прогон — сначала «⏹ Стоп», затем выбирайте файл.'); input.value = ''; return; }

    ui.fileName.textContent = 'Текущий файл: ' + f.name;

    try { state.fileBuffer = await f.arrayBuffer(); }
    catch (ex) { err('Ошибка чтения файла: ' + ex.message); input.value = ''; return; }

    ui.start.textContent = '▶ Чтение файла…';
    log('Читаю файл…');
    await sleep(50);

    let info;
    try { info = parseXlsxBuffer(state.fileBuffer); }
    catch (ex) {
      ui.start.textContent = '▶ Старт';
      err('Ошибка чтения XLSX: ' + ex.message);
      input.value = '';
      return;
    }

    state.allRows = info.allRows;
    ui.start.textContent = '▶ Старт';

    const oldName = state.fileName;
    const newName = f.name;
    const fileChanged = oldName !== newName;
    state.fileName = newName;

    const saved = loadSavedState();
    const savedMatches = saved && saved.fileName === newName;
    const lastSavedExcel = savedMatches ? (Number(saved.lastExcelRow) || 0) : 0;

    let suggestedStart = 1;
    if (lastSavedExcel > 0 && info.totalFilled) {
      const next = info.allRows.find(r => r.excelRowNum > lastSavedExcel);
      suggestedStart = next ? next.excelRowNum : lastSavedExcel + 1;
    }

    if (!info.totalFilled) {
      warn(`Лист "${CFG.sheetName}" пуст (нет заполненных строк).`);
      state.rows = []; state.parsedFrom = null; state.totalFilled = 0; state.lastFilledExcelRow = 0; state.idx = 0;
      ui.prog.max = 0; ui.prog.value = 0; ui.start.disabled = true;
      refreshSavedInfo(newName); input.value = ''; return;
    }

    if (fileChanged) {
      ui.startRow.value = suggestedStart;
      log(`Файл сменился → «Начать со строки» = ${suggestedStart}${savedMatches ? ' (из LocalStorage)' : ''}.`);
    } else {
      const curVal = String(ui.startRow.value || '').trim();
      if (curVal === '' || curVal === '1') {
        ui.startRow.value = suggestedStart;
        if (savedMatches) log(`Продолжаем с Excel#${suggestedStart} (из LocalStorage).`);
      }
    }

    const effectiveStart = Math.max(1, parseInt(ui.startRow.value, 10) || 1);
    state.rows = filterRowsFrom(info.allRows, effectiveStart);
    state.parsedFrom = effectiveStart;
    state.totalFilled = info.totalFilled;
    state.lastFilledExcelRow = info.lastFilled;
    state.idx = 0;
    state.stats = { ok: 0, warn: 0, err: 0 };

    ui.prog.max = state.rows.length;
    ui.prog.value = 0;
    ui.start.disabled = state.rows.length === 0;

    refreshSavedInfo(newName);

    if (state.rows.length) {
      ui.stat.textContent = `В файле заполненных: ${info.totalFilled}. Загружено: ${state.rows.length} (Excel#${effectiveStart}..#${info.lastFilled}).`;
      log(`Файл прочитан: заполненных ${info.totalFilled}. Загружено ${state.rows.length} (с Excel#${effectiveStart} до #${info.lastFilled}).`);
    } else {
      ui.stat.textContent = `В файле заполненных: ${info.totalFilled}. Старт с Excel#${effectiveStart} — попадает за пределы данных.`;
      warn(`Нет строк для обработки: старт Excel#${effectiveStart} > последней заполненной #${info.lastFilled}.`);
    }
    input.value = '';
  });

  function parseRow(cells) {
    const c = CFG.col;
    const s = (i) => String(cells[i] ?? '').trim();
    const desc = [s(c.F_object), s(c.G_fault)].filter(Boolean).join('-');
    let num = '';
    const iVal = s(c.I_sapCat);
    const dash = iVal.lastIndexOf('-');
    if (dash >= 0) num = iVal.substring(dash + 1).trim();
    num = num.replace(/,/g, '.');
    const dA = formatDate(cells[c.A_date]);
    const dD = formatDate(cells[c.D_end]);
    const headBefore = [dA, s(c.B_priem)].filter(Boolean).join(' ');
    const bodyBefore = [s(c.E_category), s(c.F_object), s(c.G_fault)].filter(Boolean).join(' ');
    const longTextBefore = [headBefore, bodyBefore].filter(Boolean).join('\n');
    const headSol = [dA, dD].filter(Boolean).join(' ');
    const worksSol = s(c.H_works);
    const execSol  = s(c.K_exec);
    const longTextSolution = [headSol, worksSol, execSol].filter(Boolean).join('\n');
    const system = s(c.J_system);
    return { desc, num, longTextBefore, longTextSolution, raw: cells, iVal, system };
  }

  // ==================== ШАГ 0 ====================
  async function step0_openForm() {
    log('Шаг 0.1: ждём интерфейс SAP…');
    let homeEl = await waitForVisible('C4_W16_V17_SM-SP-HOME', 60000, '«Первая страница»');
    if (!homeEl) throw new Error('Интерфейс SAP не загрузился');
    ok('  ✔ интерфейс найден');

    const preBtn = findVisibleCreateButton();
    if (preBtn) {
      log('Шаг 0.2: «Первая страница» — уже на главной, Home пропускаю');
      ok('  ✔ «Первая страница»');
    } else {
      log('Шаг 0.2: «Первая страница»…');
      const homeLink = findEl('C4_W16_V17_SM-SP-HOME');
      if (nativeSubmitButton(homeLink, 'htmlb:link:click:0', 'C4_W16_V17_SM-SP-HOME', 'SM-SPHO-WC', 0)) {
        const homeOk = await waitForCondition(() => !!findVisibleCreateButton(), 20000, 200, 'переход на главную (0.2)');
        if (homeOk) ok('  ✔ «Первая страница»');
        else warn('  ⚠ 0.2: главная не загрузилась');
      }
    }

    log('Шаг 0.3: ждём кнопку «Создать сообщение»…');
    let createBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      createBtn = findVisibleCreateButton();
      if (createBtn) break;
      const elapsed = Date.now() - t0;
      if (elapsed > 5000 && elapsed % 5000 < 300) dbg(`    … ждём «Создать сообщение» (${Math.round(elapsed/1000)} с)`);
      await sleep(300);
    }
    if (!createBtn) throw new Error('Кнопка «Создать сообщение» не появилась (искали по тексту)');

    log('Шаг 0.4: «Создать сообщение»…');
    await debugPause('Перед нажатием «Создать сообщение»');

    await waitForNetIdle(2000, 5000);

    nativeSubmitButton(createBtn, 'htmlb:button:click:0', 'C28_W96_V97_CREATE', 'INCIDENT_CREATE', 0);

    let descField = await waitForVisible('C32_W39_V41_V52_btadminh_struct.description', 40000, 'поле «Описание»');
    if (!descField) descField = await waitForVisible('C32_W39_V41_V52_btadminh_struct.description', 10000, 'поле «Описание»');
    if (!descField) throw new Error('Форма не открылась');
    ok('  ✔ форма инцидента открыта');

    await debugPause('Форма инцидента открыта');
  }

  // ==================== ОСНОВНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ ====================
  async function transferOne(item) {
    const d = parseRow(item.cells);
    if (!d.desc) d.desc = `Инцидент Excel#${item.excelRowNum}`;
    state.currentDesc = d.desc;
    if (!d.num) throw new Error(`Excel#${item.excelRowNum}: не удалось извлечь номер категории из "${d.iVal}" (колонка I)`);
    log(`▶ Excel#${item.excelRowNum}: ${d.desc} | номер="${d.num}"`);

    await step0_openForm();
    checkStop();

    log('A.1: Короткое описание (F-G, ≤40)...');
    if (!await setFieldValue('C32_W39_V41_V52_btadminh_struct.description', d.desc)) warnItem('  ⚠ Описание не записалось');

    log('A.2: Автор (F4 + Enter)...');
    if (!await setFieldValue('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_02', CFG.fixed.author, true)) warnItem('  ⚠ Автор не выбрался');

    log('A.3: Обработчик (F4 + Enter)...');
    if (!await setFieldValue('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_04', CFG.fixed.handler, true)) warnItem('  ⚠ Обработчик не выбрался');

    log('A.4: Длинный текст "до" (text_longtext)...');
    let okLongBefore = await fillLongTextWithRetries(d.longTextBefore, 3, 'A.4');
    if (!okLongBefore) warnItem('  ⚠ длинный текст "до" не записался после 3 попыток');
    await debugPause('После A.1-A.4');
    checkStop();

    log('B.1: Категории (dropdown)...');
    const grpNum = d.num.split('.')[0];

    const cat01Id = 'C34_W56_V57_btcategoryfirst_cat01';
    const cat01Label = getLabelByKey(cat01Id + '__items', CFG.guid.category_otherSystems);
    if (cat01Label) { if (!await setDropdownByLabel(cat01Id, cat01Label)) warnItem(`  ⚠ cat01 не выбрался ("${cat01Label}")`); }
    else warnItem(`  ⚠ cat01: label не найден в __items`);

    const cat02Id = 'C34_W56_V57_btcategoryfirst_cat02';
    const cat02Guid = findGuidByNum(cat02Id + '__items', grpNum);
    if (cat02Guid) {
      const cat02Label = getLabelByKey(cat02Id + '__items', cat02Guid);
      if (cat02Label) { if (!await setDropdownByLabel(cat02Id, cat02Label)) warnItem(`  ⚠ cat02 не выбрался ("${cat02Label}")`); }
      else warnItem(`  ⚠ cat02: label для GUID ${cat02Guid} не найден`);
    } else warnItem(`  ⚠ cat02 для группы "${grpNum}" не найден в __items`);

    const cat03Id = 'C34_W56_V57_btcategoryfirst_cat03';
    const cat03Guid = findGuidByNum(cat03Id + '__items', d.num);
    if (cat03Guid) {
      const cat03Label = getLabelByKey(cat03Id + '__items', cat03Guid);
      if (cat03Label) { if (!await setDropdownByLabel(cat03Id, cat03Label)) warnItem(`  ⚠ cat03 не выбрался ("${cat03Label}")`); }
      else warnItem(`  ⚠ cat03: label для GUID ${cat03Guid} не найден`);
    } else warnItem(`  ⚠ cat03 для "${d.num}" не найден в __items`);
    await debugPause('После Категорий');
    checkStop();

    log('B.2: Группа поддержки (dropdown)...');
    const sysNorm = String(d.system || '').trim().toLowerCase();
    const isModular = CFG.modularSystems.some(x => x.toLowerCase() === sysNorm);
    const groupLabel = isModular ? CFG.groups.modular : CFG.groups.telecom;
    log(`  Система (J) = "${d.system || '—'}" → Группа = "${groupLabel}"`);
    const okGroup = await setDropdownByLabel('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_03', groupLabel);
    if (!okGroup) { err('  ✖ Группа не выбралась. Сохранение прервётся.'); throw new Error('Группа поддержки не выбралась'); }
    await debugPause('После Группы поддержки');
    checkStop();

    log('B.3: Статус «В обработке» (E0002) — dropdown...');
    const stId = 'C32_W39_V41_V52_btadminh_lcstatus';
    const stLabel = getLabelByKey(stId + '__items', CFG.status.inProgress);
    if (stLabel) { if (!await setDropdownByLabel(stId, stLabel)) warnItem(`  ⚠ статус E0002 не выбрался ("${stLabel}")`); }
    else warnItem(`  ⚠ статус E0002 не найден в __items`);
    await debugPause('После Статуса E0002');
    checkStop();

    log('C.1: Сохранить (создание инцидента)...');
    const formDocC1 = getFormDoc(state.currentDesc);
    let saveBtn = formDocC1 ? findInDoc(formDocC1, 'C32_W39_V41_SAVE') : findEl('C32_W39_V41_SAVE');
    if (!saveBtn) throw new Error('Нет кнопки «Сохранить» (C.1)');
    if (!nativeSubmitButton(saveBtn, 'htmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0))
      throw new Error('Не могу нажать «Сохранить» (C.1)');
    
    await waitForNetIdle(2000, 30000);

    const editAppeared = await waitForCondition(
      () => {
        const doc = getFormDoc(state.currentDesc);
        if (doc) {
            const btn = findInDoc(doc, 'C32_W39_V41_EDIT');
            if (btn && isVisible(btn)) return true;
        }
        const r = findInFrames('C32_W39_V41_EDIT');
        return !!(r && r.el && isVisible(r.el));
      }, 30000, 200, 'перезагрузка после SAVE (C.1)');
    if (!editAppeared) throw new Error('После SAVE не появилась кнопка «Обработать» (C.1)');
    ok('  ✔ Инцидент создан.');
    await debugPause('После создания инцидента');
    checkStop();

    if (!okLongBefore) {
      log('C.3: Fallback — длинный текст "до" после Обработать...');
      okLongBefore = await fillLongTextWithRetries(d.longTextBefore, 3, 'C.3');
      if (okLongBefore) {
        log('C.3: сохраняем "до" перед Решением...');
        const formDocC3 = getFormDoc(state.currentDesc);
        const saveBtn3 = formDocC3 ? findInDoc(formDocC3, 'C32_W39_V41_SAVE') : findEl('C32_W39_V41_SAVE');
        if (saveBtn3) {
          if (nativeSubmitButton(saveBtn3, 'htmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0)) {
            await waitForNetIdle(2000, 20000);
            const back = await waitForCondition(
              () => {
                const doc = getFormDoc(state.currentDesc);
                if (!doc) return false;
                const btn = findInDoc(doc, 'C32_W39_V41_EDIT');
                return btn && isVisible(btn);
              },
              20000, 200, 'перезагрузка после SAVE (C.3)');
            if (back) ok('  ✔ "До" сохранено (fallback).');
            else warn('  ⚠ C.3: после SAVE нет кнопки «Обработать»');
          }
        }
      } else warnItem('  ✖ длинный текст "до" не удалось записать даже после Обработать');
    }

    // ============ E.1: Добавить текст → Решение ============
    log('E.1: «Добавить текст» → «Решение»...');
    const formDocE1 = getFormDoc(state.currentDesc);
    let menuBtn = formDocE1 ? findTextAddButton(formDocE1) : null;
    if (!menuBtn) menuBtn = findTextAddButton(null);
    if (!menuBtn) throw new Error('Кнопка «Добавить текст» не найдена');
    try { menuBtn.scrollIntoView({ block: 'center' }); } catch(e) {}

    const solItem = await waitForSolutionMenuItem(menuBtn, CFG.textAddTimeoutMs, formDocE1);
    checkStop();
    if (!solItem) throw new Error(`пункт «Решение» не появился за ${Math.round(CFG.textAddTimeoutMs/1000)} с`);

    realClick(solItem);
    await waitForNetIdle(2000, 15000);

    // Ждем появления textarea решения (игнорируя C27)
    const fieldReady = await waitForCondition(() => {
      const s = findSolutionTextarea(getFormDoc(state.currentDesc));
      return s.r && isVisible(s.r.el);
    }, 30000, 200, 'появление textarea решения');
    if (!fieldReady) {
      dumpDiagnostics('E.1-no-textarea');
      throw new Error('E.1: после «Решение» не появилось textarea');
    }
    ok('  ✔ «Решение» выбрано.');
    await debugPause('После «Решение»');
    checkStop();

    // ============ E.2: Текст решения ============
    log('E.2: Текст решения...');
    const formDocE2 = getFormDoc(state.currentDesc);
    let sol = findSolutionTextarea(formDocE2);
    if (!sol.r) {
      dumpDiagnostics('E.2-no-solution-field');
      throw new Error('E.2: не найдено поле для текста решения');
    }
    log(`  найдено поле: id="${sol.id || '(no-id)'}"`);

    if (!setElementValue(sol.r.el, d.longTextSolution, false, false)) {
      dumpDiagnostics('E.2-write-failed');
      throw new Error(`E.2: не удалось записать текст решения в "${sol.id || '(no-id)'}"`);
    }
    log(`  ✔ Текст решения записан (${(sol.r.el.value || '').length} симв.)`);
    await waitForNetIdle(1000, 5000);

    if (!isIncidentFormVisible()) {
      dumpDiagnostics('E.2-form-lost-after-text');
      throw new Error('E.2: форма инцидента не видна после записи текста — SAP «улетел» на Home.');
    }

    // ============ C.2: «Обработать» ============
    log('C.2: «Обработать»...');
    let editClicked = false;
    await waitForCondition(() => {
        let btn = null;
        const doc = getFormDoc(state.currentDesc);
        if (doc) btn = findInDoc(doc, 'C32_W39_V41_EDIT');
        if (!btn || !isVisible(btn)) {
            const r = findInFrames('C32_W39_V41_EDIT');
            btn = r ? r.el : null;
        }
        if (!btn || !isVisible(btn)) return false;
        const oc = btn.getAttribute('onclick') || '';
        if (oc.includes('htmlbSL') || oc.includes('htmlbSubmitLib') || oc.includes('htmlbSubmit')) {
            nativeSubmitButton(btn, 'htmlb:button:click:0', 'C32_W39_V41_EDIT', 'EDIT', 0);
            editClicked = true;
            return true;
        }
        return false;
    }, 30000, 200, 'EDIT button interactive and clicked');

    if (!editClicked) throw new Error('C.2: не удалось кликнуть «Обработать» (кнопка не готова)');
    await waitForNetIdle(2000, 30000);

    const saveReady = await waitForCondition(() => {
        let ready = false;
        walkFrames(d => {
            if (ready) return;
            const links = d.querySelectorAll('a, button');
            for (const a of links) {
                const txt = (a.textContent || '').trim();
                if (isVisible(a) && (txt === 'Сохранить' || (a.id && a.id.endsWith('_SAVE'))) && !a.disabled) {
                    ready = true; return;
                }
            }
        });
        return ready;
    }, 30000, 200, 'save button active (edit mode)');
    if (!saveReady) throw new Error('C.2: форма не перешла в edit-mode (Сохранить неактивна)');
    ok('  ✔ Режим редактирования.');
    await debugPause('После «Обработать»');
    checkStop();

    // ============ E.2b: Статус E0005 ============
    log('E.2b: Статус E0005...');
    const formDocE2b = getFormDoc(state.currentDesc);
    
    let stLabel2 = null;
    if (formDocE2b) {
        stLabel2 = parseDropdownItemsInDoc(formDocE2b, stId + '__items').byId[CFG.status.solution];
    }
    if (!stLabel2) {
        stLabel2 = parseDropdownItems(stId + '__items').byId[CFG.status.solution];
    }

    if (!stLabel2) {
      dumpDiagnostics('E.2b-no-E0005');
      throw new Error(`E.2b: E0005 нет в __items текущей формы`);
    }

    if (!await setDropdownByLabel(stId, stLabel2, formDocE2b)) {
      if (!isIncidentFormVisible()) {
        dumpDiagnostics('E.2b-form-lost-during-dropdown');
        throw new Error('E.2b: форма исчезла во время клика по статусу E0005');
      }
      throw new Error(`E.2b: не удалось установить статус "${stLabel2}"`);
    }
    ok('  ✔ Статус E0005 установлен.');
    await waitForNetIdle(1000, 15000);
    await debugPause('После E0005');
    checkStop();

    // ============ E.3: SAVE ============
    log('E.3: Сохранить (решение)...');
    const formDocE3 = getFormDoc(state.currentDesc);
    const saveBtn2 = formDocE3 ? findInDoc(formDocE3, 'C32_W39_V41_SAVE') : findEl('C32_W39_V41_SAVE');
    if (!saveBtn2) throw new Error('Нет кнопки «Сохранить» (E.3)');
    if (!nativeSubmitButton(saveBtn2, 'htmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0))
      throw new Error('Не могу нажать «Сохранить» (E.3)');
    
    await waitForNetIdle(2000, 30000);

    const backView = await waitForCondition(
      () => {
        const doc = getFormDoc(state.currentDesc);
        if (!doc) return false;
        const btn = findInDoc(doc, 'C32_W39_V41_EDIT');
        return btn && isVisible(btn);
      }, 30000, 200, 'перезагрузка после SAVE (E.3)');
    if (!backView) throw new Error('E.3: после SAVE не появилась кнопка «Обработать» — SAVE не применился');
    ok('  ✔ Решение записано.');
    await debugPause('После сохранения решения');
    checkStop();

    log('F.1: «Первая страница»...');
    const homeBtn = findEl('C4_W16_V17_SM-SP-HOME');
    if (homeBtn) {
      if (nativeSubmitButton(homeBtn, 'htmlb:link:click:0', 'C4_W16_V17_SM-SP-HOME', 'SM-SPHO-WC', 0)) {
        const homeOk = await waitForCondition(() => !!findVisibleCreateButton(), 30000, 200, 'переход на главную (F.1)');
        if (homeOk) {
          ok('  ✔ На главной.');
          await waitForNetIdle(2000, 10000);
        } else throw new Error('F.1: «Создать сообщение» не появилась');
      }
    } else throw new Error('F.1: кнопка «Первая страница» не найдена');
  }

  async function waitForSolutionMenuItem(menuBtn, timeoutMs, preferredDoc) {
    const SOL_ID = 'C38_W62_V63_V65_TextAdd__items____SUSO';
    const t0 = Date.now();
    let lastClick = 0, lastLog = 0;
    realClick(menuBtn);
    lastClick = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      checkStop();
      const sol = preferredDoc ? findInDoc(preferredDoc, SOL_ID) : findEl(SOL_ID);
      if (sol && sol.offsetParent) return sol;
      if (Date.now() - lastClick > 2000) { realClick(menuBtn); lastClick = Date.now(); }
      if (Date.now() - t0 - lastLog > 5000) { lastLog = Date.now() - t0; dbg(`    … ждём пункт «Решение» (${Math.round(lastLog/1000)} с)`); }
      await sleep(200);
    }
    return null;
  }

  async function waitForManual(msg) {
    checkStop();
    ui.cont.disabled = false;
    warn('⏸ ' + msg);
    await new Promise(resolve => {
      const finish = () => { ui.cont.removeEventListener('click', onCont); clearInterval(stopPoll); ui.cont.disabled = true; resolve(); };
      const onCont = () => finish();
      ui.cont.addEventListener('click', onCont);
      const stopPoll = setInterval(() => { if (state.stopped) finish(); }, 200);
    });
    checkStop();
  }

  async function runLoop() {
    state.running = true; state.stopped = false; state.paused = false;
    state.stats = { ok: 0, warn: 0, err: 0 };
    ui.start.disabled = true; ui.pause.disabled = false; ui.stop.disabled = false;
    ui.pause.textContent = '⏸ Пауза';

    if (!state.fileBuffer) { err('Файл не выбран.'); state.running = false; ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true; return; }

    await sleep(50);

    const effectiveStart = Math.max(1, parseInt(ui.startRow.value, 10) || 1);
    
    // Сохраняем стартовую строку в LocalStorage при нажатии Старт
    saveState(state.fileName, effectiveStart);

    if (state.parsedFrom !== effectiveStart || state.rows.length === 0) {
      if (!state.allRows) {
        log(`Читаю файл (кэш пуст)…`);
        ui.start.textContent = '▶ Чтение файла…';
        await sleep(50);
        let info;
        try { info = parseXlsxBuffer(state.fileBuffer); }
        catch (ex) {
          ui.start.textContent = '▶ Старт';
          err('Ошибка перечитывания: ' + ex.message);
          state.running = false; ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true;
          return;
        }
        state.allRows = info.allRows;
        state.totalFilled = info.totalFilled;
        state.lastFilledExcelRow = info.lastFilled;
        ui.start.textContent = '▶ Старт';
      }
      state.rows = filterRowsFrom(state.allRows, effectiveStart);
      state.parsedFrom = effectiveStart;
      state.idx = 0;
      ui.prog.max = state.rows.length;
      ui.prog.value = 0;
      log(`Загружено ${state.rows.length} строк (Excel#${effectiveStart}..#${state.lastFilledExcelRow}).`);
    }
    if (state.rows.length === 0) {
      err(`Нет строк для обработки (старт Excel#${effectiveStart}, последняя #${state.lastFilledExcelRow}).`);
      state.running = false; ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true; return;
    }

    state.idx = 0;
    log(`Старт: ${state.rows.length} строк, с Excel#${state.rows[0].excelRowNum} до #${state.rows[state.rows.length-1].excelRowNum}.`);

    ui.startRowLabel.textContent = 'Текущая строка Excel:';
    ui.startRow.readOnly = true;

    while (state.idx < state.rows.length && !state.stopped) {
      if (state.paused) { await sleep(300); continue; }
      await waitForNetIdle(2000, 5000);
      checkStop();

      const item = state.rows[state.idx];
      ui.startRow.value = item.excelRowNum;
      updateStat();
      ui.prog.value = state.idx;
      try {
        await transferOne(item);
        state.stats.ok++;
        saveState(state.fileName, item.excelRowNum);
        ok(`✅ Excel#${item.excelRowNum} — сохранено в LocalStorage`);
        state.idx++;
        updateStat();
      } catch (e) {
        if (e && e.name === 'SMStoppedError') {
          warn(`⏹ Остановлено пользователем на Excel#${item.excelRowNum}`);
          state.stopped = true; break;
        }
        state.stats.err++;
        updateStat();
        err(`✖ [${state.idx + 1}] ${e.message}. Останов.`);
        state.stopped = true; break;
      }
      if (ui.step.checked) await waitForManual(`Строка ${state.idx} готова. Проверьте SAP и нажмите «Продолжить».`);
      await sleep(3000);
    }

    state.running = false;
    ui.startRowLabel.textContent = 'Начать со строки:';
    ui.startRow.readOnly = false;
    ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true;
    ui.pause.textContent = '⏸ Пауза';
    log(state.stopped
      ? `⏹ Остановлено — ✅ ${state.stats.ok} / ⚠ ${state.stats.warn} / ✖ ${state.stats.err}`
      : `✅ Готово — ✅ ${state.stats.ok} / ⚠ ${state.stats.warn} / ✖ ${state.stats.err}`);
    refreshSavedInfo(state.fileName);
  }

  ui.start.addEventListener('click', () => { if (!state.running) runLoop(); });
  ui.pause.addEventListener('click', () => {
    state.paused = !state.paused;
    ui.pause.textContent = state.paused ? '▶ Продолжить' : '⏸ Пауза';
  });
  ui.stop.addEventListener('click', () => {
    state.stopped = true;
    state.paused = false;
    if (state.rows && state.rows.length > 0 && state.idx >= 0 && state.idx < state.rows.length) {
      const curExcel = state.rows[state.idx].excelRowNum;
      ui.startRow.value = curExcel;
      log(`⏹ Стоп → «Начать со строки» = ${curExcel} (Excel#${curExcel})`);
    } else log('⏹ Стоп');
  });

  log(`Скрипт загружен (v${SCRIPT_VERSION}). Выберите XLSX-файл.`);
})();
