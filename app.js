/*
 * 康复记录 · UI layer.
 * All data lives in this phone's browser (IndexedDB). Nothing is sent over the network.
 */
(function () {
  'use strict';
  const KF = window.KF;
  const $ = (id) => document.getElementById(id);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const DB_NAME = 'kangfu-records';      // unique name: other apps on the same github.io site share this origin
  const STORES = ['markers', 'reports', 'treatments', 'notes'];
  const MAX_FILE = 50 * 1024 * 1024;
  const BACKUP_REMIND_DAYS = 30;

  const data = { markers: [], reports: [], treatments: [], notes: [] };
  const meta = { lastBackup: null };
  let idb = null;               // null in demo mode or when IndexedDB is unavailable
  let installPrompt = null;
  let objectUrls = [];          // revoked on every re-render

  // ---------- IndexedDB ----------
  const req2p = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('数据库被另一个窗口占用，请关闭其他“康复记录”窗口后重试。'));
    });
  }
  /** Run one write transaction; resolves only after the data is committed to disk. */
  function write(store, fn) {
    if (!idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存被中止'));
    });
  }
  async function loadAll() {
    for (const s of STORES) {
      const rows = await req2p(idb.transaction(s).objectStore(s).getAll());
      const fn = { markers: KF.sanitizeMarker, reports: KF.sanitizeReport, treatments: KF.sanitizeTreatment, notes: KF.sanitizeNote }[s];
      data[s] = rows.map(fn).filter(Boolean);
    }
    const lb = await req2p(idb.transaction('meta').objectStore('meta').get('lastBackup'));
    meta.lastBackup = lb && typeof lb.value === 'string' ? lb.value : null;
  }
  async function saveItem(store, item) {
    await write(store, (os) => os.put(item));
    const list = data[store];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  }
  async function deleteItem(store, id) {
    await write(store, (os) => os.delete(id));
    data[store] = data[store].filter((x) => x.id !== id);
  }
  function friendlyError(err) {
    if (err && err.name === 'QuotaExceededError') return '手机存储空间不足，保存失败。请清理手机空间，或删除一些大文件后重试。';
    return '保存失败：' + ((err && err.message) || err);
  }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // always textContent: user text is never parsed as HTML
    return e;
  }
  function btn(text, cls, onClick, label) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  const md = (iso) => { const [y, m, d] = iso.split('-'); return `${y}年${+m}月${+d}日`; };
  const mdShort = (iso) => { const [y, m, d] = iso.split('-'); return `${y.slice(2)}/${+m}/${+d}`; };
  const byDateDesc = (a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1);
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function showErr(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  function fileBlob(f) {
    if (!f) return null;
    if (f.blob) return f.blob;
    const b = KF.dataUrlToBytes(f.data);
    return b ? new Blob([b.bytes], { type: f.mime || b.mime }) : null;
  }
  function objectUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function checkFile(file) {
    if (!file) return '请选择文件';
    if (file.size > MAX_FILE) return `文件太大（${fmtSize(file.size)}），请选择 50 MB 以内的文件。`;
    return '';
  }

  async function shareOrDownload(blob, name, type) {
    try {
      const file = new File([blob], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // any other share failure → fall back to a normal download
    }
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  }
  /** Open / save an attachment. Android hands PDFs to the system viewer via the share sheet. */
  async function openFile(f) {
    const blob = fileBlob(f);
    if (!blob) return toast('文件无法读取');
    const how = await shareOrDownload(blob, f.fileName, blob.type || 'application/octet-stream');
    if (how === 'downloaded') toast('已保存到“下载”文件夹');
  }
  function fileActions(f) {
    const box = el('div', 'actions');
    box.append(btn('打开 / 保存文件', 'small', () => openFile(f), `打开或保存 ${f.fileName}`));
    return box;
  }
  function thumbFor(f) {
    const blob = fileBlob(f);
    if (!blob || !/^image\//.test(blob.type)) return null;
    const img = el('img', 'thumb');
    img.alt = f.fileName;
    img.loading = 'lazy';
    img.src = objectUrl(blob);
    return img;
  }
  async function confirmDelete(store, id, what) {
    if (!confirm(`确定删除这条${what}吗？删除后无法恢复。`)) return;
    try { await deleteItem(store, id); renderAll(); toast('已删除'); }
    catch (err) { alert(friendlyError(err)); }
  }

  // ---------- charts (SVG, no external library) ----------
  const SVG = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function drawChart(group) {
    const g = KF.chartGeometry(group.points, group.ref);
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${g.width} ${g.height}`, role: 'img' });
    const refTxt = group.ref ? `，参考范围 ${KF.refText(group.ref)}` : '';
    svg.append(svgEl('title', {}, `${group.name} 趋势图，共 ${group.points.length} 次，最近 ${KF.fmt(group.last.value)}（${group.last.date}）${refTxt}`));
    if (g.band) svg.append(svgEl('rect', { class: 'band', x: g.band.x, y: g.band.y, width: g.band.width, height: g.band.height }));
    for (const t of g.yTicks) {
      svg.append(svgEl('line', { class: 'grid', x1: g.left, x2: g.right, y1: t.y, y2: t.y }));
      svg.append(svgEl('text', { x: g.left - 6, y: t.y + 4, 'text-anchor': 'end' }, KF.fmt(t.value)));
    }
    svg.append(svgEl('line', { class: 'axis', x1: g.left, x2: g.right, y1: g.bottom, y2: g.bottom }));
    g.xTicks.forEach((t, i) => {
      const anchor = g.xTicks.length === 1 ? 'middle' : i === 0 ? 'start' : i === g.xTicks.length - 1 ? 'end' : 'middle';
      svg.append(svgEl('text', { x: t.x, y: g.bottom + 18, 'text-anchor': anchor }, mdShort(t.date)));
    });
    if (g.dots.length > 1) svg.append(svgEl('path', { class: 'line', d: g.path }));
    const labelAll = g.dots.length <= 8;
    g.dots.forEach((d, i) => {
      svg.append(svgEl('circle', { class: 'dot' + (d.status === 'high' || d.status === 'low' ? ' ' + d.status : ''), cx: d.x, cy: d.y, r: 4 }));
      if (labelAll || i === g.dots.length - 1) {
        const anchor = d.x < g.left + 20 ? 'start' : d.x > g.right - 20 ? 'end' : 'middle';
        svg.append(svgEl('text', { class: 'vlabel', x: d.x, y: d.y < g.top + 16 ? d.y + 15 : d.y - 8, 'text-anchor': anchor }, KF.fmt(d.value)));
      }
    });
    return svg;
  }
  function chartCard(group) {
    const card = el('div', 'card chart-card');
    const h = el('h3', null, group.name + ' 趋势');
    if (group.ref) h.append(el('small', null, `参考范围 ${KF.refText(group.ref)}`));
    card.append(h, drawChart(group));
    return card;
  }

  // ---------- render: markers ----------
  function statusTag(status) {
    if (status === 'high') return el('span', 'tag high', '↑ 偏高');
    if (status === 'low') return el('span', 'tag low', '↓ 偏低');
    return null;
  }
  function renderMarkers() {
    const groups = KF.groupMarkers(data.markers);
    const charts = $('charts');
    charts.textContent = '';
    for (const g of groups) charts.append(chartCard(g));
    const hist = $('markerHistory');
    hist.textContent = '';
    if (!groups.length) { hist.append(el('div', 'empty', '还没有记录。添加数据后，这里和上方会显示每个指标的趋势图。')); }
    for (const g of groups) {
      hist.append(el('h3', 'group-title', g.name));
      for (const m of g.points.slice().reverse()) {
        const row = el('div', 'mrow');
        row.append(el('span', 'v', KF.fmt(m.value)), el('span', 'd', m.date));
        const ref = m.refMin !== null || m.refMax !== null ? { min: m.refMin, max: m.refMax } : null;
        const tag = statusTag(KF.refStatus(m.value, ref));
        if (tag) row.append(tag);
        row.append(btn('删除', 'small danger', () => confirmDelete('markers', m.id, `${m.name} ${m.date} 的记录`), `删除 ${m.name} ${m.date} 的记录`));
        hist.append(row);
      }
    }
    const names = new Set(KF.COMMON_MARKERS);
    data.markers.forEach((m) => names.add(m.name));
    const dl = $('markerNames');
    dl.textContent = '';
    for (const n of names) { const o = el('option'); o.value = n; dl.append(o); }
  }

  // ---------- render: reports / treatments / notes ----------
  function emptyLi(text) { const li = el('li', 'empty', text); return li; }
  function renderReports() {
    const ul = $('reportList');
    ul.textContent = '';
    const list = data.reports.slice().sort(byDateDesc);
    if (!list.length) ul.append(emptyLi('还没有报告。'));
    for (const r of list) {
      const li = el('li', 'item');
      const head = el('div', 'item-head');
      head.append(el('b', null, r.type + ' 报告'), el('span', 'item-date', md(r.date)));
      li.append(head, el('p', null, r.fileName));
      const th = thumbFor(r);
      if (th) li.append(th);
      const acts = fileActions(r);
      acts.append(btn('删除', 'small danger', () => confirmDelete('reports', r.id, `${r.type} 报告`), `删除 ${r.date} ${r.type} 报告`));
      li.append(acts);
      ul.append(li);
    }
  }
  function renderTreatments() {
    const ul = $('treatList');
    ul.textContent = '';
    const list = data.treatments.slice().sort(byDateDesc);
    if (!list.length) ul.append(emptyLi('还没有治疗记录。'));
    for (const t of list) {
      const li = el('li', 'item');
      const head = el('div', 'item-head');
      head.append(el('b', null, `${t.type} · ${t.plan}`), el('span', 'item-date', md(t.date)));
      li.append(head);
      if (t.note) li.append(el('p', null, t.note));
      const acts = t.file ? fileActions(t.file) : el('div', 'actions');
      if (t.file) { li.append(el('p', 'hint', '📎 ' + t.file.fileName)); const th = thumbFor(t.file); if (th) li.append(th); }
      acts.append(btn('删除', 'small danger', () => confirmDelete('treatments', t.id, '治疗记录'), `删除 ${t.date} ${t.plan}`));
      li.append(acts);
      ul.append(li);
    }
  }
  function renderNotes() {
    const ul = $('noteList');
    ul.textContent = '';
    const list = data.notes.slice().sort(byDateDesc);
    if (!list.length) ul.append(emptyLi('还没有笔记。'));
    for (const n of list) {
      const li = el('li', 'item');
      const head = el('div', 'item-head');
      head.append(el('b', null, n.doctor || '笔记'), el('span', 'item-date', md(n.date)));
      li.append(head, el('p', null, n.content));
      const acts = el('div', 'actions');
      acts.append(btn('删除', 'small danger', () => confirmDelete('notes', n.id, '笔记'), `删除 ${n.date} 的笔记`));
      li.append(acts);
      ul.append(li);
    }
  }

  // ---------- render: backup ----------
  const totalCount = () => STORES.reduce((s, k) => s + data[k].length, 0);
  function daysSince(iso) { return iso ? KF.dayNum(KF.todayISO()) - KF.dayNum(iso.slice(0, 10)) : null; }
  function renderBackup() {
    const n = totalCount();
    const ago = daysSince(meta.lastBackup);
    $('backupInfo').textContent = `共 ${data.markers.length} 条标志物、${data.reports.length} 份报告、${data.treatments.length} 条治疗、${data.notes.length} 条笔记。` +
      (meta.lastBackup ? `上次备份：${md(meta.lastBackup.slice(0, 10))}${ago > 0 ? `（${ago} 天前）` : '（今天）'}。` : '还没有备份过。');
    const banner = $('backupBanner');
    const due = !DEMO && n > 0 && (ago === null || ago >= BACKUP_REMIND_DAYS);
    banner.hidden = !due;
    if (due) banner.textContent = ago === null ? '提醒：记录还没有备份过，换手机或清理浏览器会丢失。请到“备份”页导出。' : `提醒：已经 ${ago} 天没备份了，请到“备份”页导出。`;
  }
  async function renderStorage() {
    const box = $('storageInfo');
    let txt = DEMO ? '演示模式不保存任何数据。' : idb ? '' : '⚠ 本浏览器无法使用本地数据库，记录不会被保存。请用 Chrome 打开 https 网址。';
    if (!DEMO && idb && navigator.storage) {
      try {
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        txt += persisted ? '已开启“持久保存”：系统清理空间时不会自动删掉这些记录。' : '未开启“持久保存”：安装到桌面后通常会自动开启。';
        if (navigator.storage.estimate) {
          const e = await navigator.storage.estimate();
          if (e.usage != null) txt += ` 已用约 ${fmtSize(e.usage)}。`;
        }
      } catch (_) { /* not supported */ }
    }
    if (location.protocol === 'file:' || location.protocol === 'content:') txt += ' ⚠ 现在是以文件方式打开的，不能安装到桌面，也不能离线使用。';
    box.textContent = txt;
  }

  function renderAll() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    renderMarkers();
    renderReports();
    renderTreatments();
    renderNotes();
    renderBackup();
  }

  // ---------- forms ----------
  const today = () => KF.todayISO();
  function resetDates() {
    for (const id of ['mDate', 'rDate', 'tDate', 'nDate']) { $(id).max = today(); if (!$(id).value) $(id).value = today(); }
  }
  function fillSelect(id, options) { const s = $(id); for (const o of options) s.append(el('option', null, o)); }

  $('mName').addEventListener('change', () => {
    // reuse the last reference range typed for this marker
    const name = $('mName').value.trim();
    const g = KF.groupMarkers(data.markers).find((x) => x.name === name);
    if (g && g.ref && !$('mRefMin').value && !$('mRefMax').value) {
      $('mRefMin').value = g.ref.min ?? '';
      $('mRefMax').value = g.ref.max ?? '';
    }
  });
  $('markerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('mName').value.trim(), date = $('mDate').value;
    const value = KF.parseNumber($('mValue').value);
    const refMin = KF.parseNumber($('mRefMin').value), refMax = KF.parseNumber($('mRefMax').value);
    if (!name) return showErr('mErr', '请填写名称');
    if (!KF.isValidDate(date)) return showErr('mErr', '请选择日期');
    if (date > today()) return showErr('mErr', '日期不能晚于今天');
    if (value === null || Number.isNaN(value)) return showErr('mErr', '请填写正确的数值，例如 3.5');
    if (Number.isNaN(refMin) || Number.isNaN(refMax)) return showErr('mErr', '参考范围请填数字，或留空');
    const m = KF.sanitizeMarker({ id: KF.newId(), name, date, value, refMin, refMax });
    try {
      await saveItem('markers', m);
      showErr('mErr', '');
      $('mValue').value = '';
      renderAll();
      toast(`已添加 ${name} ${KF.fmt(value)}`);
    } catch (err) { showErr('mErr', friendlyError(err)); }
  });

  $('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('rFile').files[0], date = $('rDate').value;
    if (!KF.isValidDate(date)) return showErr('rErr', '请选择日期');
    const fe = checkFile(file);
    if (fe) return showErr('rErr', fe);
    // Stored as a Blob (not base64 text): smaller and no 5 MB localStorage limit.
    const r = KF.sanitizeReport({ id: KF.newId(), type: $('rType').value, date, fileName: file.name, blob: file, mime: file.type });
    try {
      await saveItem('reports', r);
      showErr('rErr', '');
      $('rFile').value = '';
      renderAll();
      toast('报告已保存');
    } catch (err) { showErr('rErr', friendlyError(err)); }
  });

  $('treatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('tDate').value, plan = $('tPlan').value.trim(), file = $('tFile').files[0];
    if (!KF.isValidDate(date)) return showErr('tErr', '请选择日期');
    if (!plan) return showErr('tErr', '请填写方案/药物');
    if (file) { const fe = checkFile(file); if (fe) return showErr('tErr', fe); }
    const t = KF.sanitizeTreatment({
      id: KF.newId(), date, type: $('tType').value, plan, note: $('tNote').value,
      file: file ? { fileName: file.name, blob: file, mime: file.type } : null,
    });
    try {
      await saveItem('treatments', t);
      showErr('tErr', '');
      $('tPlan').value = ''; $('tNote').value = ''; $('tFile').value = '';
      renderAll();
      toast('治疗记录已保存');
    } catch (err) { showErr('tErr', friendlyError(err)); }
  });

  $('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('nDate').value, content = $('nContent').value.trim();
    if (!KF.isValidDate(date)) return showErr('nErr', '请选择日期');
    if (!content) return showErr('nErr', '请填写内容');
    const n = KF.sanitizeNote({ id: KF.newId(), date, doctor: $('nDoctor').value, content });
    try {
      await saveItem('notes', n);
      showErr('nErr', '');
      $('nDoctor').value = ''; $('nContent').value = '';
      renderAll();
      toast('笔记已保存');
    } catch (err) { showErr('nErr', friendlyError(err)); }
  });

  // ---------- backup / restore ----------
  async function fileToJson(f) {
    if (!f) return null;
    const out = { fileName: f.fileName, mime: f.mime || '' };
    if (f.blob) { out.data = await blobToDataUrl(f.blob); out.mime = out.mime || f.blob.type; }
    else out.data = f.data;
    return out;
  }
  $('btnBackup').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!totalCount()) return toast('还没有记录可以备份');
    b.disabled = true;
    b.textContent = '正在打包…';
    try {
      const reports = [];
      for (const r of data.reports) reports.push(Object.assign({ id: r.id, date: r.date, type: r.type }, await fileToJson(r)));
      const treatments = [];
      for (const t of data.treatments) treatments.push({ id: t.id, date: t.date, type: t.type, plan: t.plan, note: t.note, file: await fileToJson(t.file) });
      const backup = KF.buildBackup({ markers: data.markers, notes: data.notes, reports, treatments });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const how = await shareOrDownload(blob, `康复记录备份_${today()}.json`, 'application/json');
      if (how === 'cancelled') return;
      meta.lastBackup = new Date().toISOString().slice(0, 10);
      await write('meta', (os) => os.put({ key: 'lastBackup', value: meta.lastBackup }));
      renderBackup();
      toast(how === 'downloaded' ? `备份已保存到“下载”文件夹（${fmtSize(blob.size)}）` : '备份已分享');
    } catch (err) {
      alert('备份失败：' + ((err && err.message) || err));
    } finally {
      b.disabled = false;
      b.textContent = '导出备份文件';
    }
  });

  /** Imported files arrive as data URLs; store them as Blobs like newly uploaded ones. */
  function toStoredFile(f) {
    if (!f) return null;
    if (f.blob) return f;
    const b = KF.dataUrlToBytes(f.data);
    return b ? { fileName: f.fileName, mime: f.mime || b.mime, blob: new Blob([b.bytes], { type: f.mime || b.mime }) } : null;
  }
  $('importFile').addEventListener('change', async (e) => {
    const input = e.currentTarget;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    let parsed;
    try { parsed = KF.parseImport(await file.text()); }
    catch (err) { return alert(err.message); }
    const plan = {};
    let fresh = 0, dup = 0;
    for (const s of STORES) {
      const r = KF.splitNew(data[s], parsed[s]);
      plan[s] = r.fresh; fresh += r.fresh.length; dup += r.dup;
    }
    if (!fresh) return alert(`没有需要恢复的新记录${dup ? `（${dup} 条本机已经有了）` : ''}。`);
    const summary = `将添加：标志物 ${plan.markers.length} 条、报告 ${plan.reports.length} 份、治疗 ${plan.treatments.length} 条、笔记 ${plan.notes.length} 条。` +
      (dup ? `\n另有 ${dup} 条本机已有，会跳过。` : '') + (parsed.skipped ? `\n有 ${parsed.skipped} 条数据不完整，会跳过。` : '') + '\n\n现有记录不会被覆盖。继续吗？';
    if (!confirm(summary)) return;
    try {
      for (const s of STORES) {
        for (const item of plan[s]) {
          if (s === 'reports') {
            const f = toStoredFile(item);
            if (!f) continue;
            await saveItem(s, { id: item.id, date: item.date, type: item.type, fileName: f.fileName, blob: f.blob, mime: f.mime });
          } else if (s === 'treatments') {
            await saveItem(s, Object.assign({}, item, { file: toStoredFile(item.file) }));
          } else {
            await saveItem(s, item);
          }
        }
      }
      renderAll();
      toast(`已恢复 ${fresh} 条记录`);
    } catch (err) {
      renderAll();
      alert(friendlyError(err) + '\n已恢复的部分会保留，可以再次选择同一文件继续（不会重复添加）。');
    }
  });

  $('btnWipe').addEventListener('click', async () => {
    if (!totalCount()) return toast('本机没有记录');
    if (!confirm('确定删除本机全部记录吗？包括所有报告文件。')) return;
    if (!confirm('再次确认：删除后无法恢复，除非你有备份文件。真的全部删除？')) return;
    try {
      for (const s of STORES) { await write(s, (os) => os.clear()); data[s] = []; }
      renderAll();
      toast('已全部删除');
    } catch (err) { alert(friendlyError(err)); }
  });

  // ---------- print report (save as PDF) ----------
  function buildPrintArea() {
    const p = $('printArea');
    p.textContent = '';
    p.append(el('h1', null, '康复记录报告'), el('p', 'hint', `生成日期：${md(today())}`));
    const groups = KF.groupMarkers(data.markers);
    if (groups.length) {
      p.append(el('h2', null, '肿瘤标志物趋势'));
      for (const g of groups) {
        p.append(chartCard(g));
        const line = g.points.map((m) => `${m.date}：${KF.fmt(m.value)}`).join('；');
        p.append(el('p', 'hint', line));
      }
    }
    const section = (title, list, fn) => {
      p.append(el('h2', null, title));
      if (!list.length) { p.append(el('p', null, '无')); return; }
      for (const x of list.slice().sort(byDateDesc)) p.append(fn(x));
    };
    const item = (head, body) => { const d = el('div', 'item'); d.append(el('b', null, head)); if (body) d.append(el('p', null, body)); return d; };
    section('治疗记录', data.treatments, (t) => item(`${t.date}  ${t.type} · ${t.plan}`, t.note));
    section('医嘱与笔记', data.notes, (n) => item(`${n.date}  ${n.doctor || '笔记'}`, n.content));
    section('检查报告', data.reports, (r) => item(`${r.date}  ${r.type}`, r.fileName));
  }
  $('btnPrint').addEventListener('click', () => {
    if (!totalCount()) return toast('还没有记录');
    buildPrintArea();
    toast('在打印页面选择“另存为 PDF”');
    setTimeout(() => window.print(), 300);
  });

  // ---------- tabs ----------
  const TABS = ['markers', 'reports', 'treatments', 'notes', 'backup'];
  function showTab(name) {
    for (const t of TABS) {
      $('tab-' + t).hidden = t !== name;
      $('t-' + t).setAttribute('aria-selected', String(t === name));
    }
    if (name === 'backup') renderStorage();
    window.scrollTo(0, 0);
  }
  document.querySelector('nav.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  // ---------- install ----------
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('btnInstall').hidden = false; });
  $('btnInstall').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    $('btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; toast('已安装到桌面'); });

  // Refresh "today" if the app was left open over midnight.
  let shownDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && today() !== shownDay) {
      shownDay = today();
      for (const id of ['mDate', 'rDate', 'tDate', 'nDate']) $(id).value = '';
      resetDates();
    }
  });

  // ---------- start ----------
  async function start() {
    fillSelect('rType', KF.REPORT_TYPES);
    fillSelect('tType', KF.TREATMENT_TYPES);
    resetDates();
    if (DEMO) {
      $('demoBanner').hidden = false;
      Object.assign(data, KF.makeDemoData(today()));
    } else {
      try {
        idb = await openDB();
        await loadAll();
      } catch (err) {
        idb = null;
        alert('无法打开本地数据库，记录将不会被保存。\n' + ((err && err.message) || err));
      }
    }
    renderAll();
    const startTab = location.hash.slice(1);
    if (TABS.includes(startTab)) showTab(startTab);
    if (!DEMO && idb && navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
    }
    const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
    }
  }
  start();
})();
