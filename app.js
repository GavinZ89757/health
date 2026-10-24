/* ===================== 路由/页面 ===================== */
function switchTab(name){
  document.querySelectorAll('nav.tabs button').forEach(b=>{
    b.setAttribute('aria-selected',b.id==='t-'+name);
    if(b.id==='t-'+name)b.classList.add('active');else b.classList.remove('active');
  });
  const main=$('main');
  if(name==='reports')main.innerHTML=buildReportsView();
  else if(name==='treatments')main.innerHTML=buildTreatmentsView();
  else if(name==='symptoms')main.innerHTML=buildSymptomsView();
  else if(name==='meds')main.innerHTML=buildMedsView();
  else if(name==='markers')main.innerHTML=buildMarkersView();
  // 绑定文件change事件
  bindFileChange('rFile','rFileBtn');
  bindFileChange('tFile','tFileBtn');
}

/* ===================== 报告页 ===================== */
function buildReportsView(){
  let h=`<div class="view-head"><h2>📄 检查报告</h2><p>上传并管理 CT/MR/病理/化验等报告，按时间留档。仅本机保存。</p></div>`;
  h+=`<div class="card"><h2>上传检查报告</h2>`;
  h+=`<div class="field"><span class="field-label">类型</span><select id="rType"><option>CT</option><option>MR</option><option>PET-CT</option><option>超声</option><option>化验</option><option>病理</option><option>其他</option></select></div>`;
  h+=`<div class="field"><span class="field-label">日期</span><input type="date" id="rDate" required></div>`;
  h+=`<div class="field"><span class="field-label">报告文字/结论（可选）</span><textarea id="rText" rows="3" maxlength="5000" placeholder="手动录入报告文字、诊断结论等"></textarea></div>`;
  h+=`<div class="field"><span class="field-label">文件（PDF 或图片，可拍照）</span>`;
  h+=`<button type="button" class="file-btn" id="rFileBtn" onclick="document.getElementById('rFile').click()">📎 点击选择文件</button>`;
  h+=`<input type="file" id="rFile" accept=".pdf,image/*" hidden></div>`;
  h+=`<p class="err" id="rErr" role="alert" hidden></p>`;
  h+=`<button class="primary" onclick="saveReport()">保存报告</button></div>`;
  h+=`<ul class="list card" id="reportList" aria-label="报告列表"></ul>`;
  setTimeout(renderReportList,0);
  return h;
}

/* ===================== 治疗页 ===================== */
function buildTreatmentsView(){
  let h=`<div class="view-head"><h2>💉 治疗记录</h2><p>记录每次化疗、靶向、免疫等治疗方案。</p></div>`;
  h+=`<div class="card"><h2>记录治疗</h2>`;
  h+=`<div class="grid2"><div class="field"><span class="field-label">日期</span><input type="date" id="tDate" required></div>`;
  h+=`<div class="field"><span class="field-label">类型</span><select id="tType"><option>化疗</option><option>靶向</option><option>免疫</option><option>放疗</option><option>手术</option><option>其他</option></select></div></div>`;
  h+=`<div class="field"><span class="field-label">方案/药物</span><input id="tPlan" maxlength="200" placeholder="如：顺铂+培美曲塞" autocomplete="off" required></div>`;
  h+=`<div class="field"><span class="field-label">备注（可选）</span><textarea id="tNote" rows="2" maxlength="2000" placeholder="反应、剂量等"></textarea></div>`;
  h+=`<div class="field"><span class="field-label">附件（可选）</span>`;
  h+=`<button type="button" class="file-btn" id="tFileBtn" onclick="document.getElementById('tFile').click()">📎 点击选择文件</button>`;
  h+=`<input type="file" id="tFile" accept=".pdf,image/*" hidden></div>`;
  h+=`<p class="err" id="tErr" role="alert" hidden></p>`;
  h+=`<button class="primary" onclick="saveTreatment()">保存记录</button></div>`;
  h+=`<div class="card"><ul class="list" id="treatList" aria-label="治疗记录列表"></ul></div>`;
  setTimeout(renderTreatList,0);
  return h;
}

