import { COLORS, LABELS, CONFIG, corners, conflicts, validCube, validateScene } from './geometry.js';
import { RECORD_KEY, RECORD_LIMIT, STATUS_LABELS, createRecord, recordFrame, finishRecord, loadRecords, summarizeRecords } from './records.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const HEX={red:'#e35e53',yellow:'#e9bd47',blue:'#5586d5'};
const example=()=>[{color:'red',x:-.08,y:.055,yaw:.18},{color:'yellow',x:.075,y:.065,yaw:-.12},{color:'blue',x:.025,y:-.075,yaw:.28}];
let cubes=example(),target='red',selected='red',view='2d',placing=null,ghost=null,drag=null,running=false;
let engine='demo',world=null,worldPromise=null,stream=null,runId=null,lastPhase=null,runSession=0;
let selectedController='b3';
let history=[],toastTimer=null;
let runRecords=[],activeRecord=null,recordFilter='all',recordSaveAt=0,recordStorageFailed=false;
let serviceReady=false,modelStatus=null,statusTimer=null;
try{runRecords=loadRecords(localStorage.getItem(RECORD_KEY));}catch{}
const clone=v=>JSON.parse(JSON.stringify(v));
try {
  const saved=JSON.parse(localStorage.getItem('colorlift.scene.v1'));
  if(saved){const value=validateScene(saved);cubes=value.cubes;target=value.target;}
}catch{ /* A missing or obsolete saved scene falls back to the example. */ }

