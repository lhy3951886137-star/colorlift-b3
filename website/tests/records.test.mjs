import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, recordFrame, finishRecord, loadRecords, summarizeRecords } from '../public/records.js';
const scene={target:'red',cubes:[{color:'red',x:-.08,y:.05,yaw:.2},{color:'yellow',x:.08,y:.05,yaw:0},{color:'blue',x:0,y:-.08,yaw:0}]};
const make=(source='model')=>createRecord(scene,source,'2026-11-23T10:00:00.000Z');
test('demo cannot become experiment success even if done claims true',()=>{
 const record=make('demo');recordFrame(record,{step:216,hz:20,lift_m:.075,hold_seconds:2,phase:'hold'});
 finishRecord(record,{status:'completed',success:true,steps:216},'2026-11-23T10:00:12.000Z');
 assert.equal(record.success,null);assert.equal(record.completion_steps,null);assert.equal(record.wall_seconds,12);
 assert.equal(summarizeRecords([record]).model_success_rate,null);
});
test('success-only completion statistics exclude model failure, cancellation and transport errors',()=>{
 const success=make();recordFrame(success,{step:70,hz:20,phase:'hold'});finishRecord(success,{status:'completed',success:true});
 const failure=make();finishRecord(failure,{status:'failed',success:false,steps:220});
 const stopped=make();finishRecord(stopped,{status:'cancelled',success:true,steps:10});
 const error=make();finishRecord(error,{status:'error',success:false,steps:3});
 const summary=summarizeRecords([success,failure,stopped,error]);
 assert.equal(summary.judged_model_runs,2);assert.equal(summary.model_success_rate,.5);
 assert.equal(summary.success_mean_completion_steps,70);assert.equal(success.completion_seconds,3.5);
 assert.equal(summary.unscored_model_runs,2);assert.equal(stopped.success,null);assert.equal(error.success,null);
});
test('observed maxima and phase transitions retain meaningful values without camera payloads',()=>{
 const record=make();recordFrame(record,{step:5,phase:'approach',lift_m:0,hold_seconds:0,image:'data:image/jpeg;base64,...'});
 recordFrame(record,{step:8,phase:'approach',lift_m:.06,hold_seconds:1.2});
 recordFrame(record,{step:9,phase:'hold',lift_m:.04,hold_seconds:0});
 assert.equal(record.phases.length,2);assert.equal(record.max_lift_m,.06);assert.equal(record.max_hold_seconds,1.2);
 assert.equal(record.hold_seconds,0);assert.equal(record.image,undefined);
});
test('reload marks unfinished run interrupted rather than inventing success or failure',()=>{
 const record=make();const loaded=loadRecords(JSON.stringify([record]));
 assert.equal(loaded[0].status,'interrupted');assert.equal(loaded[0].success,null);
 assert.equal(summarizeRecords(loaded).judged_model_runs,0);
 assert.deepEqual(loadRecords('broken json'),[]);assert.deepEqual(loadRecords(JSON.stringify([{id:'invalid'}])),[]);
});
