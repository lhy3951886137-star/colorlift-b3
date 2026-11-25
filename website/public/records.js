import { validateScene } from './geometry.js';

export const RECORD_LIMIT=30;
export const RECORD_KEY='colorlift.runs.v1';
export const STATUS_LABELS={running:'运行中',completed:'已完成',cancelled:'已停止',error:'运行异常',interrupted:'页面中断',failed:'未成功'};
const sourceOf=value=>['model','expert'].includes(value)?value:'demo';
export function createRecord(scene,source,now=new Date().toISOString()){
  return {id:crypto.randomUUID(),run_id:null,source:sourceOf(source),started_at:now,ended_at:null,
    status:'running',success:null,message:'',scene:validateScene(scene),control_steps:0,hz:null,
    lift_m:null,max_lift_m:null,hold_seconds:null,max_hold_seconds:null,completion_steps:null,completion_seconds:null,
    phases:[],wall_seconds:null};
}
export function recordFrame(record,frame){
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  if(finite(frame.step)&&frame.step>=0)record.control_steps=Math.max(record.control_steps,Math.floor(frame.step));
  if(finite(frame.hz)&&frame.hz>0)record.hz=frame.hz;
  if(finite(frame.lift_m)){record.lift_m=frame.lift_m;record.max_lift_m=Math.max(record.max_lift_m??frame.lift_m,frame.lift_m);}
  if(finite(frame.hold_seconds)&&frame.hold_seconds>=0){record.hold_seconds=frame.hold_seconds;record.max_hold_seconds=Math.max(record.max_hold_seconds??0,frame.hold_seconds);}
  if(['approach','align','close','lift','hold'].includes(frame.phase)&&record.phases.at(-1)?.phase!==frame.phase)
    record.phases.push({phase:frame.phase,step:record.control_steps});
}
export function finishRecord(record,result,now=new Date().toISOString()){
  record.status=['completed','cancelled','failed','error','interrupted'].includes(result.status)?result.status:'error';
  record.ended_at=now;record.message=typeof result.message==='string'?result.message.slice(0,500):'';
  if(typeof result.checkpoint_sha256==='string')record.checkpoint_sha256=result.checkpoint_sha256;
  if(typeof result.termination==='string')record.termination=result.termination;
  if(typeof result.eligible==='boolean')record.contact_qualified=result.eligible;
  if(result.artifacts&&record.run_id&&/^[a-zA-Z0-9_-]+$/.test(record.run_id))
    record.artifacts={video:`/api/runs/${record.run_id}/video`,result:`/api/runs/${record.run_id}/result`};
  if(typeof result.hz==='number'&&Number.isFinite(result.hz)&&result.hz>0)record.hz=result.hz;
  if(Number.isFinite(result.steps)&&result.steps>=0)record.control_steps=Math.floor(result.steps);
  // Demo completion and local transport errors are never experiment successes.
  record.success=['model','expert'].includes(record.source)&&['completed','failed'].includes(record.status)&&typeof result.success==='boolean'?result.success:null;
  record.completion_steps=record.success===true?record.control_steps:null;
  record.completion_seconds=record.success===true&&record.hz?record.control_steps/record.hz:null;
  record.wall_seconds=Math.max(0,(Date.parse(now)-Date.parse(record.started_at))/1000);
  return record;
}
export function loadRecords(raw){
  try{
    const values=JSON.parse(raw);if(!Array.isArray(values))return [];
    return values.slice(0,RECORD_LIMIT).flatMap(value=>{
      try{
        if(!value||typeof value.id!=='string'||!Number.isFinite(Date.parse(value.started_at)))return [];
        const record={...value,scene:validateScene(value.scene),source:sourceOf(value.source)};
        if(record.status==='running')finishRecord(record,{status:'interrupted',message:'页面刷新或关闭，未收到最终结果；后端是否停止需另行确认'});
        if(record.source==='demo')record.success=null;
        return [record];
      }catch{return [];}
    });
  }catch{return [];}
}
export function summarizeRecords(records){
  const judged=records.filter(r=>r.source==='model'&&['completed','failed'].includes(r.status)&&typeof r.success==='boolean');
  const expert=records.filter(r=>r.source==='expert'&&['completed','failed'].includes(r.status)&&typeof r.success==='boolean');
  const successes=judged.filter(r=>r.success);
  return {saved_records:records.length,demo_records:records.filter(r=>['demo','expert'].includes(r.source)).length,
    expert_runs:expert.length,expert_successes:expert.filter(r=>r.success).length,
    judged_model_runs:judged.length,model_successes:successes.length,model_success_rate:judged.length?successes.length/judged.length:null,
    success_mean_completion_steps:successes.length?successes.reduce((s,r)=>s+r.completion_steps,0)/successes.length:null,
    unscored_model_runs:records.filter(r=>r.source==='model').length-judged.length,
    scope:'仅当前浏览器保留的最近记录，非完整实验评测；演示、停止、中断、通信异常和无明确判分的运行不计入模型成功率'};
}