function persist(){try{localStorage.setItem('colorlift.scene.v1',JSON.stringify({cubes,target}));}catch{}}
function snapshot(){return clone(cubes);}
function pushHistory(previous){history.push(previous);if(history.length>60)history.shift();$('#undo').disabled=!history.length;}
function commit(previous){if(JSON.stringify(previous)!==JSON.stringify(cubes))pushHistory(previous);persist();updateUI();}
function toast(text,error=false){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').className=`toast visible${error?' error':''}`;toastTimer=setTimeout(()=>$('#toast').className='toast',3300);}
function log(text){const p=document.createElement('p'),time=document.createElement('span');time.className='log-time';time.textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});p.append(time,document.createTextNode(text));$('#log-panel').append(p);while($('#log-panel').children.length>100)$('#log-panel').firstChild.remove();$('#log-panel').scrollTop=$('#log-panel').scrollHeight;}
function saveRecords(){
  try{localStorage.setItem(RECORD_KEY,JSON.stringify(runRecords));recordStorageFailed=false;}
  catch{recordStorageFailed=true;}
  $('#record-storage-note').textContent=recordStorageFailed?'浏览器存储不可用，记录暂留本页；离开前请导出。':'记录保存在本机浏览器；清理浏览器数据会移除记录，重要结果请导出。';
}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numberText=(value,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(digits):'—';
function recordResult(record){
  if(record.status==='completed'&&record.source==='demo')return '演示完成 · 未判分';
  if(record.source==='expert'&&record.success===true)return '示范控制 · 抓取成功';
  if(record.source==='expert'&&record.success===false)return '示范控制 · 抓取失败';
  if(record.source==='model'&&record.success===true)return '模型判定成功';
  if(record.source==='model'&&record.success===false)return '模型判定失败';
  if(record.status==='completed')return '已完成 · 未判分';
  return STATUS_LABELS[record.status] || '状态未知';
}
function renderRecords(){
  const summary=summarizeRecords(runRecords);
  $('#records-count').textContent=runRecords.length;$('#stat-total').textContent=summary.saved_records;$('#stat-demo').textContent=summary.demo_records;
  $('#stat-model').textContent=summary.judged_model_runs?`${summary.model_successes} / ${summary.judged_model_runs}`:'—';
  $('#stat-steps').textContent=numberText(summary.success_mean_completion_steps);
  $('#record-scope').textContent=summary.judged_model_runs?`本地已判分成功率 ${(summary.model_success_rate*100).toFixed(1)}% · 未判分 ${summary.unscored_model_runs} 次`:'尚无真实模型评测';
  $('#export-records').disabled=!runRecords.length;
  const shown=runRecords.filter(record=>recordFilter==='all'||record.source===recordFilter);
  $('#records-empty').classList.toggle('hidden',Boolean(shown.length));
  $('.records-table-wrap').classList.toggle('hidden',!shown.length);
  $('#records-empty strong').textContent=runRecords.length?'当前筛选下暂无记录':'从第一次运行开始记录';
  $('#records-empty span').textContent=runRecords.length?'可切换“全部”，查看其他来源的运行。':'点击“运行抓取演示”，这里会保存布局、阶段与结果。';
  const body=$('#record-rows');body.replaceChildren();
  for(const record of shown){
    const row=document.createElement('tr'),date=new Date(record.started_at),statusClass=record.success===true?'success':['error','failed','interrupted'].includes(record.status)?'error':record.status==='running'?'running':'';
    row.dataset.recordId=record.id;
    row.innerHTML=`<td>${escapeHTML(date.toLocaleDateString('zh-CN'))}<small>${escapeHTML(date.toLocaleTimeString('zh-CN',{hour12:false}))}</small></td><td><span class="record-source">${record.source==='demo'?'DEMO':'MODEL'}</span><span class="record-target"><i style="background:${HEX[record.scene.target]}"></i>${LABELS[record.scene.target]}</span></td><td><span class="record-result ${statusClass}">${recordResult(record)}</span></td><td>${Number.isFinite(record.control_steps)?record.control_steps:'—'}</td><td>${numberText(record.max_lift_m===null?null:record.max_lift_m*100)} cm</td><td><div class="record-actions"></div></td>`;
    row.querySelector('.record-source').textContent={demo:'DEMO',expert:'EXPERT',model:'B3 MODEL'}[record.source] || 'DEMO';
    for(const [label,action]of [['详情',()=>showRecord(record.id)],['恢复场景',()=>restoreRecord(record.id)]]){
      const button=document.createElement('button');button.textContent=label;button.disabled=label==='恢复场景'&&(running||record.status==='running');button.onclick=action;row.querySelector('.record-actions').append(button);
    }
    body.append(row);
  }
}
function downloadJSON(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function restoreRecord(id){
  if(running){toast('请先停止当前运行，再恢复场景');return;}
  const record=runRecords.find(r=>r.id===id);if(!record)return;
  const scene=validateScene(record.scene),before=snapshot();cubes=clone(scene.cubes);target=scene.target;selected=target;placing=null;ghost=null;commit(before);switchView('2d');
  $('#info-dialog').close();$('.workspace-layout').scrollIntoView({behavior:'smooth',block:'start'});toast('已恢复这次运行的初始场景和目标颜色');
}
function showRecord(id){
  const record=runRecords.find(r=>r.id===id);if(!record)return;
  const phases={approach:'接近目标',align:'对齐下降',close:'闭合夹爪',lift:'抬升目标',hold:'稳定保持'};
  dialog('运行详情',`<span class="record-detail-badge">${record.source==='demo'?'DEMO / 界面演示':'MODEL / 模型运行'}</span><p><strong>${recordResult(record)}</strong><br>${escapeHTML(new Date(record.started_at).toLocaleString('zh-CN',{hour12:false}))}<br>${escapeHTML(record.message)}</p><div class="record-detail-grid"><div><span>执行步数（含失败 / 停止过程）</span><strong>${record.control_steps} steps</strong></div><div><span>最大抬升高度</span><strong>${numberText(record.max_lift_m===null?null:record.max_lift_m*100)} cm</strong></div><div><span>最长连续保持（接收状态）</span><strong>${numberText(record.max_hold_seconds)} s</strong></div><div><span>实际经过时间</span><strong>${numberText(record.wall_seconds)} s</strong></div><div><span>完成步数（仅模型判定成功）</span><strong>${record.completion_steps??'—'}</strong></div><div><span>仿真完成时间（仅成功）</span><strong>${numberText(record.completion_seconds)} s</strong></div></div><p class="record-detail-note">${record.source==='demo'?'演示轨迹由程序生成，以上高度与保持时间不代表真实模型表现，也不计入成功率。':'以模型后端的最终判分为准；通信异常或中断不自动判为任务失败。'}<br>本记录只保存场景与接收的指标，不含视频。高度和保持最大值来自已接收的状态帧。</p><strong>初始布局 · 目标${LABELS[record.scene.target]}</strong><table class="record-scene-table"><thead><tr><th>颜色</th><th>X / mm</th><th>Y / mm</th><th>朝向 / °</th></tr></thead><tbody>${record.scene.cubes.map(c=>`<tr><td>${LABELS[c.color]}</td><td>${numberText(c.x*1000)}</td><td>${numberText(c.y*1000)}</td><td>${numberText(c.yaw*180/Math.PI)}</td></tr>`).join('')}</tbody></table><div class="record-timeline">${record.phases.length?record.phases.map(p=>`<p>第 ${Number(p.step)||0} 步 · ${phases[p.phase]||'未知阶段'}</p>`).join(''):'尚未收到阶段状态'}</div><div class="record-detail-actions"><button class="button secondary" id="record-detail-restore">恢复此场景</button><button class="button secondary" id="record-detail-export">导出此记录</button></div>`);
  $('#record-detail-restore').disabled=running||record.status==='running';$('#record-detail-restore').onclick=()=>restoreRecord(id);
  if(record.source==='expert'){
    $('#dialog-body .record-detail-badge').textContent='EXPERT / 方向示范';
    $('#dialog-body .record-detail-note').textContent='方向规划教师使用仿真物块位置控制夹爪朝向。结果来自真实 robosuite 判分，但不计入 B3 模型成功率。本记录不含视频；高度和保持最大值来自已接收的状态帧。';
  }
  $('#record-detail-export').onclick=()=>downloadJSON({version:1,record},`colorlift-run-${record.id}.json`);
  if(['model','expert'].includes(record.source)&&record.artifacts){
    const section=document.createElement('section');section.className='record-video-section';
    const title=document.createElement('strong');title.textContent='真实 robosuite 录像';
    const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=record.artifacts.video;
    const note=document.createElement('p');note.className='record-detail-note';note.textContent='录像需要本机模型服务仍在运行。服务重启后，可在 results/web_model_runs 中找到持久保存的文件。';
    video.onerror=()=>{note.textContent='此录像的在线链接已过期。请在 results/web_model_runs 的对应运行目录查看 front.mp4。';};
    section.append(title,video,note);$('#dialog-body').append(section);
    $('#dialog-body .record-detail-note').textContent='判分来自真实仿真后端。已保存相机录像及逐步指标；通信异常或页面中断不自动判为任务失败。';
  }
}
$$('[data-record-filter]').forEach(button=>button.onclick=()=>{
  recordFilter=button.dataset.recordFilter;$$('[data-record-filter]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});renderRecords();
});
$('#export-records').onclick=()=>downloadJSON({version:1,exported_at:new Date().toISOString(),summary:summarizeRecords(runRecords),records:runRecords},'colorlift-run-records.json');
const sx=x=>450+x*1600, sy=y=>330-y*1600;
function screenPoint(event){const pt=$('#editor-svg').createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;const matrix=$('#editor-svg').getScreenCTM();return matrix?pt.matrixTransform(matrix.inverse()):{x:450,y:330};}
function worldPoint(event){const p=screenPoint(event);return{x:(p.x-450)/1600,y:(330-p.y)/1600};}
const points=poly=>poly.map(([x,y])=>`${sx(x)},${sy(y)}`).join(' ');
const normalize=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));

function drawEditor(){
  const display=ghost?[...cubes.filter(c=>c.color!==ghost.color),ghost]:cubes;
  $('#cube-layer').innerHTML=display.map(c=>{
    const active=c.color===selected, pending=ghost===c, invalid=Boolean(validCube(c,display));
    return `<g class="cube-shape" data-cube="${c.color}" transform="translate(${sx(c.x)} ${sy(c.y)}) rotate(${-c.yaw*180/Math.PI})" opacity="${pending?'.65':'1'}">
      ${active?'<rect x="-38" y="-38" width="76" height="76" rx="7" fill="none" stroke="#91a184" stroke-width="1.2" stroke-dasharray="4 4"/>':''}
      <rect x="-32" y="-32" width="64" height="64" rx="5" fill="${HEX[c.color]}" filter="url(#cube-shadow)" stroke="${invalid?'#df3535':'#ffffff88'}" stroke-width="${invalid?2:1}"/>
      <path d="M-25 -26H24M-26 -24v46" stroke="#ffffff3d" stroke-width="2" fill="none"/>
      <path d="M-27 27H27V-23" stroke="#00000013" stroke-width="4" fill="none"/>
      <circle r="2.3" fill="#ffffffbd"/>
    </g><text class="cube-text" x="${sx(c.x)}" y="${sy(c.y)+57}" text-anchor="middle" fill="${active?'#647654':'#9aa68d'}">${LABELS[c.color]} ${c.color.toUpperCase()}${c.color===target?' · TARGET':''}</text>`;
  }).join('');
  const active=display.find(c=>c.color===selected);
  $('#rotation-layer').innerHTML=active&&!placing?`<g transform="translate(${sx(active.x)} ${sy(active.y)}) rotate(${-active.yaw*180/Math.PI})">
    <path class="rotation-visible" d="M-76 44 A88 88 0 1 1 76 44"/>
    <path class="rotation-hit" data-rotate="${active.color}" d="M-76 44 A88 88 0 1 1 76 44"/>
    <circle cx="0" cy="-88" r="7" fill="#fcfdf9" stroke="#929b8d" stroke-width="1.5" data-rotate="${active.color}" style="cursor:crosshair"/>
    <path d="M-3-88h6m-3-3v6" stroke="#929b8d" pointer-events="none"/>
  </g><text x="${sx(active.x)}" y="${sy(active.y)-108}" text-anchor="middle" fill="#86947a" font-size="10" font-family="monospace">${Math.round(active.yaw*180/Math.PI)}°</text>`:'';
  const collisions=[];
  for(let i=0;i<display.length;i++)for(let j=i+1;j<display.length;j++){
    const poly=conflicts(display[i],[display[j]])[0];if(poly)collisions.push(poly);
  }
  $('#collision-layer').innerHTML=collisions.map(poly=>{
    const x=poly.reduce((s,p)=>s+p[0],0)/poly.length,y=poly.reduce((s,p)=>s+p[1],0)/poly.length;
    return `<polygon points="${points(poly)}" fill="url(#collision-hatch)" stroke="#df3535" stroke-width="1.4"/><g transform="translate(${sx(x)} ${sy(y)})"><circle r="11" fill="#fff4f1" stroke="#df3535" stroke-width="2"/><path d="m-7 7 14-14" stroke="#df3535" stroke-width="2.5"/></g>`;
  }).join('');
  const candidate=ghost || (drag?active:null),invalid=candidate?validCube(candidate,display):'';
  if(view==='2d'){
    $('#placement-hint').classList.toggle('invalid',Boolean(invalid));
    $('#placement-hint span').textContent=invalid || (placing?`正在放置${LABELS[placing]}方块 · 左键固定中心 · Esc 取消`:drag?.type==='rotate'?'沿灰色弧线拖动旋转 · 松开确认':'点击方块选中 · 拖动移动 · 沿灰色弧线旋转');
  }
  $('#editor').classList.toggle('placing',Boolean(placing));
}

function updateProperties(){
  const cube=cubes.find(c=>c.color===selected);
  $('#selection-empty').classList.toggle('hidden',Boolean(cube));$('#selection-fields').classList.toggle('hidden',!cube);
  $('#delete-cube').disabled=!cube || running;
  $$('#selection-fields input').forEach(input=>input.disabled=running);
  if(cube){$('#selection-name').textContent=`${LABELS[cube.color]}方块`;$('#selection-dot').style.background=HEX[cube.color];
    $('#input-x').value=(cube.x*1000).toFixed(0);$('#input-y').value=(cube.y*1000).toFixed(0);$('#input-yaw').value=Math.round(cube.yaw*180/Math.PI);$('#yaw-value').textContent=`${Math.round(cube.yaw*180/Math.PI)}°`;}
}
function updateUI(){
  drawEditor();updateProperties();
  $('#scene-count').textContent=`${String(cubes.length).padStart(2,'0')} OBJECTS`;$('#placed-count').textContent=`${cubes.length} / 3`;
  $$('.palette-card').forEach(button=>{const color=button.dataset.color,placed=cubes.some(c=>c.color===color);button.classList.toggle('placed',placed);button.classList.toggle('active',selected===color);button.querySelector('.palette-state').textContent=placed?'已放置':'点击放置';button.disabled=running;});
  $$('[data-target]').forEach(button=>{const active=button.dataset.target===target;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));button.disabled=running;});
  $('#run-button').disabled=running || cubes.length!==3 || !serviceReady;
  $('#run-note').textContent=cubes.length!==3?`还需放置 ${3-cubes.length} 个方块`:'运行后自动切换至三维视图';
  ['load-example','clear-scene','import-scene','export-scene'].forEach(id=>$('#'+id).disabled=running);
  $('#undo').disabled=running || !history.length;
  document.body.classList.toggle('running-lock',running);$('#viewport').classList.toggle('running',running);
  $('#run-button').classList.toggle('hidden',running);$('#stop-button').classList.toggle('hidden',!running);
  if(world && !running && view==='2d')world.setScene(cubes,target);
}

