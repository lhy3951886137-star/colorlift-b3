import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scene={target:'red',controller:'direction',cubes:[
  {color:'red',x:-.02,y:0,yaw:0},
  {color:'yellow',x:.02,y:0,yaw:0},
  {color:'blue',x:0,y:-.1,yaw:0}
]};

test('gateway forwards direction controller so edge contact reaches expert validation',async()=>{
  let forwarded;
  const backend=createServer(async(req,res)=>{
    if(req.url==='/health'){
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:true}));return;
    }
    let text='';for await(const chunk of req)text+=chunk;
    forwarded=JSON.parse(text);
    res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'run_test',source:'expert'}));
  });
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  const backendPort=backend.address().port;
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const appPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(appPort),HOST:'127.0.0.1',ROBOT_BACKEND_URL:`http://127.0.0.1:${backendPort}`},stdio:'ignore'});
  try{
    const base=`http://127.0.0.1:${appPort}`;
    let ready=false;
    for(let i=0;i<50&&!ready;i++){
      try{ready=(await fetch(base+'/api/health')).ok;}catch{}
      if(!ready)await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(ready,true,'gateway did not start');
    const response=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(scene)});
    assert.equal(response.status,201);
    assert.equal((await response.json()).source,'expert');
    assert.equal(forwarded.controller,'direction');
    assert.deepEqual(forwarded.layout.xy,[[-.02,0],[.02,0],[0,-.1]]);
  }finally{
    app.kill();await new Promise(resolve=>app.once('exit',resolve));
    await new Promise(resolve=>backend.close(resolve));
  }
});
