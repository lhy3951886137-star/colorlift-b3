// Requires a running local website: npm start
import test from 'node:test';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4173';
const scene={target:'red',cubes:[{color:'red',x:-.08,y:.05,yaw:.2},{color:'yellow',x:.08,y:.05,yaw:0},{color:'blue',x:0,y:-.08,yaw:0}]};
test('API rejects invalid user placement before creating a run',async()=>{
 const overlap=structuredClone(scene);overlap.cubes[1].x=-.08;
 const response=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(overlap)});
 assert.equal(response.status,400);assert.match((await response.json()).error,/重叠/);
});
test('SSE reports demo state and explicit null success; cancellation is replayable',async()=>{
 const response=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(scene)});
 assert.equal(response.status,201);const run=await response.json();assert.equal(run.source,'demo');
 const controller=new AbortController();
 try{
  const events=await fetch(`${base}/api/runs/${run.id}/events`,{signal:controller.signal});
  assert.match(events.headers.get('Content-Type'),/text\/event-stream/);
  const reader=events.body.getReader();let text='';const decode=new TextDecoder();
  while(!text.includes('event: frame')){const {done,value}=await reader.read();assert.equal(done,false);text+=decode.decode(value,{stream:true});}
  assert.match(text,/"source":"demo"/);assert.match(text,/"score":null/);
  const cancel=await fetch(`${base}/api/runs/${run.id}/cancel`,{method:'POST'});assert.equal(cancel.status,200);
  const result=await fetch(`${base}/api/runs/${run.id}/events`);const end=await result.text();
  assert.match(end,/event: done/);assert.match(end,/"status":"cancelled"/);assert.match(end,/"success":null/);
 }finally{controller.abort();await fetch(`${base}/api/runs/${run.id}/cancel`,{method:'POST'});}
});
