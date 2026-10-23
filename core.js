/*
 * 康复记录 · pure logic (no DOM, no storage). Shared by the browser (window.KF) and Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPORT_TYPES = ['CT', 'MRI', 'PET-CT', 'B超', '病理', '血检', '其他'];
  const TREATMENT_TYPES = ['化疗', '放疗', '手术', '靶向', '免疫', '其他'];
  const COMMON_MARKERS = ['CEA', 'CA125', 'CA19-9', 'CA15-3', 'CA72-4', 'AFP', 'CYFRA21-1', 'NSE', 'SCC', 'ProGRP', 'PSA'];
  const LIMITS = { name: 40, doctor: 60, plan: 200, note: 2000, content: 5000, fileName: 200 };

  // ---------- dates ----------
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pad2 = (n) => String(n).padStart(2, '0');
  function todayISO(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  // Whole days since 1970-01-01, computed in UTC so DST never shifts a day.
  function dayNum(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function fromDayNum(n) {
    const d = new Date(n * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function isValidDate(iso) {
    return typeof iso === 'string' && DATE_RE.test(iso) && fromDayNum(dayNum(iso)) === iso;
  }

  // ---------- input parsing ----------
  /**
   * Parse a typed number. Accepts the full-width digits / punctuation that Chinese input
   * methods (搜狗/百度/讯飞, 小米输入法) often produce: "１２．５" → 12.5, "3，5" → 3.5.
   * Returns null for empty input, NaN for unparseable input, otherwise a finite number.
   */
  function parseNumber(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
    const s = String(input == null ? '' : input)
      .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48))
      .replace(/[,\uFF0C\u3002\uFF0E]/g, '.')
      .replace(/[\uFF0D\u2212]/g, '-')
      .replace(/\s+/g, '');
    if (!s) return null;
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const optNum = (v) => { const n = parseNumber(v); return typeof n === 'number' && Number.isFinite(n) ? n : null; };
  function toId(v) {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  let lastId = 0;
  function newId(now) {
    let id = now || Date.now();
    if (id <= lastId) id = lastId + 1;
    lastId = id;
    return id;
  }

  // ---------- record sanitizers (form input, stored data and imports all pass through these) ----------
  function sanitizeMarker(m) {
    if (!m || typeof m !== 'object') return null;
    const name = str(m.name, LIMITS.name);
    const value = optNum(m.value);
    if (!name || !isValidDate(m.date) || value === null) return null;
    let refMin = optNum(m.refMin), refMax = optNum(m.refMax);
    if (refMin !== null && refMax !== null && refMin > refMax) [refMin, refMax] = [refMax, refMin];
    return { id: toId(m.id) || newId(), name, date: m.date, value, refMin, refMax };
  }
  function sanitizeNote(n) {
    if (!n || typeof n !== 'object') return null;
    const content = typeof n.content === 'string' ? n.content.trim().slice(0, LIMITS.content) : '';
    if (!content || !isValidDate(n.date)) return null;
    return { id: toId(n.id) || newId(), date: n.date, doctor: str(n.doctor, LIMITS.doctor), content };
  }
  const isDataUrl = (s) => typeof s === 'string' && /^data:[^,]*;base64,/.test(s);
  /** Treatment from a form, the database or an import. Attachment (if any) stays as given: Blob or data URL. */
  function sanitizeTreatment(t) {
    if (!t || typeof t !== 'object') return null;
    const plan = str(t.plan, LIMITS.plan);
    if (!plan || !isValidDate(t.date)) return null;
    const out = {
      id: toId(t.id) || newId(),
      date: t.date,
      type: TREATMENT_TYPES.includes(t.type) ? t.type : '其他',
      plan,
      note: typeof t.note === 'string' ? t.note.trim().slice(0, LIMITS.note) : '',
      file: null,
    };
    // new format: t.file = { fileName, data|blob } ; old single-file app: t.fileName + t.data
    const f = t.file && typeof t.file === 'object' ? t.file : { fileName: t.fileName, data: t.data };
    const fileName = str(f.fileName, LIMITS.fileName);
    if (fileName && (isDataUrl(f.data) || f.blob)) out.file = { fileName, data: f.data, blob: f.blob, mime: str(f.mime, 100) };
    return out;
  }
  function sanitizeReport(r) {
    if (!r || typeof r !== 'object' || !isValidDate(r.date)) return null;
    const fileName = str(r.fileName, LIMITS.fileName) || '报告';
    if (!isDataUrl(r.data) && !r.blob) return null;
    return {
      id: toId(r.id) || newId(),
      date: r.date,
      type: REPORT_TYPES.includes(r.type) ? r.type : '其他',
      fileName,
      data: r.data,
      blob: r.blob,
      mime: str(r.mime, 100),
    };
  }
  function sanitizeAll(src) {
    const out = { markers: [], reports: [], treatments: [], notes: [], skipped: 0 };
    const fns = { markers: sanitizeMarker, reports: sanitizeReport, treatments: sanitizeTreatment, notes: sanitizeNote };
    for (const key of Object.keys(fns)) {
      const list = src && Array.isArray(src[key]) ? src[key] : [];
      for (const item of list) {
        const clean = fns[key](item);
        if (clean) out[key].push(clean);
        else out.skipped++;
      }
    }
    return out;
  }

  // ---------- data URLs ----------
  function dataUrlToBytes(dataUrl) {
    const m = /^data:([^,;]*)(;[^,]*)?;base64,(.*)$/s.exec(dataUrl || '');
    if (!m) return null;
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1] || 'application/octet-stream', bytes };
  }

  // ---------- backup / import ----------
  const BACKUP_APP = 'kangfu-records';
  function buildBackup(data, now) {
    return {
      app: BACKUP_APP,
      version: 1,
      exportedAt: (now || new Date()).toISOString(),
      markers: data.markers || [],
      reports: data.reports || [],
      treatments: data.treatments || [],
      notes: data.notes || [],
    };
  }
  /**
   * Text-only backup for browsers that cannot download files (小米浏览器): small enough to paste into
   * 微信“文件传输助手” or 便签. Report files and treatment attachments are left out.
   */
  function buildTextBackup(data, now) {
    const b = buildBackup({
      markers: data.markers,
      notes: data.notes,
      reports: [],
      treatments: (data.treatments || []).map((t) => ({ id: t.id, date: t.date, type: t.type, plan: t.plan, note: t.note, file: null })),
    }, now);
    b.textOnly = true;
    b.omittedFiles = (data.reports || []).length + (data.treatments || []).filter((t) => t.file).length;
    return b;
  }
  /** Old single-file app: "共享副本" HTML with `window.__SHARED_DATA__ = {...};</script>` injected (possibly several times). */
  function extractSharedData(html) {
    const marker = 'window.__SHARED_DATA__ = ';
    let found = null;
    let from = 0;
    for (;;) {
      const at = html.indexOf(marker, from);
      if (at < 0) break;
      const start = at + marker.length;
      let end = html.indexOf(';</script>', start);
      while (end >= 0) {
        try { found = JSON.parse(html.slice(start, end)); break; } catch (_) { end = html.indexOf(';</script>', end + 1); }
      }
      from = start;
    }
    return found; // the last injected copy is the newest one
  }
  /** Parse a backup (.json or pasted text) or an old 共享副本 (.html). Throws Error with a Chinese message when unrecognised. */
  function parseImport(text) {
    let t = String(text || '').replace(/^\uFEFF/, '').trim();
    // Pasted from 微信/便签: tolerate extra text around the backup.
    if (!t.startsWith('{') && !t.includes('__SHARED_DATA__') && t.includes(`"app":"${BACKUP_APP}"`)) {
      t = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
    }
    let raw, source;
    if (t.startsWith('{')) {
      try { raw = JSON.parse(t); } catch (_) { throw new Error('备份内容不完整或已损坏，无法读取。如果是从微信复制的，请确认复制了全部内容。'); }
      if (!raw || raw.app !== BACKUP_APP) throw new Error('这不是“康复记录”的备份文件。');
      source = 'backup';
    } else if (t.includes('__SHARED_DATA__')) {
      raw = extractSharedData(t);
      if (!raw) throw new Error('共享副本里的数据无法读取。');
      source = 'shared-html';
    } else {
      throw new Error('内容格式不对：请选择或粘贴“康复记录”的备份内容，或旧版导出的“康复记录_共享副本_….html”。');
    }
    return Object.assign(sanitizeAll(raw), { source });
  }
  /** Split incoming records into new ones and ones already present (same id). Never overwrites. */
  function splitNew(existing, incoming) {
    const have = new Set(existing.map((x) => x.id));
    const fresh = [];
    let dup = 0;
    for (const x of incoming) {
      if (have.has(x.id)) dup++;
      else { have.add(x.id); fresh.push(x); }
    }
    return { fresh, dup };
  }

  // ---------- markers ----------
  const byDateAsc = (a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1);
  /** Group by marker name; ref range = latest record that has one. Groups ordered by most recent entry. */
  function groupMarkers(markers) {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.name)) map.set(m.name, []);
      map.get(m.name).push(m);
    }
    const groups = [];
    for (const [name, list] of map) {
      const points = list.slice().sort(byDateAsc);
      let ref = null;
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].refMin !== null || points[i].refMax !== null) { ref = { min: points[i].refMin, max: points[i].refMax }; break; }
      }
      groups.push({ name, points, ref, last: points[points.length - 1] });
    }
    return groups.sort((a, b) => byDateAsc(b.last, a.last));
  }
  function refStatus(value, ref) {
    if (!ref) return null;
    if (ref.max !== null && value > ref.max) return 'high';
    if (ref.min !== null && value < ref.min) return 'low';
    return 'normal';
  }
  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  /**
   * Layout for one trend chart. X is proportional to real time (3 days and 3 months look different),
   * Y fits the data and reference range instead of always starting at zero.
   */
  function chartGeometry(points, ref, opts) {
    const o = Object.assign({ width: 340, height: 190, left: 44, right: 14, top: 12, bottom: 30, yTicks: 4 }, opts);
    const values = points.map((p) => p.value);
    // upper limit only (e.g. CA125 ≤ 35): the normal band runs down to 0, so show 0 when data is non-negative
    const refLo = ref ? (ref.min !== null ? ref.min : ref.max !== null && Math.min(...values) >= 0 ? 0 : null) : null;
    const all = values.concat(ref ? [refLo, ref.max].filter((v) => v !== null) : []);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (lo === hi) { const d = Math.abs(lo) * 0.2 || 1; lo -= d; hi += d; }
    const step = niceStep(hi - lo, o.yTicks);
    let yMin = Math.floor(lo / step) * step;
    let yMax = Math.ceil(hi / step) * step;
    if (yMin === lo && Math.min(...all) >= 0 && yMin > 0) yMin = Math.max(0, yMin - step);
    if (yMax === hi) yMax += step;
    if (Math.min(...all) >= 0) yMin = Math.max(0, yMin);
    const plotW = o.width - o.left - o.right, plotH = o.height - o.top - o.bottom;
    const d0 = dayNum(points[0].date), d1 = dayNum(points[points.length - 1].date);
    const xOf = (iso) => (d1 === d0 ? o.left + plotW / 2 : o.left + ((dayNum(iso) - d0) / (d1 - d0)) * plotW);
    const yOf = (v) => o.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    const round = (n) => Math.round(n * 10) / 10;
    const yTicks = [];
    for (let v = yMin; v <= yMax + step / 1000; v += step) yTicks.push({ value: +v.toPrecision(12), y: round(yOf(v)) });
    const xTicks = [];
    const seen = new Set();
    const addX = (iso) => { if (!seen.has(iso)) { seen.add(iso); xTicks.push({ date: iso, x: round(xOf(iso)) }); } };
    addX(points[0].date);
    if (d1 - d0 > 20 && points.length > 2) addX(fromDayNum(Math.round((d0 + d1) / 2)));
    addX(points[points.length - 1].date);
    let band = null;
    if (ref) {
      const top = ref.max === null ? yMax : Math.min(ref.max, yMax);
      const bot = ref.min === null ? yMin : Math.max(ref.min, yMin);
      if (top > bot) band = { x: o.left, width: plotW, y: round(yOf(top)), height: round(yOf(bot) - yOf(top)) };
    }
    const dots = points.map((p) => ({ x: round(xOf(p.date)), y: round(yOf(p.value)), value: p.value, date: p.date, status: refStatus(p.value, ref) }));
    return {
      width: o.width, height: o.height, left: o.left, right: o.width - o.right, top: o.top, bottom: o.height - o.bottom,
      yMin, yMax, yTicks, xTicks, band, dots,
      path: dots.map((d, i) => `${i ? 'L' : 'M'}${d.x},${d.y}`).join(' '),
    };
  }
  /** Compact number for labels: 3.0 → "3", 12.345 → "12.35" */
  function fmt(v) {
    return String(Math.round(v * 100) / 100);
  }
  /** "0 – 5", "≤ 35", "≥ 2" */
  function refText(ref) {
    if (!ref) return '';
    if (ref.min !== null && ref.max !== null) return `${fmt(ref.min)} – ${fmt(ref.max)}`;
    return ref.max !== null ? `≤ ${fmt(ref.max)}` : `≥ ${fmt(ref.min)}`;
  }

  /** Character-level line wrapping (works for Chinese, which has no spaces). measure(str) → width. */
  function wrapLines(text, maxWidth, measure) {
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      let line = '';
      for (const ch of Array.from(para)) {
        if (line && measure(line + ch) > maxWidth) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    }
    return out;
  }
  /** Split blocks (each with a height) into pages no taller than maxHeight. A block taller than a page gets its own page. */
  function paginate(heights, maxHeight) {
    const pages = [];
    let cur = [], h = 0;
    heights.forEach((bh, i) => {
      if (cur.length && h + bh > maxHeight) { pages.push(cur); cur = []; h = 0; }
      cur.push(i); h += bh;
    });
    if (cur.length) pages.push(cur);
    return pages;
  }

  function makeDemoData(today) {
    const t = dayNum(today);
    const d = (n) => fromDayNum(t - n);
    let id = 1000;
    const mk = (name, ago, value, refMin, refMax) => ({ id: id++, name, date: d(ago), value, refMin, refMax });
    return {
      markers: [
        mk('CEA', 170, 18.6, 0, 5), mk('CEA', 140, 12.1, 0, 5), mk('CEA', 112, 7.4, 0, 5), mk('CEA', 84, 4.2, 0, 5),
        mk('CEA', 56, 3.1, 0, 5), mk('CEA', 21, 3.4, 0, 5), mk('CEA', 3, 2.8, 0, 5),
        mk('CA125', 150, 88, 0, 35), mk('CA125', 90, 41, 0, 35), mk('CA125', 30, 22.5, 0, 35),
      ],
      reports: [],
      treatments: [
        { id: id++, date: d(165), type: '化疗', plan: '顺铂+培美曲塞 第1周期', note: '轻度恶心，第3天缓解', file: null },
        { id: id++, date: d(60), type: '靶向', plan: '示例药物 每日一次', note: '', file: null },
      ],
      notes: [{ id: id++, date: d(21), doctor: '示例：肿瘤科门诊', content: '指标稳定，3个月后复查CT。\n注意休息、清淡饮食。' }],
    };
  }

  return {
    REPORT_TYPES, TREATMENT_TYPES, COMMON_MARKERS, LIMITS,
    todayISO, dayNum, fromDayNum, isValidDate, parseNumber, newId,
    sanitizeMarker, sanitizeNote, sanitizeTreatment, sanitizeReport, sanitizeAll,
    dataUrlToBytes, buildBackup, buildTextBackup, extractSharedData, parseImport, splitNew,
    groupMarkers, refStatus, chartGeometry, fmt, refText, wrapLines, paginate, makeDemoData,
  };
});