/* ===================== 症状页 ===================== */
function buildSymptomsView(){
  let h=`<div class="view-head"><h2>📋 症状记录</h2><p>每天记录身体不适，方便复诊时回顾。</p></div>`;
  h+=`<div class="card"><h2>记录症状</h2>`;
  h+=`<div class="grid2"><div class="field"><span class="field-label">日期</span><input type="date" id="sDate" required></div>`;
  h+=`<div class="field"><span class="field-label">程度 1-10</span><input type="number" id="sLevel" min="1" max="10" value="5"></div></div>`;
  h+=`<div class="field"><span class="field-label">部位</span><input id="sPart" maxlength="50" placeholder="如：胸部、腹部"></div>`;
  h+=`<div class="field"><span class="field-label">描述</span><textarea id="sDesc" rows="2" maxlength="1000" placeholder="具体感受"></textarea></div>`;
  h+=`<button class="primary" onclick="saveSymptom()">保存症状</button></div>`;
  h+=`<ul class="list card" id="symptomList"></ul>`;
  setTimeout(renderSymptomList,0);
  return h;
}

/* ===================== 用药页 ===================== */
function buildMedsView(){
  let h=`<div class="view-head"><h2>💊 用药管理</h2><p>记录长期用药，设置提醒。</p></div>`;
  h+=`<div class="card"><h2>添加药物</h2>`;
  h+=`<div class="field"><span class="field-label">药名</span><input id="mName" maxlength="100" placeholder="如：奥希替尼" required></div>`;
  h+=`<div class="field"><span class="field-label">剂量</span><input id="mDose" maxlength="50" placeholder="如：80mg"></div>`;
  h+=`<div class="field"><span class="field-label">频次</span><select id="mFreq"><option>每日一次</option><option>每日两次</option><option>隔日</option><option>每周</option><option>按需</option></select></div>`;
  h+=`<div class="field"><span class="field-label">备注</span><textarea id="mNote" rows="2" maxlength="500"></textarea></div>`;
  h+=`<button class="primary" onclick="saveMed()">添加药物</button></div>`;
  h+=`<ul class="list card" id="medList"></ul>`;
  setTimeout(renderMedList,0);
  return h;
}

/* ===================== 指标页 ===================== */
function buildMarkersView(){
  let h=`<div class="view-head"><h2>📊 肿瘤指标</h2><p>记录 CEA、CA199 等肿瘤标志物数值。</p></div>`;
  h+=`<div class="card"><h2>记录指标</h2>`;
  h+=`<div class="grid2"><div class="field"><span class="field-label">日期</span><input type="date" id="mkDate" required></div>`;
  h+=`<div class="field"><span class="field-label">项目</span><select id="mkName"><option>CEA</option><option>CA199</option><option>CA125</option><option>CYFRA21-1</option><option>NSE</option><option>其他</option></select></div></div>`;
  h+=`<div class="field"><span class="field-label">数值</span><input id="mkValue" maxlength="20" placeholder="如：7.43" required></div>`;
  h+=`<div class="field"><span class="field-label">单位</span><input id="mkUnit" maxlength="10" value="ng/mL"></div>`;
  h+=`<button class="primary" onclick="saveMarker()">保存指标</button></div>`;
  h+=`<ul class="list card" id="markerList"></ul>`;
  setTimeout(renderMarkerList,0);
  return h;
}

/* ===================== 文件选择显示 ===================== */
function bindFileChange(inputId,btnId){
  const input=$(inputId);
  const btn=$(btnId);
  if(!input||!btn)return;
  input.addEventListener('change',()=>{
    btn.textContent=input.files.length?('📎 已选: '+input.files[0].name):'📎 点击选择文件';
  });
}

