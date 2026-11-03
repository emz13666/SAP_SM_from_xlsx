// ==UserScript==
// @name         SAP SM: XLSX → Incident (Выполненные работы)
// @namespace    https://sapsm3.sap.metinvest.com/
// @version      1.30
// @description  Переносит строки из листа "Выполненные работы" в SAP SM как инциденты AIC_OB_INCIDENT
// @match        https://sapsm3.sap.metinvest.com/*
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @downloadURL  https://raw.githubusercontent.com/emz13666/SAP_SM_from_xlsx/main/sap-sm-from-xlsx.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/SAP_SM_from_xlsx/main/sap-sm-from-xlsx.user.js
// @grant        GM_addStyle
// @grant        GM_info
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ==================== ПЕРЕХВАТЧИК СЕТИ ====================
  (function installNetworkHook() {
    const hookFn = function() {
      if (window.__SM_NET_HOOKED__) return;
      window.__SM_NET_HOOKED__ = true;

      window.__SM_WAITERS__ = [];

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
          triggerWaiters(url);
          return response;
        };
      }

      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
          triggerWaiters(this.responseURL || '');
        });
        return origSend.apply(this, args);
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

  // Версия — из шапки @version (не хардкод)
  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version)
    ? String(GM_info.script.version)
    : 'dev';

  const CFG = {
    sheetName: 'Выполненные работы',
    col: { A_date: 0, B_priem: 1, C_start: 2, D_end: 3, E_category: 4, F_object: 5, G_fault: 6, H_works: 7, I_sapCat: 8, J_system: 9, K_exec: 10, L_dept: 11, M_comment: 12 },
    guid: { category_otherSystems: '005056A081D31EEE96A83576BCEA81C6' },
    defaultSupportGroup: 'MODULAR Поддержка Модулар',
    status: { inProgress: 'E0002', solution: 'E0005' },
    fixed: { author: 'Общий ЛГОК', handler: 'Евгений Михайлович Зиновьев' },
    lsKey: 'sap_sm_xlsx_last_row',
    textAddTimeoutMs: 60000   // v1.26: сколько ждать пункт «Решение» (мс)
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
        <button id="sm-clear-log" title="Очистить лог">🗑</button>
        <button id="sm-collapse" title="Свернуть">–</button>
      </span>
    </h3>
    <div id="sm-body">
      <div class="row"><input type="file" id="sm-file" accept=".xlsx,.xls"/></div>
      <div class="row">
        <label>Начать со строки:
          <input type="number" id="sm-startRow" min="1" value="1"/>
        </label>
      </div>
      <div class="row">
        <label><input type="checkbox" id="sm-step"/> пошагово (строки)</label>
        <label style="margin-left:10px;color:#0a6ed1;font-weight:bold;"><input type="checkbox" id="sm-debugActions"/> ДЕТАЛЬНАЯ ОТЛАДКА</label>
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
    file: $('#sm-file'), startRow: $('#sm-startRow'), step: $('#sm-step'), debugActions: $('#sm-debugActions'),
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

  function log(msg, cls='') {
    const t = new Date().toLocaleTimeString();
    const esc = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    ui.log.insertAdjacentHTML('beforeend', `<span style="${cls}">[${t}] ${esc}\n</span>`);
    ui.log.scrollTop = ui.log.scrollHeight; console.log('[SM]', msg);
  }
  const err  = (m) => log(m, 'color:#f88');
  const warn = (m) => log(m, 'color:#ff0');
  const ok   = (m) => log(m, 'color:#8f8');

  // v1.24+: warn внутри transferOne инкрементит счётчик ⚠ и обновляет ui.stat
  function warnItem(m) {
    state.stats.warn++;
    warn(m);
    updateStat();
  }

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
      const finish = () => {
        ui.cont.removeEventListener('click', onCont);
        clearInterval(stopPoll);
        ui.cont.disabled = true;
        resolve();
      };
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

  // v1.30: экранирование для RegExp
  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Точное совпадение по id (старое поведение) — сначала exact, потом visible
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

  // Поиск по RegExp среди всех элементов с id — сначала visible, потом любой
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

  // v1.30: если exact-id не найден, отрезаем C\d+(_W\d+|_V\d+)+_ и ищем по суффиксу.
  // Пример: 'C32_W39_V41_V52_btadminh_struct.description' → найдёт 'C21_W71_V73_V74_btadminh_struct.description'
  function findInFrames(id) {
    const exact = findInFramesExact(id);
    if (exact) return exact;

    const stripped = String(id).replace(/^C\d+(?:_[WV]\d+)+_/, '');
    if (stripped === id) return null; // нет C/W/V-префикса — искать по regex нечего
    const re = new RegExp('^C\\d+(?:_[WV]\\d+)+_' + escapeRegex(stripped) + '$');
    return findInFramesRegex(re);
  }

  function findEl(id) { const r = findInFrames(id); return r ? r.el : null; }

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

  // v1.29: немедленная остановка
  class SMStoppedError extends Error {
    constructor() { super('Остановлено пользователем'); this.name = 'SMStoppedError'; }
  }
  function checkStop() {
    if (state.stopped) throw new SMStoppedError();
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
    if (!btn) { warn('[nativeSubmit] кнопка не найдена: ' + oid); return false; }
    const win = btn.ownerDocument.defaultView;
    const oc = (btn.getAttribute('onclick') || '').trim();

    // SAP пишет id как 'SM\x2dSPHO\x2dWC' — декодируем, иначе SAP не находит кнопку.
    const unesc = (s) => String(s).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

    const mLib = oc.match(/htmlbSubmitLib\s*\(\s*'htmlb'\s*,\s*this\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*([^,]+?)\s*,\s*'([^']*)'\s*,\s*(\d+)/);
    if (mLib && typeof win.htmlbSubmitLib === 'function') {
      const [_, evt, frm, oidRaw, idRaw, cntRaw] = mLib;
      const oidVal = oidRaw === 'null' ? null : unesc(oidRaw.replace(/^'|'$/g, ''));
      const idVal  = unesc(idRaw);
      try {
        win.htmlbSubmitLib('htmlb', btn, evt, frm, oidVal, idVal, parseInt(cntRaw, 10));
        log(`    [nativeSubmit] htmlbSubmitLib: ${evt} | ${frm} | oid=${oidVal} | id=${idVal}`);
        return true;
      } catch (e) { warn('[nativeSubmit] htmlbSubmitLib error: ' + e.message); }
    }

    const mSL = oc.match(/htmlbSL\s*\(\s*this\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
    if (mSL && typeof win.htmlbSL === 'function') {
      const [_, n, evtId, cntRaw] = mSL;
      try {
        win.htmlbSL(btn, parseInt(n, 10), unesc(evtId), unesc(cntRaw));
        log(`    [nativeSubmit] htmlbSL: ${evtId} | n=${n} | cnt=${cntRaw}`);
        return true;
      } catch (e) { warn('[nativeSubmit] htmlbSL error: ' + e.message); }
    }

    // Не eval(onclick). Реальный клик — браузер выполнит onclick в правильном контексте.
    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    realClick(btn);
    log(`    [nativeSubmit] realClick(btn): ${oid}`);
    return true;
  }

  function formatDate(val) {
    if (!val) return '';
    let d;
    if (val instanceof Date) d = val;
    else d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  }

  async function setFieldValue(id, value, isLookup = false) {
    const r = findInFrames(id);
    if (!r) { warn('setFieldValue: нет #' + id); return false; }
    const el = r.el;
    const win = r.win;

    if (el.disabled || el.readOnly) {
      warn(`setFieldValue: #${id.split('/').pop()} disabled/readOnly — пропускаю`);
      return false;
    }

    if (id.includes('description')) value = value.substring(0, 40);
    try { el.focus(); } catch (e) {}

    if (isLookup) {
      el.value = value;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e){}

      const pNet = win.__SM_WAIT_FOR_NET__
        ? win.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000)
        : null;

      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
      } catch(e){}

      if (pNet) {
        const netOk = await pNet;
        if (!netOk) warn(`  ⚠ lookup #${id.split('/').pop()}: POST BSPWDApplication.do не дождались`);
      }

      await waitForCondition(
        () => el.value && !el.value.includes('отсутствует'),
        5000, 50,
        `F4 #${id.split('/').pop()}`
      );

      if (!el.value || el.value.includes('отсутствует')) {
        warn(`  ⚠ lookup #${id.split('/').pop()} не выбрался (значение "${el.value}")`);
        return false;
      }
      log(`    [F4] ✔ #${id.split('/').pop()} = "${el.value}"`);
    } else {
      el.value = value;
      try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}

      // Проверяем, что SAP не обрезал/не отбросил (нормализуем \r\n → \n)
      const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n');
      if (norm(el.value) !== norm(value)) {
        warn(`  ⚠ #${id.split('/').pop()}: записано "${norm(el.value).slice(0,60)}", ожидалось "${norm(value).slice(0,60)}" (SAP обрезал или не принял)`);
        return false;
      }
      const preview = el.value.length > 80 ? el.value.slice(0, 80) + '…' : el.value;
      log(`    [field] ✔ #${id.split('/').pop()} = "${String(preview).replace(/\n/g, '⏎')}"`);
    }
    return true;
  }

  // ==================== DROPDOWN через меню ====================
  // __items — это HTML-комментарий вида <!--a["KEY"]="LABEL";...-->
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
        .replace(/&nbsp;/g, ' ')
        .replace(/&minus;/g, '-')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      if (!key || !text || text === ' ') continue;
      byId[key] = text;
    }
    return { byId };
  }

  function getLabelByKey(itemsId, key) {
    return parseDropdownItems(itemsId).byId[key] || null;
  }

  function findGuidByNum(itemsId, num) {
    const byId = parseDropdownItems(itemsId).byId;
    for (const [key, text] of Object.entries(byId)) {
      const m = text.match(/^(\d+(?:\.\d+)?)\./);
      if (m && m[1] === num) return key;
    }
    return null;
  }

  async function setDropdownByLabel(id, label) {
    const r = findInFrames(id);
    if (!r) { warn('setDropdownByLabel: нет #' + id.split('/').pop()); return false; }
    const el = r.el;

    if (el.disabled) { warn(`setDropdownByLabel: #${id.split('/').pop()} disabled`); return false; }

    if ((el.value || '').trim() === label) {
      log(`    [dropdown] #${id.split('/').pop()} уже = "${label}"`);
      return true;
    }

    const btn = findEl(id + '-btn');
    if (!btn) { warn(`setDropdownByLabel: нет #${id.split('/').pop()}-btn`); return false; }

    try { btn.scrollIntoView({ block: 'center' }); } catch(e) {}
    realClick(btn);

    let target = null;
    const appeared = await waitForCondition(() => {
      const anchors = r.doc.querySelectorAll('a');
      for (const a of anchors) {
        if (!a.offsetParent) continue;
        if ((a.textContent || '').replace(/\s+/g, ' ').trim() === label) {
          target = a;
          return true;
        }
      }
      return false;
    }, 8000, 50, `меню "${label}"`);

    if (!appeared) {
      const sample = Array.from(r.doc.querySelectorAll('a'))
        .filter(a => a.offsetParent)
        .slice(0, 12)
        .map(a => JSON.stringify((a.textContent || '').trim().slice(0, 50)));
      warn(`    [dropdown] пункт "${label}" не появился за 8 с. Видимые <A>: ${sample.join(', ')}`);
      return false;
    }

    const win = r.win;
    const pNet = win.__SM_WAIT_FOR_NET__
      ? win.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000)
      : Promise.resolve(false);

    log(`    [dropdown] клик по <A>: "${(target.textContent||'').trim()}"`);
    realClick(target);

    const netOk = await pNet;
    if (!netOk) warn(`    [dropdown] POST BSPWDApplication.do не дождались`);

    const val = (el.value || '').trim();
    if (val === label) {
      log(`    [dropdown] ✔ #${id.split('/').pop()} = "${val}"`);
      return true;
    }
    warn(`    [dropdown] #${id.split('/').pop()}: значение "${val}" ≠ ожидаемому "${label}"`);
    return false;
  }

  // Ожидание условия через polling. Не таймаут SAP — ожидание отрисовки браузером.
  async function waitForCondition(fn, timeoutMs = 8000, pollMs = 50, label = '') {
    const t0 = Date.now();
    let last = 0;
    while (Date.now() - t0 < timeoutMs) {
        checkStop();
      try { if (fn()) return true; } catch(e){}
      if (Date.now() - t0 - last > 2000) {
        last = Date.now() - t0;
        log(`    … ждём ${label || 'условие'} (${Math.round(last/1000)} с)`);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
  }
  // v1.27: заполнение text_longtext с ожиданием появления поля и повторами.
  // Возвращает true если удалось записать, false после всех попыток.
  async function fillLongTextWithRetries(value, attempts = 3, label = 'text') {
    for (let i = 1; i <= attempts; i++) {
      const found = await waitForCondition(
        () => findInFrames('C38_W62_V63_V65_text_longtext') !== null,
        5000, 100, `${label} text_longtext (попытка ${i}/${attempts})`
      );
      if (!found) {
        log(`  [${label}] поле text_longtext не появилось за 5 с (попытка ${i}/${attempts})`);
        diagTextLongtext();
        continue;
      }
      if (await setFieldValue('C38_W62_V63_V65_text_longtext', value)) {
        log(`  [${label}] ✔ записано (попытка ${i}/${attempts})`);
        return true;
      }
      log(`  [${label}] setFieldValue вернул false (попытка ${i}/${attempts})`);
      await sleep(1000);
    }
    return false;
  }

  // v1.27: диагностика — какие C38_W62_V63_V65_* есть в DOM (для лога при неудаче)
  function diagTextLongtext() {
    const parts = [];
    walkFrames((doc) => {
      try {
        const all = doc.querySelectorAll('[id^="C38_W62_V63_V65_"]');
        for (const el of all) {
          const type = el.getAttribute('type');
          parts.push(`${el.id}(${el.tagName.toLowerCase()}${type ? ':'+type : ''})`);
        }
      } catch(e) {}
    });
    if (parts.length) log(`    [diag] C38_W62_V63_V65_* : ${parts.slice(0, 15).join(' | ')}${parts.length > 15 ? ` … (всего ${parts.length})` : ''}`);
    else log(`    [diag] нет ни одного C38_W62_V63_V65_* в DOM`);
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
        log(`    … ждём ${label || '#' + id} (${Math.round(elapsed/1000)} с)`);
      }
      await sleep(300);
    }
    return null;
  }
  // v1.28: поиск видимой кнопки "Создать сообщение" (ID меняется: C28_W96_V97, C41_W105_V106, ...)
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
          if (oc.includes('htmlbSL') || oc.includes('htmlbSubmitLib') || oc.includes('htmlbSubmit')) {
            found = n;
            return;
          }
        }
      }
    });
    return found;
  }
  function findTextAddButton() {
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
      for (const n of nodes) {
        if ((n.textContent || '').trim() === text) { found = n; return; }
      }
    });
    return found;
  }

  const state = {
    rows: [], idx: 0, running: false, paused: false, stopped: false,
    stats: { ok: 0, warn: 0, err: 0 }
  };

  // Сброс value при клике: иначе повторный выбор ТОГО ЖЕ файла не вызывает change
  ui.file.addEventListener('click', () => { ui.file.value = ''; });

  ui.file.addEventListener('change', (e) => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) { input.value = ''; return; }

    if (state.running) {
      warn('Идёт прогон — сначала «⏹ Стоп», затем выбирайте файл.');
      input.value = '';
      return;
    }

    const resetInput = () => { try { input.value = ''; } catch(e){} };

    const rd = new FileReader();
    rd.onerror = (ev) => {
      err('Ошибка чтения файла: ' + (ev.target && ev.target.error && ev.target.error.message || 'unknown'));
      resetInput();
    };
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true });
        if (!wb.SheetNames.includes(CFG.sheetName)) {
          alert(`Лист "${CFG.sheetName}" не найден.`);
          resetInput();
          return;
        }
        const ws = wb.Sheets[CFG.sheetName];
        const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false, blankrows:false });
        const filled = [];
        for (let i = 1; i < aoa.length; i++) {
          const r = aoa[i];
          let hasData = false;
          for (let c = 0; c <= CFG.col.K_exec; c++) {
            if (String(r[c] ?? '').trim()) { hasData = true; break; }
          }
          if (hasData) filled.push({ excelRowNum: i + 1, cells: r });
        }

        // Сброс состояния от предыдущего файла
        state.rows = filled;
        state.idx = 0;
        state.stats = { ok: 0, warn: 0, err: 0 };
        ui.prog.max = filled.length;
        ui.prog.value = 0;
        ui.start.disabled = false;

        const last = parseInt(localStorage.getItem(CFG.lsKey) || '-1', 10);
        if (last >= 0 && last < filled.length - 1) {
          const nextIdx = last + 1;
          if (ui.startRow.value === '1' || !ui.startRow.value) {
             ui.startRow.value = filled[nextIdx].excelRowNum;
          }
          ui.stat.textContent = `Заполненных строк: ${filled.length}. Продолжаем с Excel#${filled[nextIdx].excelRowNum}.`;
        } else {
          ui.stat.textContent = `Заполненных строк: ${filled.length}.`;
        }

        log(`Файл прочитан: ${filled.length} строк. Excel row: ${filled[0]?.excelRowNum}..${filled[filled.length-1]?.excelRowNum}`);
      } catch (ex) {
        err('Ошибка чтения XLSX: ' + ex.message);
      }
      resetInput();
    };
    rd.readAsArrayBuffer(f);
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

    // «До»:      <дата + время приёма>  \n  <категория + объект + неисправность>
    // «Решение»: <дата + время оконч.>  \n  <работы>  \n  <исполнитель>
    const headBefore = [dA, s(c.B_priem)].filter(Boolean).join(' ');
    const bodyBefore = [s(c.E_category), s(c.F_object), s(c.G_fault)].filter(Boolean).join(' ');
    const longTextBefore = [headBefore, bodyBefore].filter(Boolean).join('\n');

    const headSol = [dA, dD].filter(Boolean).join(' ');
    const worksSol = s(c.H_works);
    const execSol  = s(c.K_exec);
    const longTextSolution = [headSol, worksSol, execSol].filter(Boolean).join('\n');

    return { desc, num, longTextBefore, longTextSolution, raw: cells, iVal };
  }

  async function step0_openForm() {
    log('Шаг 0.1: ждём интерфейс SAP…');
    let homeEl = await waitForVisible('C4_W16_V17_SM-SP-HOME', 60000, '«Первая страница»');
    if (!homeEl) throw new Error('Интерфейс SAP не загрузился');
    ok('  ✔ интерфейс найден');

    log('Шаг 0.2: «Первая страница»…');
    const homeLink = findEl('C4_W16_V17_SM-SP-HOME');
    const winH = homeLink.ownerDocument.defaultView;
    const pNetHome = winH.__SM_WAIT_FOR_NET__ ? winH.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 10000) : null;
    if (nativeSubmitButton(homeLink, 'htmlb:link:click:0', 'C4_W16_V17_SM-SP-HOME', 'SM-SPHO-WC', 0)) {
      if (pNetHome) { const n = await pNetHome; if (!n) warn('  ⚠ 0.2: POST не дождались'); }
      else await sleep(3000);
      ok('  ✔ «Первая страница»');
    }

        log('Шаг 0.3: ждём кнопку «Создать сообщение»…');
    // v1.28: ID кнопки динамический, ищем по тексту среди видимых
    let createBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      createBtn = findVisibleCreateButton();
      if (createBtn) break;
      const elapsed = Date.now() - t0;
      if (elapsed > 5000 && elapsed % 5000 < 300) { // лог раз в 5 сек
        log(`    … ждём «Создать сообщение» (${Math.round(elapsed/1000)} с)`);
      }
      await sleep(300);
    }
    if (!createBtn) throw new Error('Кнопка «Создать сообщение» не появилась (искали по тексту)');

    log('Шаг 0.4: «Создать сообщение»…');
    await debugPause('Перед нажатием «Создать сообщение»');

    const winC = createBtn.ownerDocument.defaultView;
    const pNetCreate = winC.__SM_WAIT_FOR_NET__ ? winC.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
    nativeSubmitButton(createBtn, 'thtmlb:button:click:0', 'C28_W96_V97_CREATE', 'INCIDENT_CREATE', 0);

    let descField = await waitForVisible('C32_W39_V41_V52_btadminh_struct.description', 30000, 'поле «Описание»');
    if (pNetCreate) await pNetCreate;

    if (!descField) descField = await waitForVisible('C32_W39_V41_V52_btadminh_struct.description', 10000, 'поле «Описание»');
    if (!descField) throw new Error('Форма не открылась');
    ok('  ✔ форма инцидента открыта');

    await debugPause('Форма инцидента открыта');
  }

  // ============================================================
  // ПОСЛЕДОВАТЕЛЬНОСТЬ
  //   A.1 Описание → A.2 Длинный текст "до" → A.3 Автор → A.4 Обработчик
  //   B.1 Категории (cat01 → cat02 → cat03)
  //   B.2 Группа поддержки
  //   B.3 Статус E0002
  //   C.1 Сохранить (создание)
  //   C.2 Обработать
  //   E.1 Добавить текст → Решение  (ждёт до 60 с, повторные клики)
  //   E.2 Текст решения + Статус E0005
  //   E.3 Сохранить
  //   F.1 Home
  // ============================================================
  async function transferOne(item) {
    const d = parseRow(item.cells);
    if (!d.desc) d.desc = `Инцидент Excel#${item.excelRowNum}`;
    if (!d.num) {
      throw new Error(`Excel#${item.excelRowNum}: не удалось извлечь номер категории из "${d.iVal}" (колонка I)`);
    }
    log(`▶ Excel#${item.excelRowNum}: ${d.desc} | номер="${d.num}"`);

    await step0_openForm();
    checkStop();
    // ---------- A: описание + партнёры + длинный текст "до" ----------
    log('A.1: Короткое описание (F-G, ≤40)...');
    if (!await setFieldValue('C32_W39_V41_V52_btadminh_struct.description', d.desc)) {
      warnItem('  ⚠ Описание не записалось');
    }

    log('A.2: Автор (F4 + Enter)...');
    if (!await setFieldValue('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_02', CFG.fixed.author, true)) {
      warnItem('  ⚠ Автор не выбрался');
    }

    log('A.3: Обработчик (F4 + Enter)...');
    if (!await setFieldValue('C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_04', CFG.fixed.handler, true)) {
      warnItem('  ⚠ Обработчик не выбрался');
    }

    // v1.27: длинный текст "до" — после F4 POST (форма перерисовывается, поле text_longtext
    // должно появиться). Ждём появления с повторами, при неудаче — fallback в C.3 (после EDIT).
    log('A.4: Длинный текст "до" (text_longtext)...');
    let okLongBefore = await fillLongTextWithRetries(d.longTextBefore, 3, 'A.4');
    if (!okLongBefore) {
      warnItem('  ⚠ длинный текст "до" не записался после 3 попыток — попробуем после Обработать');
    }
    await debugPause('После A.1-A.4 (Описание, Автор, Обработчик, Длинный текст)');
    checkStop();
    // ---------- B.1: Категории ----------
    log('B.1: Категории (dropdown)...');
    const grpNum = d.num.split('.')[0];

    const cat01Id = 'C34_W56_V57_btcategoryfirst_cat01';
    const cat01Label = getLabelByKey(cat01Id + '__items', CFG.guid.category_otherSystems);
    if (cat01Label) {
      if (!await setDropdownByLabel(cat01Id, cat01Label)) warnItem(`  ⚠ cat01 не выбрался ("${cat01Label}")`);
    } else {
      warnItem(`  ⚠ cat01: label для GUID ${CFG.guid.category_otherSystems} не найден в __items`);
    }

    const cat02Id = 'C34_W56_V57_btcategoryfirst_cat02';
    const cat02Guid = findGuidByNum(cat02Id + '__items', grpNum);
    if (cat02Guid) {
      const cat02Label = getLabelByKey(cat02Id + '__items', cat02Guid);
      if (cat02Label) {
        if (!await setDropdownByLabel(cat02Id, cat02Label)) warnItem(`  ⚠ cat02 не выбрался ("${cat02Label}")`);
      } else {
        warnItem(`  ⚠ cat02: label для GUID ${cat02Guid} не найден`);
      }
    } else {
      warnItem(`  ⚠ cat02 для группы "${grpNum}" не найден в __items`);
    }

    const cat03Id = 'C34_W56_V57_btcategoryfirst_cat03';
    const cat03Guid = findGuidByNum(cat03Id + '__items', d.num);
    if (cat03Guid) {
      const cat03Label = getLabelByKey(cat03Id + '__items', cat03Guid);
      if (cat03Label) {
        if (!await setDropdownByLabel(cat03Id, cat03Label)) warnItem(`  ⚠ cat03 не выбрался ("${cat03Label}")`);
      } else {
        warnItem(`  ⚠ cat03: label для GUID ${cat03Guid} не найден`);
      }
    } else {
      warnItem(`  ⚠ cat03 для "${d.num}" не найден в __items`);
    }
    await debugPause('После Категорий');
    checkStop();
    // ---------- B.2: Группа поддержки ----------
    log('B.2: Группа поддержки (dropdown)...');
    const okGroup = await setDropdownByLabel(
      'C32_W39_V41_V52_btpartnerset_/aicrm/header_fct_03',
      CFG.defaultSupportGroup
    );
    if (!okGroup) {
      err('  ✖ Группа не выбралась. Сохранение прервётся (SAP не даст создать инцидент без группы).');
      throw new Error('Группа поддержки не выбралась');
    }
    await debugPause('После Группы поддержки');
    checkStop();
    // ---------- B.3: Статус E0002 ----------
    log('B.3: Статус «В обработке» (E0002) — dropdown...');
    const stId = 'C32_W39_V41_V52_btadminh_lcstatus';
    const stLabel = getLabelByKey(stId + '__items', CFG.status.inProgress);
    if (stLabel) {
      if (!await setDropdownByLabel(stId, stLabel)) warnItem(`  ⚠ статус E0002 не выбрался ("${stLabel}")`);
    } else {
      warnItem(`  ⚠ статус E0002 не найден в __items`);
    }
    await debugPause('После Статуса E0002');
    checkStop();

    // ---------- C.1: Сохранить (создание) ----------
    log('C.1: Сохранить (создание инцидента)...');
    let saveBtn = findEl('C32_W39_V41_SAVE');
    if (!saveBtn) throw new Error('Нет кнопки «Сохранить» (C.1)');
    let winSave = saveBtn.ownerDocument.defaultView;
    let pNet = winSave.__SM_WAIT_FOR_NET__ ? winSave.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
    if (!nativeSubmitButton(saveBtn, 'thtmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0))
      throw new Error('Не могу нажать «Сохранить» (C.1)');
    if (pNet) { const n = await pNet; if (!n) warn('  ⚠ C.1: POST BSPWDApplication.do не дождались'); }
    else await sleep(3000);
    ok('  ✔ Инцидент создан.');
    await debugPause('После создания инцидента');
    checkStop();
    // ---------- C.2: Обработать ----------
    log('C.2: «Обработать»...');
    const editBtn = await waitForVisible('C32_W39_V41_EDIT', 15000, '«Обработать»');
    if (!editBtn) throw new Error('Нет кнопки «Обработать» (C.2)');
    let winEdit = editBtn.ownerDocument.defaultView;
    pNet = winEdit.__SM_WAIT_FOR_NET__ ? winEdit.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
    if (!nativeSubmitButton(editBtn, 'thtmlb:button:click:0', 'C32_W39_V41_EDIT', 'EDIT', 0))
      throw new Error('Не могу нажать «Обработать» (C.2)');
    if (pNet) { const n = await pNet; if (!n) warn('  ⚠ C.2: POST BSPWDApplication.do не дождались'); }
    else await sleep(3000);
    ok('  ✔ Режим редактирования.');
    await debugPause('После «Обработать»');
    checkStop();
    // ---------- C.3: Fallback — длинный текст "до" (если A.4 не справился) ----------
    if (!okLongBefore) {
      log('C.3: Fallback — длинный текст "до" после Обработать...');
      okLongBefore = await fillLongTextWithRetries(d.longTextBefore, 3, 'C.3');
      if (okLongBefore) {
        log('C.3: сохраняем "до" перед Решением...');
        const saveBtn3 = findEl('C32_W39_V41_SAVE');
        if (saveBtn3) {
          const win3 = saveBtn3.ownerDocument.defaultView;
          const pNet3 = win3.__SM_WAIT_FOR_NET__ ? win3.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
          if (nativeSubmitButton(saveBtn3, 'thtmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0)) {
            if (pNet3) { const n = await pNet3; if (!n) warn('  ⚠ C.3: POST не дождались'); }
            else await sleep(3000);
            ok('  ✔ "До" сохранено (fallback).');
          }
        }
      } else {
        warnItem('  ✖ длинный текст "до" не удалось записать даже после Обработать');
      }
    }

    // ---------- E.1: Добавить текст → Решение ----------
    // v1.26: ждём до 60 с; если через 2 с пункта нет — кликаем по «Добавить текст» снова.
    // Если меню уже открыто — не кликаем (иначе закроем).
    // Если за 60 с не появился — throw (батч остановится, строка не уйдёт в «успешные»).
    log('E.1: «Добавить текст» → «Решение»...');
    const menuBtn = findTextAddButton();
    if (!menuBtn) throw new Error('Кнопка «Добавить текст» не найдена');
    try { menuBtn.scrollIntoView({ block: 'center' }); } catch(e) {}

    const solItem = await waitForSolutionMenuItem(menuBtn, CFG.textAddTimeoutMs);
    checkStop();
    if (!solItem) {
      throw new Error(`пункт «Решение» не появился за ${Math.round(CFG.textAddTimeoutMs/1000)} с`);
    }

    const winSol = solItem.ownerDocument.defaultView;
    const pNetSol = winSol.__SM_WAIT_FOR_NET__
      ? winSol.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
    realClick(solItem);
    if (pNetSol) { const n = await pNetSol; if (!n) warn('  ⚠ E.1: POST не дождались'); }
    ok('  ✔ «Решение» выбрано.');
    await debugPause('После «Решение»');
    checkStop();
    // ---------- E.2: Текст решения + Статус E0005 ----------
    log('E.2: Текст решения + Статус E0005...');
    if (!await setFieldValue('C38_W62_V63_V65_text_longtext', d.longTextSolution)) {
      warnItem('  ⚠ текст решения не записался');
    }

    const stLabel2 = getLabelByKey(stId + '__items', CFG.status.solution);
    if (stLabel2) {
      if (!await setDropdownByLabel(stId, stLabel2)) warnItem(`  ⚠ статус E0005 не выбрался ("${stLabel2}")`);
    } else {
      warnItem(`  ⚠ статус E0005 не найден в __items — статус не изменится`);
    }

    // ---------- E.3: Сохранить (решение) ----------
    log('E.3: Сохранить (решение)...');
    const saveBtn2 = findEl('C32_W39_V41_SAVE');
    if (!saveBtn2) throw new Error('Нет кнопки «Сохранить» (E.3)');
    const win2 = saveBtn2.ownerDocument.defaultView;
    const pNet2 = win2.__SM_WAIT_FOR_NET__ ? win2.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
    if (!nativeSubmitButton(saveBtn2, 'thtmlb:button:click:0', 'C32_W39_V41_SAVE', 'SAVE', 0))
      throw new Error('Не могу нажать «Сохранить» (E.3)');
    if (pNet2) { const n = await pNet2; if (!n) warn('  ⚠ E.3: POST не дождались'); }
    else await sleep(3000);
    ok('  ✔ Решение записано.');
    await debugPause('После сохранения решения');
    checkStop();
    // ---------- F.1: Home ----------
    log('F.1: «Первая страница»...');
    const homeBtn = findEl('C4_W16_V17_SM-SP-HOME');
    if (homeBtn) {
      const winH = homeBtn.ownerDocument.defaultView;
      const pNetH = winH.__SM_WAIT_FOR_NET__ ? winH.__SM_WAIT_FOR_NET__('BSPWDApplication.do', 15000) : null;
      if (nativeSubmitButton(homeBtn, 'htmlb:link:click:0', 'C4_W16_V17_SM-SP-HOME', 'SM-SPHO-WC', 0)) {
        if (pNetH) { const n = await pNetH; if (!n) warn('  ⚠ F.1: POST не дождались'); }
        else await sleep(3000);
        ok('  ✔ На главной.');
      }
    }
  }

  // v1.26: ждёт появления пункта «Решение» в меню «Добавить текст».
  // Кликает по menuBtn (не чаще 1 раза в 2 сек), если пункт не появился.
  // Если меню уже открыто — не кликает повторно.
  // Возвращает видимый <A> (или элемент) с id ...TextAdd__items____SUSO, либо null по таймауту.
  async function waitForSolutionMenuItem(menuBtn, timeoutMs) {
    const SOL_ID = 'C38_W62_V63_V65_TextAdd__items____SUSO';
    const t0 = Date.now();
    let lastClick = 0;
    let lastLog = 0;

    // Первый клик — сразу
    realClick(menuBtn);
    lastClick = Date.now();

    while (Date.now() - t0 < timeoutMs) {
        checkStop();
      const sol = findEl(SOL_ID);
      if (sol && sol.offsetParent) return sol;

      // Если давно не кликали — кликаем снова (SAP иногда не открывает меню с первого раза)
      if (Date.now() - lastClick > 2000) {
        realClick(menuBtn);
        lastClick = Date.now();
      }

      if (Date.now() - t0 - lastLog > 5000) {
        lastLog = Date.now() - t0;
        log(`    … ждём пункт «Решение» (${Math.round(lastLog/1000)} с)`);
      }
      await sleep(200);
    }
    return null;
  }

  async function waitForManual(msg) {
    checkStop();
    ui.cont.disabled = false;
    warn('⏸ ' + msg);
    await new Promise(resolve => {
      const finish = () => {
        ui.cont.removeEventListener('click', onCont);
        clearInterval(stopPoll);
        ui.cont.disabled = true;
        resolve();
      };
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

    const startFromUi = parseInt(ui.startRow.value || '1', 10);
    let idxByExcel = state.rows.findIndex(r => r.excelRowNum >= startFromUi);
    if (idxByExcel < 0) idxByExcel = 0;
    let idx = idxByExcel;
    if (idx >= state.rows.length) {
      warn(`Стартовый индекс ${idx} ≥ ${state.rows.length}.`);
      state.running = false; ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true;
      return;
    }
    state.idx = idx;
    log(`Старт с индекса ${idx} (Excel строка ${state.rows[idx].excelRowNum}).`);

    while (state.idx < state.rows.length && !state.stopped) {
      if (state.paused) { await sleep(300); continue; }
      const item = state.rows[state.idx];
      updateStat();
      ui.prog.value = state.idx;
      try {
        await transferOne(item);
        state.stats.ok++;
        localStorage.setItem(CFG.lsKey, state.idx);
        ok(`✅ [${state.idx + 1}] сохранено в LocalStorage`);
        state.idx++;
        updateStat();
      } catch (e) {
        if (e && e.name === 'SMStoppedError') {
          warn(`⏹ Остановлено пользователем на Excel#${item.excelRowNum}`);
          state.stopped = true;
          break;
        }
        state.stats.err++;
        updateStat();
        err(`✖ [${state.idx + 1}] ${e.message}. Останов.`);
        state.stopped = true;
        break;
      }
      if (ui.step.checked) {
        await waitForManual(`Строка ${state.idx} готова. Проверьте SAP и нажмите «Продолжить».`);
      }
      await sleep(1500);
    }

    state.running = false;
    ui.start.disabled = false; ui.pause.disabled = true; ui.stop.disabled = true;
    ui.pause.textContent = '⏸ Пауза';
    log(state.stopped
      ? `⏹ Остановлено — ✅ ${state.stats.ok} / ⚠ ${state.stats.warn} / ✖ ${state.stats.err}`
      : `✅ Готово — ✅ ${state.stats.ok} / ⚠ ${state.stats.warn} / ✖ ${state.stats.err}`);
  }

  ui.start.addEventListener('click', () => { if (!state.running) runLoop(); });
  ui.pause.addEventListener('click', () => {
    state.paused = !state.paused;
    ui.pause.textContent = state.paused ? '▶ Продолжить' : '⏸ Пауза';
  });
  ui.stop.addEventListener('click', () => {
    state.stopped = true;
    state.paused = false;
    // v1.29: сразу обновить "Начать со строки" на текущую позицию
    if (state.rows && state.rows.length > 0 && state.idx >= 0 && state.idx < state.rows.length) {
      const curExcel = state.rows[state.idx].excelRowNum;
      ui.startRow.value = curExcel;
      log(`⏹ Стоп → «Начать со строки» = ${curExcel} (Excel#${curExcel})`);
    } else {
      log('⏹ Стоп');
    }
  });

  log(`Скрипт загружен (v${SCRIPT_VERSION}). Выберите XLSX-файл.`);
})();