$('#editor').addEventListener('pointerdown',event=>{
  if(running||event.button!==0)return;
  const point=worldPoint(event);
  if(placing){
    const candidate={color:placing,...point,yaw:0},error=validCube(candidate,cubes);
    ghost=candidate;drawEditor();
    if(error){toast(error,true);return;}
    const previous=snapshot();cubes.push(candidate);selected=placing;placing=null;ghost=null;commit(previous);toast('中心已固定，可沿灰色弧线拖动旋转');return;
  }
  const rotate=event.target.closest('[data-rotate]'),node=event.target.closest('[data-cube]');
  const color=rotate?.dataset.rotate || node?.dataset.cube;
  if(!color){selected=null;updateUI();return;}
  selected=color;const cube=cubes.find(c=>c.color===color);
  drag={type:rotate?'rotate':'move',original:snapshot(),start:{...point},cube:{...cube},angle:Math.atan2(point.y-cube.y,point.x-cube.x)};
  $('#editor').setPointerCapture(event.pointerId);updateUI();event.preventDefault();
});
$('#editor').addEventListener('pointermove',event=>{
  if(running)return;
  const point=worldPoint(event);
  if(placing){ghost={color:placing,...point,yaw:0};drawEditor();return;}
  if(!drag)return;
  const cube=cubes.find(c=>c.color===selected);
  if(drag.type==='move'){cube.x=drag.cube.x+point.x-drag.start.x;cube.y=drag.cube.y+point.y-drag.start.y;}
  else cube.yaw=normalize(drag.cube.yaw+Math.atan2(point.y-cube.y,point.x-cube.x)-drag.angle);
  drawEditor();updateProperties();
});
function endDrag(cancel=false){
  if(!drag)return;
  const previous=drag.original,cube=cubes.find(c=>c.color===selected),error=validCube(cube,cubes);
  if(cancel||error){cubes=previous;if(error&&!cancel)toast(`${error}，已恢复到原位置`,true);}
  drag=null;commit(previous);
}
$('#editor').addEventListener('pointerup',()=>endDrag());
$('#editor').addEventListener('pointercancel',()=>endDrag(true));
$('#editor').addEventListener('lostpointercapture',()=>endDrag());
$('#editor').addEventListener('pointerleave',()=>{if(placing){ghost=null;drawEditor();}});