/* ===================== 保存逻辑 ===================== */
function saveReport(){
  const type=$('rType').value,date=$('rDate').value,text=$('rText').value;
  if(!date){$('rErr').textContent='请选择日期';$('rErr').hidden=false;return;}
  $('rErr').hidden=true;
  const rec={id:'r'+Date.now(),type,date,text,dateCreated:Date.now()};
  // 处理文件
  const fInput=$('rFile');
  if(fInput&&fInput.files.length){
    const f=fInput.files[0];
    const reader=new FileReader();
    reader.onload=()=>{
      rec.fileName=f.name;rec.fileData=reader.result;rec.fileType=f.type;
      state.reports.unshift(rec);save();toast('报告已保存');
      switchTab('reports');
    };
    reader.readAsDataURL(f);
  }else{
    state.reports.unshift(rec);save();toast('报告已保存');
    switchTab('reports');
  }
}

function saveTreatment(){
  const date=$('tDate').value,type=$('tType').value,plan=$('tPlan').value,note=$('tNote').value;
  if(!date||!plan){$('tErr').textContent='请填写日期和方案';$('tErr').hidden=false;return;}
  $('tErr').hidden=true;
  const rec={id:'t'+Date.now(),date,type,plan,note,dateCreated:Date.now()};
  const fInput=$('tFile');
  if(fInput&&fInput.files.length){
    const f=fInput.files[0];
    const reader=new FileReader();
    reader.onload=()=>{
      rec.fileName=f.name;rec.fileData=reader.result;rec.fileType=f.type;
      state.treatments.unshift(rec);save();toast('治疗记录已保存');
      switchTab('treatments');
    };
    reader.readAsDataURL(f);
  }else{
    state.treatments.unshift(rec);save();toast('治疗记录已保存');
    switchTab('treatments');
  }
}

function saveSymptom(){
  const date=$('sDate').value,level=$('sLevel').value,part=$('sPart').value,desc=$('sDesc').value;
  if(!date){toast('请选择日期');return;}
  state.symptoms.unshift({id:'s'+Date.now(),date,level,part,desc,dateCreated:Date.now()});
  save();toast('症状已记录');switchTab('symptoms');
}

function saveMed(){
  const name=$('mName').value,dose=$('mDose').value,freq=$('mFreq').value,note=$('mNote').value;
  if(!name){toast('请输入药名');return;}
  state.meds.unshift({id:'m'+Date.now(),name,dose,freq,note,dateCreated:Date.now()});
  save();toast('药物已添加');switchTab('meds');
}

function saveMarker(){
  const date=$('mkDate').value,name=$('mkName').value,value=$('mkValue').value,unit=$('mkUnit').value;
  if(!date||!value){toast('请填写日期和数值');return;}
  state.markers.unshift({id:'mk'+Date.now(),date,name,value,unit,dateCreated:Date.now()});
  save();toast('指标已记录');switchTab('markers');
}

/* ===================== 渲染列表 ===================== */
function renderReportList(){
  const el=$('reportList');if(!el)return;
  if(!state.reports.length){el.innerHTML='<div class="empty-tip">还没有报告记录</div>';return;}
  el.innerHTML=state.reports.map(r=>{
    const hasFile=r.fileData?`<button class="file-btn" style="padding:.3rem;font-size:.8rem;margin-top:.3rem" onclick="viewFile('reports','${r.id}')">📎 查看附件</button>`:'';
    return `<li class="list-item"><div style="flex:1"><span class="chip">${esc(r.type)}</span> <span class="chip">${r.date}</span><div style="margin-top:.3rem;font-size:.9rem">${esc(r.text||'')}</div>${hasFile}</div><button onclick="delItem('reports','${r.id}')" style="background:0;border:0;color:var(--danger);font-size:1.1rem;cursor:pointer">🗑</button></li>`;
  }).join('');
}

function renderTreatList(){
  const el=$('treatList');if(!el)return;
  if(!state.treatments.length){el.innerHTML='<div class="empty-tip">还没有治疗记录</div>';return;}
  el.innerHTML=state.treatments.map(r=>{
    const hasFile=r.fileData?`<button class="file-btn" style="padding:.3rem;font-size:.8rem;margin-top:.3rem" onclick="viewFile('treatments','${r.id}')">📎 查看附件</button>`:'';
    return `<li class="list-item"><div style="flex:1"><span class="chip">${esc(r.type)}</span> <span class="chip">${r.date}</span><div style="margin-top:.3rem;font-size:.9rem;font-weight:600">${esc(r.plan)}</div><div style="font-size:.85rem;color:var(--muted)">${esc(r.note||'')}</div>${hasFile}</div><button onclick="delItem('treatments','${r.id}')" style="background:0;border:0;color:var(--danger);font-size:1.1rem;cursor:pointer">🗑</button></li>`;
  }).join('');
}

