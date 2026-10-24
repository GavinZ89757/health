/*
 * 康复记录 · UI layer.
 */
(function () {
  'use strict';
  const KF = window.KF;
  const $ = (id) => document.getElementById(id);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const DB_NAME = 'kangfu-records';
  const STORES = ['markers', 'reports', 'treatments', 'notes'];
  const MAX_FILE = 50 * 1024 * 1024;
  const BACKUP_REMIND_DAYS = 30;

  const data = { markers: [], reports: [], treatments: [], notes: [] };
  const meta = { lastBackup: null };
  let idb = null;
  let installPrompt = null;
  let objectUrls = [];

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
    });
  }
  function write(store, fn) {
    if (!idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(store, 'readwrite');
      fn(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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
    if (err && err.name === 'QuotaExceededError') return '手机存储空间不足，保存失败。';
    return '保存失败：' + ((err && err.message) || err);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
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
  async function openFile(f) {
    const blob = fileBlob(f);
    if (!blob) return toast('文件无法读取');
    if (/^image\//.test(blob.type) || /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(f.fileName)) {
      try {
        const url = await blobToDataUrl(blob);
        return openViewer([url], [['长按图片 → 选"保存图片"', true], ['，就会存进手机相册。']], f.fileName);
      } catch (_) { return toast('图片无法打开'); }
    }
    const how = await shareOrDownload(blob, f.fileName, blob.type || 'application/octet-stream');
    if (how === 'downloaded') toast('已交给浏览器下载。');
  }
  function fileActions(f) {
    const box = el('div', 'actions');
    const isImg = /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(f.fileName) || /^image\//.test(f.mime || (f.blob && f.blob.type) || '');
    box.append(btn(isImg ? '查看 / 保存到相册' : '打开文件', 'small', () => openFile(f), `打开 ${f.fileName}`));
    return box;
  }

  let viewerReturn = null;
  function openViewer(urls, tip, alt) {
    viewerReturn = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const tipEl = $('viewerTip');
    tipEl.textContent = '';
    for (const [text, bold] of tip) tipEl.append(bold ? el('b', null, text) : document.createTextNode(text));
    const box = $('viewerImgs');
    box.textContent = '';
    urls.forEach((u, i) => {
      const img = el('img');
      img.src = u;
      img.alt = (alt || '图片') + (urls.length > 1 ? ` 第 ${i + 1} 张` : '');
      box.append(img);
    });
    box.scrollTop = 0;
    $('viewer').hidden = false;
    document.body.style.overflow = 'hidden';
    $('viewerClose').focus();
  }
  function closeViewer() {
    $('viewer').hidden = true;
    $('viewerImgs').textContent = '';
    document.body.style.overflow = '';
    if (viewerReturn && viewerReturn.isConnected && viewerReturn.focus) viewerReturn.focus();
    viewerReturn = null;
  }
  $('viewerClose').addEventListener('click', closeViewer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('viewer').hidden) closeViewer(); });
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
    svg.append(svgEl('title', {}, `${group.name} 趋势图，共 ${group.points.length} 次${refTxt}`));
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
    if (!groups.length) { hist.append(el('div', 'empty', '还没有记录。')); }
    for (const g of groups) {
      hist.append(el('h3', 'group-title', g.name));
      for (const m of g.points.slice().reverse()) {
        const row = el('div', 'mrow');
        row.append(el('span', 'v', KF.fmt(m.value)), el('span', 'd', m.date));
        const ref = m.refMin !== null || m.refMax !== null ? { min: m.refMin, max: m.refMax } : null;
        const tag = statusTag(KF.refStatus(m.value, ref));
        if (tag) row.append(tag);
        row.append(btn('删除', 'small danger', () => confirmDelete('markers', m.id, `${m.name} ${m.date} 的记录`)));
        hist.append(row);
      }
    }
    const names = new Set(KF.COMMON_MARKERS);
    data.markers.forEach((m) => names.add(m.name));
    const dl = $('markerNames');
    dl.textContent = '';
    for (const n of names) { const o = el('option'); o.value = n; dl.append(o); }
  }

  function emptyLi(text) { return el('li', 'empty', text); }
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
      if (r.text) li.append(el('div', 'report-text-display', r.text));
      const th = thumbFor(r);
      if (th) li.append(th);
      const acts = fileActions(r);
      acts.append(btn('删除', 'small danger', () => confirmDelete('reports', r.id, `${r.type} 报告`)));
      li.append(acts);
      ul.append(li);
    }
  }

  function renderTreatments() {
    const ul = $('treatList');
    ul.textContent = '';
    const list = data.treatments.slice().sort(byDateDesc);
    if (!list.length) { ul.append(emptyLi('还没有治疗记录。')); return; }
    for (const t of list) {
      const item = el('div', 'tl-item');
      const title = el('div', 'tl-title');
      title.append(el('span', null, `${mdShort(t.date)} · ${t.type} · ${t.plan}`));
      title.addEventListener('click', () => {
        const detail = item.querySelector('.tl-detail');
        detail.classList.toggle('open');
      });
      const detail = el('div', 'tl-detail');
      if (t.note) detail.append(el('p', null, t.note));
      if (t.file) {
        detail.append(el('p', 'hint', '📎 ' + t.file.fileName));
        const th = thumbFor(t.file);
        if (th) detail.append(th);
        detail.append(fileActions(t.file));
      }
      const acts = el('div', 'actions');
      acts.append(btn('编辑', 'small', () => editTreatment(t)));
      acts.append(btn('删除', 'small danger', () => confirmDelete('treatments', t.id, '治疗记录')));
      detail.append(acts);
      item.append(title, detail);
      ul.append(item);
    }
  }
  function editTreatment(t) {
    const newPlan = prompt('修改方案/药物', t.plan);
    if (newPlan === null) return;
    const newNote = prompt('修改备注', t.note || '');
    if (newNote === null) return;
    t.plan = newPlan.trim() || t.plan;
    t.note = newNote.trim();
    saveItem('treatments', t).then(() => { renderAll(); toast('已更新'); }).catch((err) => alert(friendlyError(err)));
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
      acts.append(btn('删除', 'small danger', () => confirmDelete('notes', n.id, '笔记')));
      li.append(acts);
      ul.append(li);
    }
  }

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
    if (due) banner.textContent = ago === null ? '提醒：记录还没有备份过，请到"备份"页导出。' : `提醒：已经 ${ago} 天没备份了。`;
  }
  async function renderStorage() {
    const box = $('storageInfo');
    let txt = DEMO ? '演示模式不保存任何数据。' : idb ? '' : '⚠ 本浏览器无法使用本地数据库。';
    if (!DEMO && idb && navigator.storage) {
      try {
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        txt += persisted ? '已开启"持久保存"。' : '未开启"持久保存"。';
        if (navigator.storage.estimate) {
          const e = await navigator.storage.estimate();
          if (e.usage != null) txt += ` 已用约 ${fmtSize(e.usage)}。`;
        }
      } catch (_) { }
    }
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

  const today = () => KF.todayISO();
  function resetDates() {
    for (const id of ['mDate', 'rDate', 'tDate', 'nDate']) { $(id).max = today(); if (!$(id).value) $(id).value = today(); }
  }
  function fillSelect(id, options) { const s = $(id); for (const o of options) s.append(el('option', null, o)); }

  $('mName').addEventListener('change', () => {
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
    if (value === null || Number.isNaN(value)) return showErr('mErr', '请填写正确的数值');
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

  // 报告表单 - 直接读 input.files（无 JS click 触发）
  $('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('rFile').files[0], date = $('rDate').value;
    if (!KF.isValidDate(date)) return showErr('rErr', '请选择日期');
    if (!file) return showErr('rErr', '请选择文件');
    const fe = checkFile(file);
    if (fe) return showErr('rErr', fe);
    const text = $('rText').value.trim();
    const r = KF.sanitizeReport({ id: KF.newId(), type: $('rType').value, date, fileName: file.name, blob: file, mime: file.type, text });
    try {
      await saveItem('reports', r);
      showErr('rErr', '');
      $('rFile').value = '';
      $('rText').value = '';
      renderAll();
      toast('报告已保存');
    } catch (err) { showErr('rErr', friendlyError(err)); }
  });

  // 治疗表单
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

  $('toggleMarkerHistory').addEventListener('click', () => {
    const hist = $('markerHistory');
    const btn = $('toggleMarkerHistory');
    const open = hist.hidden;
    hist.hidden = !open;
    btn.textContent = open ? '收起' : '展开';
    btn.setAttribute('aria-expanded', String(open));
  });

  // ---------- 备份 / 恢复（与之前相同，此处省略重复逻辑，保持原样）----------
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
    b.disabled = true; b.textContent = '正在打包…';
    try {
      const reports = [];
      for (const r of data.reports) reports.push(Object.assign({ id: r.id, date: r.date, type: r.type, text: r.text || '' }, await fileToJson(r)));
      const treatments = [];
      for (const t of data.treatments) treatments.push({ id: t.id, date: t.date, type: t.type, plan: t.plan, note: t.note, file: await fileToJson(t.file) });
      const backup = KF.buildBackup({ markers: data.markers, notes: data.notes, reports, treatments });
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const how = await shareOrDownload(blob, `康复记录备份_${today()}.json`, 'application/json');
      if (how === 'cancelled') return;
      if (how === 'shared') { await markBackedUp(); toast('备份已分享'); }
      else alert(`已交给浏览器下载。请到"文件管理 → 下载"确认。`);
    } catch (err) { alert('备份失败：' + ((err && err.message) || err)); }
    finally { b.disabled = false; b.textContent = '导出完整备份文件'; }
  });
  async function markBackedUp() {
    meta.lastBackup = new Date().toISOString().slice(0, 10);
    await write('meta', (os) => os.put({ key: 'lastBackup', value: meta.lastBackup }));
    renderBackup();
  }
  function copyWithExecCommand(text) {
    const ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; } ta.remove(); return ok;
  }
  $('btnCopyBackup').addEventListener('click', async () => {
    if (!totalCount()) return toast('还没有记录可以备份');
    const backup = KF.buildTextBackup(data);
    const text = JSON.stringify(backup);
    $('copyFallback').hidden = true;
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { ok = false; }
    if (!ok) ok = copyWithExecCommand(text);
    if (ok) { await markBackedUp(); alert(`已复制备份内容。粘贴到微信"文件传输助手"保存。`); }
    else { $('backupText').value = text; $('copyFallback').hidden = false; $('backupText').focus(); $('backupText').select(); }
  });
  $('btnCopied').addEventListener('click', async () => { await markBackedUp(); $('copyFallback').hidden = true; $('backupText').value = ''; toast('好的，记得保存'); });
  $('btnRestoreText').addEventListener('click', async () => {
    const text = $('restoreText').value;
    if (!text.trim()) return showErr('restoreErr', '请先粘贴备份内容');
    let parsed; try { parsed = KF.parseImport(text); } catch (err) { return showErr('restoreErr', err.message); }
    showErr('restoreErr', '');
    if (await importParsed(parsed)) $('restoreText').value = '';
  });
  function toStoredFile(f) {
    if (!f) return null;
    if (f.blob) return f;
    const b = KF.dataUrlToBytes(f.data);
    return b ? { fileName: f.fileName, mime: f.mime || b.mime, blob: new Blob([b.bytes], { type: f.mime || b.mime }) } : null;
  }
  $('importFile').addEventListener('change', async (e) => {
    const input = e.currentTarget; const file = input.files[0]; input.value = '';
    if (!file) return;
    let parsed; try { parsed = KF.parseImport(await file.text()); } catch (err) { return alert(err.message); }
    await importParsed(parsed);
  });
  async function importParsed(parsed) {
    const plan = {}; let fresh = 0, dup = 0;
    for (const s of STORES) { const r = KF.splitNew(data[s], parsed[s]); plan[s] = r.fresh; fresh += r.fresh.length; dup += r.dup; }
    if (!fresh) { alert('没有需要恢复的新记录。'); return false; }
    if (!confirm(`将添加：${fresh} 条记录。继续吗？`)) return false;
    try {
      for (const s of STORES) {
        for (const item of plan[s]) {
          if (s === 'reports') { const f = toStoredFile(item); if (!f) continue; await saveItem(s, { id: item.id, date: item.date, type: item.type, fileName: f.fileName, blob: f.blob, mime: f.mime, text: item.text || '' }); }
          else if (s === 'treatments') { await saveItem(s, Object.assign({}, item, { file: toStoredFile(item.file) })); }
          else { await saveItem(s, item); }
        }
      }
      renderAll(); toast(`已恢复 ${fresh} 条记录`); return true;
    } catch (err) { renderAll(); alert(friendlyError(err)); return false; }
  }
  $('btnWipe').addEventListener('click', async () => {
    if (!totalCount()) return toast('本机没有记录');
    if (!confirm('确定删除本机全部记录吗？')) return;
    if (!confirm('再次确认：删除后无法恢复。真的全部删除？')) return;
    try { for (const s of STORES) { await write(s, (os) => os.clear()); data[s] = []; } renderAll(); toast('已全部删除'); }
    catch (err) { alert(friendlyError(err)); }
  });

  // ---------- 报告图片 ----------
  const REPORT_W = 720, REPORT_SCALE = 2, PAGE_MAX = 4800, PAD = 28;
  const FONT = '-apple-system, Roboto, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const CHART_CSS = 'text{font-size:11px;fill:#555;font-family:sans-serif}.grid{stroke:#e3e4ef;stroke-width:1}.axis{stroke:#b8bad3;stroke-width:1}.band{fill:rgba(91,95,199,.13)}.line{fill:none;stroke:#5b5fc7;stroke-width:2.2;stroke-linejoin:round}.dot{fill:#fff;stroke:#5b5fc7;stroke-width:2}.dot.high{stroke:#c92a2a;fill:#c92a2a}.dot.low{stroke:#1864ab;fill:#1864ab}text.vlabel{font-size:10.5px;fill:#333}';
  function svgToImage(svg, w, h) {
    const clone = svg.cloneNode(true); clone.setAttribute('xmlns', SVG); clone.setAttribute('width', w); clone.setAttribute('height', h);
    const style = document.createElementNS(SVG, 'style'); style.textContent = CHART_CSS; clone.insertBefore(style, clone.firstChild);
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    return img.decode().then(() => img);
  }
  async function buildReportBlocks() {
    const mctx = document.createElement('canvas').getContext('2d');
    const inner = REPORT_W - PAD * 2;
    const blocks = [];
    const text = (str, size, opts = {}) => {
      const font = `${opts.bold ? '600 ' : ''}${size}px ${FONT}`; mctx.font = font;
      const indent = opts.indent || 0;
      const lines = KF.wrapLines(str, inner - indent - (opts.right || 0), (s) => mctx.measureText(s).width);
      const lh = Math.round(size * 1.5);
      return { lines, font, lh, indent, color: opts.color || '#262626', align: opts.align, h: lines.length * lh };
    };
    const drawText = (ctx, t, x, y) => {
      ctx.font = t.font; ctx.fillStyle = t.color; ctx.textAlign = t.align === 'center' ? 'center' : 'left';
      t.lines.forEach((l, i) => ctx.fillText(l, t.align === 'center' ? REPORT_W / 2 : x + t.indent, y + t.lh * i + t.lh * 0.78));
      ctx.textAlign = 'left';
    };
    const textBlock = (str, size, opts = {}) => {
      const t = text(str, size, opts); const gap = opts.gap == null ? 6 : opts.gap;
      blocks.push({ h: t.h + gap, draw: (ctx, y) => drawText(ctx, t, PAD, y) });
    };
    const heading = (str) => {
      const t = text(str, 20, { bold: true, color: '#3f43a3' });
      blocks.push({ h: 18 + t.h + 12, draw: (ctx, y) => { drawText(ctx, t, PAD, y + 18); ctx.fillStyle = '#5b5fc7'; ctx.fillRect(PAD, y + 18 + t.h + 4, inner, 2); } });
    };
    const item = (head, body) => {
      const a = text(head, 15, { bold: true, indent: 14 }); const b = body ? text(body, 15, { indent: 14 }) : null;
      const h = 10 + a.h + (b ? 2 + b.h : 0) + 10;
      blocks.push({ h: h + 8, draw: (ctx, y) => { ctx.fillStyle = '#f4f4fc'; ctx.fillRect(PAD, y, inner, h); ctx.fillStyle = '#5b5fc7'; ctx.fillRect(PAD, y, 4, h); drawText(ctx, a, PAD, y + 10); if (b) drawText(ctx, b, PAD, y + 12 + a.h); } });
    };
    textBlock('康复记录报告', 26, { bold: true, align: 'center', gap: 2 });
    textBlock(`生成日期：${md(today())}`, 14, { align: 'center', color: '#616161', gap: 4 });
    const groups = KF.groupMarkers(data.markers);
    if (groups.length) {
      heading('肿瘤标志物趋势');
      for (const g of groups) {
        textBlock(g.name + (g.ref ? `　参考范围 ${KF.refText(g.ref)}` : ''), 16, { bold: true, gap: 2 });
        const w = inner, h = Math.round((inner * 190) / 340);
        const img = await svgToImage(drawChart(g), w, h);
        blocks.push({ h: h + 4, draw: (ctx, y) => ctx.drawImage(img, PAD, y, w, h) });
        textBlock(g.points.map((m) => `${m.date}：${KF.fmt(m.value)}`).join('；'), 13, { color: '#616161', gap: 12 });
      }
    }
    const section = (title, list, fn) => { heading(title); if (!list.length) { textBlock('无', 15); return; } for (const x of list.slice().sort(byDateDesc)) fn(x); };
    section('治疗记录', data.treatments, (t) => item(`${t.date}　${t.type} · ${t.plan}`, t.note));
    section('医嘱与笔记', data.notes, (n) => item(`${n.date}　${n.doctor || '笔记'}`, n.content));
    section('检查报告', data.reports, (r) => item(`${r.date}　${r.type}`, r.fileName + (r.text ? '\n' + r.text : '')));
    return blocks;
  }
  async function renderReportImages() {
    const blocks = await buildReportBlocks();
    const pages = KF.paginate(blocks.map((b) => b.h), PAGE_MAX - PAD * 2 - 40);
    return pages.map((idx, p) => {
      const head = p > 0 ? 34 : 0; const h = PAD * 2 + head + idx.reduce((s, i) => s + blocks[i].h, 0);
      const canvas = document.createElement('canvas'); canvas.width = REPORT_W * REPORT_SCALE; canvas.height = Math.ceil(h * REPORT_SCALE);
      const ctx = canvas.getContext('2d'); ctx.scale(REPORT_SCALE, REPORT_SCALE); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, REPORT_W, h);
      if (head) { ctx.font = `13px ${FONT}`; ctx.fillStyle = '#616161'; ctx.fillText(`康复记录报告（第 ${p + 1} / ${pages.length} 张）`, PAD, PAD + 14); }
      let y = PAD + head; for (const i of idx) { blocks[i].draw(ctx, y); y += blocks[i].h; }
      return canvas.toDataURL('image/png');
    });
  }
  $('btnPrint').addEventListener('click', async (e) => {
    if (!totalCount()) return toast('还没有记录');
    const b = e.currentTarget; b.disabled = true; b.textContent = '生成中…';
    try {
      const urls = await renderReportImages();
      const tip = [['长按图片 → 选"保存图片"', true], ['，就会存进手机相册。']];
      if (urls.length > 1) tip.push([`\n共 ${urls.length} 张，请逐张保存。`]);
      openViewer(urls, tip, '康复记录报告');
    } catch (err) { alert('报告图片生成失败：' + ((err && err.message) || err)); }
    finally { b.disabled = false; b.textContent = '报告图片'; }
  });

  // ---------- tabs ----------
  const TABS = ['markers', 'reports', 'treatments', 'notes', 'backup'];
  function showTab(name) {
    for (const t of TABS) { $('tab-' + t).hidden = t !== name; $('t-' + t).setAttribute('aria-selected', String(t === name)); }
    if (name === 'backup') renderStorage();
    window.scrollTo(0, 0);
  }
  document.querySelector('nav.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

  // ---------- install ----------
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('btnInstall').hidden = false; });
  $('btnInstall').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice.catch(() => null); installPrompt = null; $('btnInstall').hidden = true; });
  window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; toast('已安装到桌面'); });

  let shownDay = today();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && today() !== shownDay) { shownDay = today(); for (const id of ['mDate', 'rDate', 'tDate', 'nDate']) $(id).value = ''; resetDates(); } });

  // ---------- start ----------
  async function start() {
    fillSelect('rType', KF.REPORT_TYPES);
    fillSelect('tType', KF.TREATMENT_TYPES);
    resetDates();
    if (DEMO) { $('demoBanner').hidden = false; Object.assign(data, KF.makeDemoData(today())); }
    else {
      try { idb = await openDB(); await loadAll(); }
      catch (err) { idb = null; alert('无法打开本地数据库。\n' + ((err && err.message) || err)); }
    }
    renderAll();
    const startTab = location.hash.slice(1);
    if (TABS.includes(startTab)) showTab(startTab);
    if (!DEMO && idb && navigator.storage && navigator.storage.persist) { navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {}); }
    const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if ('serviceWorker' in navigator && secure) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
  }
  start();
})();