async function switchView(next){
  if(running&&next==='2d'){toast('请先停止运行，再编辑场景');return;}
  placing=null;ghost=null;endDrag();view=next;
  $$('#tab-2d,#tab-3d').forEach(button=>{const active=button.id===`tab-${next}`;button.classList.toggle('selected',active);button.setAttribute('aria-selected',String(active));});
  $('#editor').classList.toggle('hidden',next!=='2d');$('#world').classList.toggle('hidden',next!=='3d');
  if(!running){$('#live-frame').classList.add('hidden');$('.camera-presets').classList.remove('hidden');$('#viewport').classList.remove('live-camera');}
  $('#view-description').textContent=next==='2d'?'俯视编辑':'三维场景';
  $('#viewport-mode').innerHTML=`<i></i> ${next==='2d'?'SCENE EDITOR':'ROBOT VIEWER'}`;
  $('#placement-hint').classList.remove('invalid');
  $('#placement-hint span').textContent=next==='2d'?'点击方块选中 · 拖动移动 · 沿灰色弧线旋转':'拖动旋转视角 · 滚轮缩放 · 右键平移';
  $('#demo-watermark').textContent=engine==='demo'?'DEMO · 界面动画演示':'布局预览 · 运行后显示真实仿真';
  $('#demo-watermark').classList.toggle('hidden',next!=='3d');
  if(next==='3d'){
    if(!worldPromise)worldPromise=import('./world.js').then(({createWorld})=>createWorld($('#three-container'))).catch(error=>{console.error(error);$('#webgl-error').classList.remove('hidden');worldPromise=null;return null;});
    world=await worldPromise;
    if(world){world.resize();if(!running)world.setScene(cubes,target);world.setActive(true);}
  }else if(world)world.setActive(false);
  if(next==='2d')drawEditor();
}
$('#tab-2d').onclick=()=>switchView('2d');$('#tab-3d').onclick=()=>switchView('3d');
$$('.palette-card').forEach(button=>button.onclick=async()=>{
  if(running)return;
  await switchView('2d');const color=button.dataset.color;selected=color;
  if(cubes.some(c=>c.color===color)){placing=null;ghost=null;toast(`已选中${LABELS[color]}方块，拖动可重新摆放`);}
  else{placing=color;ghost={color,x:0,y:0,yaw:0};toast(`移动鼠标，将${LABELS[color]}方块放在桌面上`);}
  updateUI();
});
$$('[data-target]').forEach(button=>button.onclick=()=>{if(running)return;target=button.dataset.target;persist();updateUI();});
function removeSelected(){if(running||!selected)return;const before=snapshot();cubes=cubes.filter(c=>c.color!==selected);selected=null;placing=null;ghost=null;commit(before);}
$('#delete-cube').onclick=removeSelected;
$('#clear-scene').onclick=()=>{if(running)return;const before=snapshot();cubes=[];selected=null;placing=null;ghost=null;commit(before);switchView('2d');toast('桌面已清空，从右上角选择方块开始摆放');};
$('#load-example').onclick=()=>{if(running)return;const before=snapshot();cubes=example();target='red';selected='red';placing=null;ghost=null;commit(before);switchView('2d');toast('已载入示例场景');};
$('#undo').onclick=()=>{if(running||!history.length)return;cubes=history.pop();selected=cubes[0]?.color || null;placing=null;ghost=null;persist();updateUI();};
for(const axis of ['x','y'])$('#input-'+axis).addEventListener('change',()=>{
  if(running)return;const before=snapshot(),cube=cubes.find(c=>c.color===selected);if(!cube)return;
  const field=$('#input-'+axis);cube[axis]=field.value.trim()===''?NaN:Number(field.value)/1000;
  const error=validCube(cube,cubes);if(error){cubes=before;toast(error,true);updateUI();return;}commit(before);
});
let sliderBefore=null;
$('#input-yaw').addEventListener('input',()=>{
  if(running)return;const cube=cubes.find(c=>c.color===selected);if(!cube)return;
  if(!sliderBefore)sliderBefore=snapshot();
  cube.yaw=Number($('#input-yaw').value)*Math.PI/180;drawEditor();$('#yaw-value').textContent=$('#input-yaw').value+'°';
});
$('#input-yaw').addEventListener('change',()=>{
  if(!sliderBefore)return;const cube=cubes.find(c=>c.color===selected),error=validCube(cube,cubes),before=sliderBefore;sliderBefore=null;
  if(error){cubes=before;toast(`${error}，已恢复原角度`,true);}commit(before);
});
document.addEventListener('keydown',event=>{
  if($('#info-dialog').open || /INPUT|TEXTAREA/.test(event.target.tagName))return;
  if(event.key==='Escape'){if(drag)endDrag(true);placing=null;ghost=null;drawEditor();}
  if((event.key==='Delete'||event.key==='Backspace')&&selected&&!running){event.preventDefault();removeSelected();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$('#undo').click();}
  if(event.key==='Enter'&&event.target===document.body&&!running){event.preventDefault();$('#run-button').click();}
});
$('#export-scene').onclick=()=>{
  try{const value=validateScene({cubes,target}),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='colorlift-scene.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('场景已导出，可用于重复对照实验');}catch(error){toast(error.message,true);}
};
$('#import-scene').onclick=()=>$('#file-input').click();
$('#file-input').onchange=async event=>{
  try{if(running)return;const file=event.target.files[0];if(!file)return;if(file.size>65536)throw Error('场景文件过大');const value=validateScene(JSON.parse(await file.text())),before=snapshot();cubes=value.cubes;target=value.target;selected=cubes[0].color;placing=null;ghost=null;commit(before);await switchView('2d');toast('场景已导入');}
  catch(error){toast(`导入失败：${error.message}`,true);}finally{event.target.value='';}
};

function setEngine(mode,status=null){
  modelStatus=status;
  engine=mode;const demo=mode==='demo';
  serviceReady=demo||Boolean(status?.ready);
  $('#engine-status').textContent=demo?'演示引擎就绪':serviceReady?'B3 模型已连接':status?.status==='loading'?'模型加载中':'模型服务未就绪';
  const direction=selectedController==='direction'&&!demo;
  $('#engine-name').textContent=demo?'演示模式':direction?'方向示范控制器':status?.model || 'B3 模型';$('#engine-chip').textContent=demo?'DEMO':direction?'EXPERT':'B3';
  $('#engine-description').textContent=demo?'模型尚未连接 · 可体验完整交互':direction?'真实仿真 · 根据邻块位置调整夹爪朝向':serviceReady?'真实 robosuite · 本机 GPU 推理':status?.error || '正在加载权重和仿真环境…';
  const picker=$('#controller-picker');
  picker.classList.toggle('hidden',!serviceReady||demo||!status?.controllers?.includes('direction'));
  picker.querySelectorAll('[data-controller]').forEach(button=>{button.classList.toggle('selected',button.dataset.controller===selectedController);button.setAttribute('aria-pressed',String(button.dataset.controller===selectedController));});
  $('#run-button span').textContent=demo?'运行抓取演示':selectedController==='direction'?'运行方向示范':'运行 B3 抓取';
  $('#footer-mode').textContent=demo?'界面演示，非模型推理结果':serviceReady?'真实 robosuite 仿真 · 示范结果独立统计':'等待模型服务连接';
  $('#demo-watermark').classList.toggle('hidden',view!=='3d'||!$('#live-frame').classList.contains('hidden'));
  if(!running)updateUI();
}
function applyFrame(frame){
  if(!running)return;
  if(activeRecord){recordFrame(activeRecord,frame);if(performance.now()-recordSaveAt>1000){saveRecords();renderRecords();recordSaveAt=performance.now();}}
  if(frame.image){
    $('#live-frame').src=frame.image;$('#live-frame').classList.remove('hidden');
    if(frame.source==='model'||frame.source==='expert'){
      world?.setActive(false);$('.camera-presets').classList.add('hidden');
      $('#viewport').classList.add('live-camera');$('#demo-watermark').classList.add('hidden');
      $('#placement-hint span').textContent=frame.source==='expert'?'真实 robosuite · 方向示范控制 · 实时相机':'真实 robosuite · B3 模型 · 实时相机';
      $('#view-description').textContent=frame.source==='expert'?'方向示范仿真':'真实仿真画面';
    }
  }
  else if(world)world.applyFrame(frame);
  $('#metric-steps').innerHTML=`${Number(frame.step)||0}<small> steps</small>`;
  $('#metric-height').innerHTML=`${((Number(frame.lift_m)||0)*100).toFixed(1)}<small> cm</small>`;
  $('#metric-hold').innerHTML=`${(Number(frame.hold_seconds)||0).toFixed(1)}<small> s</small>`;
  $('#run-progress').style.width=`${Math.max(0,Math.min(1,Number(frame.progress)||0))*100}%`;
  const phase=frame.phase==='hold'?'lift':frame.phase,order=['approach','align','close','lift'],index=order.indexOf(phase);
  $$('#phase-track>div').forEach((node,i)=>{node.classList.toggle('active',i===index);node.classList.toggle('done',index>i);});
  const names={approach:'接近目标',align:'对齐下降',close:'闭合夹爪',lift:'抬升目标',hold:'稳定保持'};
  const source=frame.source==='expert'?'方向示范中 · ':engine==='demo'?'演示中 · ':'B3运行中 · ';
  $('#run-status').textContent=source+(names[frame.phase] || frame.phase || '等待状态');
  if(frame.phase!==lastPhase){lastPhase=frame.phase;log((frame.source==='expert'?'[DIRECTION EXPERT] ':engine==='demo'?'[DEMO] ':'[B3] ')+(names[frame.phase] || frame.phase));}
}
function endRun(message,error=false,result={}){
  if(activeRecord){finishRecord(activeRecord,{...result,status:result.status||(error?'error':'cancelled'),message});activeRecord=null;saveRecords();}
  stream?.close();stream=null;running=false;$('#monitor-dot').classList.remove('running');$('#run-status').textContent=message;
  log(message);updateUI();renderRecords();toast(message,error);runId=null;
}
$('#run-button').onclick=async()=>{
  if(running||!serviceReady)return;
  let scene;
  try{scene=validateScene({cubes,target});}catch(error){toast(error.message,true);return;}
  running=true;runId=null;lastPhase=null;const session=++runSession;
  const runSource=engine==='demo'?'demo':selectedController==='direction'?'expert':'model';
  activeRecord=createRecord(scene,runSource);runRecords.unshift(activeRecord);runRecords=runRecords.slice(0,RECORD_LIMIT);saveRecords();renderRecords();
  updateUI();$('#run-status').textContent='准备场景…';$('#monitor-dot').classList.add('running');$('#run-progress').style.width='0%';
  $('#metric-steps').innerHTML='0<small> steps</small>';$('#metric-height').innerHTML='0.0<small> cm</small>';$('#metric-hold').innerHTML='0.0<small> s</small>';
  $$('#phase-track>div').forEach(n=>n.classList.remove('active','done'));
  $('#live-frame').classList.add('hidden');
  log(`提交场景 · ${cubes.length} 个方块 · 目标：${LABELS[target]}${engine==='demo'?' · 演示动画，无模型推理':''}`);
  try{
    await switchView('3d');
    if(session!==runSession||!running)return;
    if(!world&&engine==='demo')throw Error('无法创建三维场景，请检查浏览器硬件加速');
    if(world)world.setScene(cubes,target);
    const response=await fetch('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scene,controller:runSource==='expert'?'direction':'b3'})});
    const result=await response.json();if(!response.ok)throw Error(result.error || '启动失败');
    if(!result.id || !/^[a-zA-Z0-9_-]+$/.test(result.id))throw Error('后端返回了无效的运行编号');
    if(session!==runSession||!running){fetch(`/api/runs/${result.id}/cancel`,{method:'POST'}).catch(()=>{});return;}
    runId=result.id;stream=new EventSource(`/api/runs/${runId}/events`);
    if(activeRecord){activeRecord.run_id=runId;if(['demo','expert','model'].includes(result.source))activeRecord.source=result.source;saveRecords();renderRecords();}
    stream.addEventListener('frame',event=>{if(session!==runSession)return;try{applyFrame(JSON.parse(event.data));}catch(error){console.error(error);endRun('收到无效的模型状态',true);}});
    stream.addEventListener('done',event=>{
      if(session!==runSession)return;
      try{const result=JSON.parse(event.data),demo=result.source==='demo';
        let message=result.status==='cancelled'?'运行已停止':demo?'演示完成 · 尚未连接训练模型':result.message || (result.success===true?'抓取成功':result.success===false?'抓取未成功':'模型运行结束');
        if(result.status==='completed'&&(demo||result.success===true)){$('#run-progress').style.width='100%';$$('#phase-track>div').forEach(n=>{n.classList.remove('active');n.classList.add('done');});}
        if(activeRecord&&['demo','expert','model'].includes(result.source))activeRecord.source=result.source;
        endRun(message,false,result);
      }catch{endRun('无法读取运行结果',true);}
    });
    stream.addEventListener('error',()=>{if(running&&session===runSession){if(runId)fetch(`/api/runs/${runId}/cancel`,{method:'POST'}).catch(()=>{});endRun('状态流连接中断，请检查模型服务后重试',true);}});
  }catch(error){if(session===runSession)endRun(`启动失败：${error.message}`,true);}
};
$$('[data-controller]').forEach(button=>button.onclick=()=>{
  if(running)return;
  selectedController=button.dataset.controller;
  $$('[data-controller]').forEach(item=>{item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));});
  const direction=selectedController==='direction';
  $('#run-button span').textContent=direction?'运行方向示范':'运行 B3 抓取';
  $('#engine-name').textContent=direction?'方向示范控制器':'冻结 B3 模型';
  $('#engine-chip').textContent=direction?'EXPERT':'B3';
  $('#engine-description').textContent=direction?'真实仿真 · 根据邻块位置调整夹爪朝向':'真实 robosuite · 本机 GPU 推理';
  $('#run-note').textContent=direction?'真实仿真结果单独记录，不计入 B3 成功率':'原始冻结策略 · 运行后显示实时相机';
});
$('#stop-button').onclick=async()=>{
  if(!running)return;
  const id=runId;
  if(!id){++runSession;endRun('已取消启动');return;}
  $('#stop-button').disabled=true;
  try{const response=await fetch(`/api/runs/${id}/cancel`,{method:'POST'});if(!response.ok)throw Error('停止请求未被服务接受');const state=await response.json();if(state.status==='cancelling'){$('#run-status').textContent='正在停止模型，等待仿真退出…';}else if(running)endRun('运行已停止');}
  catch(error){toast(error.message,true);}finally{$('#stop-button').disabled=false;}
};
let pageClosing=false;
function leavePage(){
  if(pageClosing)return;pageClosing=true;++runSession;
  const id=runId;stream?.close();
  if(activeRecord)endRun('页面离开，未收到最终结果；已尝试停止后端任务',false,{status:'interrupted'});
  if(id)navigator.sendBeacon(`/api/runs/${id}/cancel`,'{}');
}
// Close the stream before navigation tears down the connection; otherwise an
// ordinary refresh may be mislabeled as a transport failure.
window.addEventListener('beforeunload',leavePage);
window.addEventListener('pagehide',leavePage);
window.addEventListener('pageshow',()=>{pageClosing=false;});
$$('[data-camera]').forEach(button=>button.onclick=()=>{world?.setCamera(button.dataset.camera);$$('[data-camera]').forEach(b=>b.classList.toggle('active',b===button));});
$('#expand-log').onclick=()=>{const visible=$('#log-panel').classList.toggle('hidden');$('#log-toggle').textContent=visible?'＋':'−';};
$('#rail-records').onclick=()=>{$('#records-panel').scrollIntoView({behavior:'smooth',block:'start'});};
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#info-dialog').showModal();}
$('#connect-button').onclick=()=>dialog('模型连接状态',engine==='model'?`<p><strong>${serviceReady?'B3 模型已连接':'模型服务尚未就绪'}</strong><br>${escapeHTML(modelStatus?.model)}<br>${escapeHTML(modelStatus?.gpu || modelStatus?.error)}</p><p>真实模型工作在本机 Ubuntu / robosuite 中，使用原有双相机输入和阶段控制器。运行后显示真实前方相机画面，结果由原环境判定。</p><p>成功条件：目标相对初始高度抬升超过 4 cm，接触、速度与漂移满足要求并连续保持 2 秒，且未抓错颜色。</p><p>权重 SHA256<br><code>${escapeHTML(modelStatus?.checkpoint_sha256 || '尚未取得')}</code></p><p>每次运行的视频、初始布局、逐步 CSV 和判分 JSON 保存在 <code>机器人项目/results/web_model_runs</code>。</p>`:`<p><strong>当前为演示模式</strong>，运行展示的是程序生成的三维动画。</p><p>本机已支持 B3 模型接入。双击网站目录的 <code>启动模型网站.cmd</code>，等待模型就绪后打开 <code>http://localhost:4180</code>。</p><p>完整后端协议见 <code>API.md</code>。模型权重保留在 Ubuntu，不会交给浏览器或上传公网。</p>`);
$('#help-button').onclick=()=>dialog('从一个方块开始',`<p><strong>01 / 摆放</strong><br>点击右上角色块，把鼠标移入二维桌面，再单击固定中心。已放置的方块可直接拖动。每种颜色一个方块。</p><p><strong>02 / 旋转</strong><br>选中方块，沿灰色弧线拖动；也可以在属性面板中输入坐标或拖动角度滑块。红色斜线标记重叠区域，无效移动会恢复原位置。</p><p><strong>03 / 运行</strong><br>选择抓取目标，点击运行。界面自动转为三维，实时显示各阶段和状态。当前演示动画不代表模型实际表现。</p><p><strong>快捷键</strong>：Esc 取消摆放，Delete 移除选中方块，Ctrl / ⌘ + Z 撤销。支持场景 JSON 导入和导出。</p>`);
$('#close-dialog').onclick=$('#dialog-ok').onclick=()=>$('#info-dialog').close();
$('#info-dialog').addEventListener('click',event=>{if(event.target===$('#info-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});

updateUI();saveRecords();renderRecords();log('工作台就绪 · 在二维视图中编辑场景，或切换三维预览');
async function refreshService(){
  clearTimeout(statusTimer);
  try{const response=await fetch('/api/config');if(!response.ok)throw Error();const config=await response.json();setEngine(config.mode,config.modelStatus);if(config.mode==='model')statusTimer=setTimeout(refreshService,5000);}
  catch{serviceReady=false;$('#engine-status').textContent='服务未连接';if(!running)updateUI();statusTimer=setTimeout(refreshService,5000);}
}
refreshService();