function renderSymptomList(){
  const el=$('symptomList');if(!el)return;
  if(!state.symptoms.length){el.innerHTML='<div class="empty-tip">还没有症状记录</div>';return;}
  el.innerHTML=state.symptoms.map(s=>`<li class="list-item"><div style="flex:1"><span class="chip">${s.date}</span> <span class="chip">程度 ${s.level}</span><div style="margin-top:.3rem">${esc(s.part||'')} ${esc(s.desc||'')}</div></div><button onclick="delItem('symptoms','${s.id}')" style="background:0;border:0;color:var(--danger);font-size:1.1rem;cursor:pointer">🗑</button></li>`).join('');
}

function renderMedList(){
  const el=$('medList');if(!el)return;
  if(!state.meds.length){el.innerHTML='<div class="empty-tip">还没有添加药物</div>';return;}
  el.innerHTML=state.meds.map(m=>`<li class="list-item"><div style="flex:1"><span style="font-weight:600">${esc(m.name)}</span> <span class="chip">${esc(m.dose||'')}</span> <span class="chip">${esc(m.freq||'')}</span><div style="font-size:.85rem;color:var(--muted)">${esc(m.note||'')}</div></div><button onclick="delItem('meds','${m.id}')" style="background:0;border:0;color:var(--danger);font-size:1.1rem;cursor:pointer">🗑</button></li>`).join('');
}

function renderMarkerList(){
  const el=$('markerList');if(!el)return;
  if(!state.markers.length){el.innerHTML='<div class="empty-tip">还没有指标记录</div>';return;}
  el.innerHTML=state.markers.map(m=>`<li class="list-item"><div style="flex:1"><span class="chip">${m.date}</span> <strong>${esc(m.name)}</strong> ${esc(m.value)} ${esc(m.unit||'')}</div><button onclick="delItem('markers','${m.id}')" style="background:0;border:0;color:var(--danger);font-size:1.1rem;cursor:pointer">🗑</button></li>`).join('');
}

/* ===================== 查看文件 ===================== */
function viewFile(key,id){
  const r=state[key].find(x=>x.id==id);if(!r||!r.fileData){toast('没有可查看的文件');return;}
  if(r.fileType&&r.fileType.indexOf('pdf')>-1){
    openModal(`<h3>${esc(r.fileName||'文件')}</h3><iframe src="${r.fileData}" style="width:100%;height:60vh;border:0;border-radius:8px"></iframe><div class="modal-actions"><button onclick="closeModal()">关闭</button></div>`);
  }else{
    openModal(`<h3>${esc(r.fileName||'图片')}</h3><img src="${r.fileData}" style="width:100%;border-radius:8px"><div class="modal-actions"><button onclick="closeModal()">关闭</button></div>`);
  }
}

function delItem(key,id){
  state[key]=state[key].filter(x=>x.id!=id);save();
  if(key==='reports')renderReportList();
  else if(key==='treatments')renderTreatList();
  else if(key==='symptoms')renderSymptomList();
  else if(key==='meds')renderMedList();
  else if(key==='markers')renderMarkerList();
  toast('已删除');
}

/* ===================== 初始化 ===================== */
(function(){
  load();
  const today=new Date().toISOString().slice(0,10);
  // 默认今天日期
  setTimeout(()=>{
    const d=$('rDate');if(d&&!d.value)d.value=today;
    const t=$('tDate');if(t&&!t.value)t.value=today;
    const s=$('sDate');if(s&&!s.value)s.value=today;
    const m=$('mkDate');if(m&&!m.value)m.value=today;
  },100);
  switchTab('reports');
})();
