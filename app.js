/* ===================== 所有渲染/逻辑都包进 try/catch，单页出错不影响其他页 ===================== */
(function () {
  'use strict';
  var KF = window.KF;
  var state = KF.state;
  var $ = KF.$;
  var pendingFile = null;   // 当前页选中的文件

  // ---------- 路由 ----------
  function switchTab(key) {
    try {
      document.querySelectorAll('#tabs button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-k') === key);
      });
      var main = $('main');
      main.innerHTML = '';   // 先清空，再逐个塞，挂一个不影响别的
      if (key === 'reports') main.appendChild(buildReports());
      else if (key === 'treatments') main.appendChild(buildTreatments());
      else if (key === 'symptoms') main.appendChild(buildSymptoms());
      else if (key === 'meds') main.appendChild(buildMeds());
      else if (key === 'markers') main.appendChild(buildMarkers());
      window.scrollTo(0, 0);
    } catch (e) {
      KF.__crash('切换页面失败: ' + e.message);
    }
  }

  // 用事件委托绑 tab，避免动态节点绑不上
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b && b.getAttribute('data-k')) switchTab(b.getAttribute('data-k'));
  });

  // ---------- 页面骨架（都用真实 DOM 创建，不拼大段 innerHTML，避开小米转义坑）----------
  function card(title, hint) {
    var c = document.createElement('div');
    c.className = 'card';
    var h = document.createElement('h2'); h.textContent = title;
    c.appendChild(h);
    if (hint) { var p = document.createElement('p'); p.className = 'hint'; p.textContent = hint; c.appendChild(p); }
    return c;
  }

  // 报告页
  function buildReports() {
    var wrap = card('检查报告', '上传并管理 CT/MR/病理/化验等报告，仅本机保存。');
    var fType = field('类型', selectBox(['CT','MR','PET-CT','超声','化验','病理','其他']));
    fType.querySelector('select').id = 'rType';
    var fDate = field('日期', dateBox('rDate'));
    var fText = field('报告文字/结论（可选）', textareaBox('rText', '手动录入报告文字、诊断结论等'));
    wrap.appendChild(fType); wrap.appendChild(fDate); wrap.appendChild(fText);

    // 上传区：label 直接包裹真实 input，不 hidden、不 JS click
    var fFile = document.createElement('label');
    fFile.className = 'field';
    var lab = document.createElement('span'); lab.className = 'field-label'; lab.textContent = '文件（PDF 或图片，可拍照）';
    var up = document.createElement('span'); up.className = 'upload-label'; up.innerHTML = '📎 点击选择文件';
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.className = 'real-file';
    inp.accept = 'image/*,application/pdf';
    inp.addEventListener('change', function () { onFilePick('reports', inp); });
    fFile.appendChild(lab); fFile.appendChild(up); fFile.appendChild(inp);
    wrap.appendChild(fFile);

    var err = document.createElement('div'); err.className = 'err'; err.id = 'rErr'; err.hidden = true;
    wrap.appendChild(err);

    var btn = document.createElement('button');
    btn.className = 'primary'; btn.textContent = '保存报告';
    btn.addEventListener('click', function () { saveReport(); });
    wrap.appendChild(btn);

    var list = document.createElement('ul'); list.className = 'list'; list.id = 'reportList';
    wrap.appendChild(list);
    setTimeout(renderReportList, 0);
    return wrap;
  }

  // 治疗页
  function buildTreatments() {
    var wrap = card('记录治疗', '记录每次化疗、靶向、免疫等治疗方案。');
    wrap.appendChild(field('日期', dateBox('tDate')));
    var fType = field('类型', selectBox(['化疗','靶向','免疫','放疗','手术','其他']));
    fType.querySelector('select').id = 'tType'; wrap.appendChild(fType);
    wrap.appendChild(field('方案/药物', textBox('tPlan', '如：顺铂+培美曲塞')));
    wrap.appendChild(field('备注（可选）', textareaBox('tNote', '反应、剂量等')));

    var fFile = document.createElement('label');
    fFile.className = 'field';
    var lab = document.createElement('span'); lab.className = 'field-label'; lab.textContent = '附件（可选）';
    var up = document.createElement('span'); up.className = 'upload-label'; up.innerHTML = '📎 点击选择文件';
    var inp = document.createElement('input');
    inp.type = 'file'; inp.className = 'real-file'; inp.accept = 'image/*,application/pdf';
    inp.addEventListener('change', function () { onFilePick('treatments', inp); });
    fFile.appendChild(lab); fFile.appendChild(up); fFile.appendChild(inp);
    wrap.appendChild(fFile);

    var err = document.createElement('div'); err.className = 'err'; err.id = 'tErr'; err.hidden = true;
    wrap.appendChild(err);
    var btn = document.createElement('button');
    btn.className = 'primary'; btn.textContent = '保存记录';
    btn.addEventListener('click', saveTreatment);
    wrap.appendChild(btn);

    var list = document.createElement('ul'); list.className = 'list'; list.id = 'treatList';
    wrap.appendChild(list);
    setTimeout(renderTreatList, 0);
    return wrap;
  }

  function buildSymptoms()  { var w = card('症状记录', '每天记录身体不适，复诊时方便回顾。'); w.appendChild(listBox('symptomList', renderSymptomRow)); return w; }
  function buildMeds()      { var w = card('用药管理', '记录长期用药。'); w.appendChild(listBox('medList', renderMedRow)); return w; }
  function buildMarkers()   { var w = card('肿瘤指标', '记录 CEA、CA199 等数值。'); w.appendChild(listBox('markerList', renderMarkerRow)); return w; }

  // ---------- 表单小部件 ----------
  function field(label, control) {
    var l = document.createElement('label'); l.className = 'field';
    var s = document.createElement('span'); s.className = 'field-label'; s.textContent = label;
    l.appendChild(s); l.appendChild(control); return l;
  }
  function textBox(id, ph) { var i = document.createElement('input'); i.type = 'text'; i.id = id; i.placeholder = ph || ''; return i; }
  function textareaBox(id, ph) { var i = document.createElement('textarea'); i.id = id; i.placeholder = ph || ''; return i; }
  function dateBox(id) { var i = document.createElement('input'); i.type = 'date'; i.id = id; return i; }
  function selectBox(opts) { var s = document.createElement('select'); opts.forEach(function (o) { var o_ = document.createElement('option'); o_.textContent = o; s.appendChild(o_); }); return s; }
  function listBox(id, rowFn) { var u = document.createElement('ul'); u.className = 'list'; u.id = id; return u; }

  // ---------- 文件选择（原生 change，不用 JS 触发） ----------
  function onFilePick(key, inp) {
    try {
      if (!inp.files || !inp.files.length) return;
      var file = inp.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        pendingFile = { fileName: file.name, fileData: reader.result, fileType: file.type || '' };
        KF.toast('已选择：' + file.name);
        var up = inp.previousElementSibling;
        if (up && up.classList.contains('upload-label')) up.innerHTML = '📎 已选：' + KF.esc(file.name);
      };
      reader.onerror = function () { KF.toast('文件读取失败'); };
      reader.readAsDataURL(file);
    } catch (e) {
      KF.__crash('选择文件失败: ' + e.message);
    }
  }

  // ---------- 保存 ----------
  function val(id) { var e = $(id); return e ? e.value.trim ? e.value.trim() : e.value; }
  function showErr(id, msg) { var e = $(id); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; }

  function saveReport() {
    try {
      var date = val('rDate'), type = val('rType'), text = val('rText');
      if (!date) return showErr('rErr', '请选择日期'), KF.toast('请选择日期');
      showErr('rErr', '');
      var rec = { id: 'r' + Date.now(), type: type, date: date, text: text };
      if (pendingFile) { rec.fileName = pendingFile.fileName; rec.fileData = pendingFile.fileData; rec.fileType = pendingFile.fileType; }
      state.reports.unshift(rec);
      KF.save();
      pendingFile = null;
      KF.toast('报告已保存');
      switchTab('reports');
    } catch (e) { KF.__crash('保存报告失败: ' + e.message); }
  }

  function saveTreatment() {
    try {
      var date = val('tDate'), type = val('tType'), plan = val('tPlan'), note = val('tNote');
      if (!date || !plan) return showErr('tErr', '请填写日期和方案'), KF.toast('请填写日期和方案');
      showErr('tErr', '');
      var rec = { id: 't' + Date.now(), type: type, date: date, plan: plan, note: note };
      if (pendingFile) { rec.fileName = pendingFile.fileName; rec.fileData = pendingFile.fileData; rec.fileType = pendingFile.fileType; }
      state.treatments.unshift(rec);
      KF.save();
      pendingFile = null;
      KF.toast('治疗记录已保存');
      switchTab('treatments');
    } catch (e) { KF.__crash('保存治疗失败: ' + e.message); }
  }

  // ---------- 渲染 ----------
  function setList(id, arr, empty, rowFn) {
    var el = $(id);
    if (!el) return;
    if (!arr || !arr.length) { el.innerHTML = '<li class="empty-tip">' + empty + '</li>'; return; }
    el.innerHTML = '';
    arr.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'list-item';
      li.innerHTML = rowFn(r);
      el.appendChild(li);
    });
  }
  function fileBtn(key, id) {
    return '<button class="chip" onclick="window.__viewFile(\'' + key + '\',\'' + id + '\')">查看附件</button>';
  }
  function delBtn(key, id) {
    return '<button class="chip" style="color:#c0392b" onclick="window.__delItem(\'' + key + '\',\'' + id + '\')">删除</button>';
  }

  function renderReportList() {
    setList('reportList', state.reports, '还没有报告记录', function (r) {
      var f = r.fileData ? fileBtn('reports', r.id) : '';
      return '<div style="flex:1"><span class="chip">' + KF.esc(r.type) + '</span><span class="chip">' + KF.esc(r.date) + '</span>' +
        (r.text ? '<div style="margin-top:4px;font-size:14px">' + KF.esc(r.text) + '</div>' : '') +
        (r.fileName ? '<div style="font-size:13px;color:#6b6b6b">' + KF.esc(r.fileName) + '</div>' : '') + '</div>' + f + delBtn('reports', r.id);
    });
  }
  function renderTreatList() {
    setList('treatList', state.treatments, '还没有治疗记录', function (t) {
      var f = t.fileData ? fileBtn('treatments', t.id) : '';
      return '<div style="flex:1"><span class="chip">' + KF.esc(t.type) + '</span><span class="chip">' + KF.esc(t.date) + '</span>' +
        '<div style="margin-top:4px;font-weight:600">' + KF.esc(t.plan) + '</div>' +
        (t.note ? '<div style="font-size:13px;color:#6b6b6b">' + KF.esc(t.note) + '</div>' : '') + '</div>' + f + delBtn('treatments', t.id);
    });
  }
  function renderSymptomRow(s) { return '<span class="chip">' + KF.esc(s.date) + '</span> ' + KF.esc(s.part || '') + ' ' + KF.esc(s.desc || '') + ' <span class="chip">程度' + KF.esc(s.level) + '</span>'; }
  function renderMedRow(m)      { return '<strong>' + KF.esc(m.name) + '</strong> <span class="chip">' + KF.esc(m.dose || '') + '</span> <span class="chip">' + KF.esc(m.freq || '') + '</span>'; }
  function renderMarkerRow(m)   { return '<span class="chip">' + KF.esc(m.date) + '</span> <strong>' + KF.esc(m.name) + '</strong> ' + KF.esc(m.value) + ' ' + KF.esc(m.unit || ''); }

  function renderSymptomList() { setList('symptomList', state.symptoms, '还没有症状记录', function (s) { return '<div style="flex:1">' + renderSymptomRow(s) + '</div>' + delBtn('symptoms', s.id); }); }
  function renderMedList()     { setList('medList', state.meds, '还没有添加药物', function (m) { return '<div style="flex:1">' + renderMedRow(m) + '</div>' + delBtn('meds', m.id); }); }
  function renderMarkerList()  { setList('markerList', state.markers, '还没有指标记录', function (m) { return '<div style="flex:1">' + renderMarkerRow(m) + '</div>' + delBtn('markers', m.id); }); }

  // 供内联 onclick 用的全局方法
  window.__viewFile = function (key, id) {
    try {
      var r = state[key].find(function (x) { return x.id === id; });
      if (!r) return KF.toast('找不到这条记录');
      if (!r.fileData) return KF.toast('该文件未内嵌内容，仅留档了名称');
      var body;
      if ((r.fileType || '').indexOf('pdf') > -1) {
        body = '<h3 style="margin:0 0 10px">' + KF.esc(r.fileName) + '</h3><iframe src="' + r.fileData + '" style="width:100%;height:55vh;border:0;border-radius:8px"></iframe>';
      } else {
        body = '<h3 style="margin:0 0 10px">' + KF.esc(r.fileName) + '</h3><img src="' + r.fileData + '">';
      }
      body += '<div class="modal-actions"><button onclick="window.KF.closeModal()">关闭</button></div>';
      KF.openModal(body);
    } catch (e) { KF.__crash('查看文件失败: ' + e.message); }
  };
  window.__delItem = function (key, id) {
    state[key] = state[key].filter(function (x) { return x.id !== id; });
    KF.save();
    if (key === 'reports') renderReportList();
    else if (key === 'treatments') renderTreatList();
    else if (key === 'symptoms') renderSymptomList();
    else if (key === 'meds') renderMedList();
    else if (key === 'markers') renderMarkerList();
    KF.toast('已删除');
  };

  // ---------- 启动（整体兜底，绝不让 main 空白） ----------
  function boot() {
    try {
      KF.load();
      var t = KF.today();
      ['rDate', 'tDate'].forEach(function (id) { var e = $(id); if (e && !e.value) e.value = t; });
      switchTab('reports');
    } catch (e) {
      KF.__crash('启动失败: ' + e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
