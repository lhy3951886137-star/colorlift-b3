import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CONFIG, validateScene, toRobosuiteLayout } from './public/geometry.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT || 4173);
const host=process.env.HOST || (process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
const backend=(process.env.ROBOT_BACKEND_URL || '').replace(/\/$/,'');
if (backend && !/^https?:\/\//.test(backend)) throw Error('ROBOT_BACKEND_URL must use http:// or https://');
const runs=new Map();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req) {
  let text='';
  for await (const chunk of req) {text+=chunk;if(text.length>65536) throw Error('请求过大');}
  return JSON.parse(text || '{}');
}
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
function demoFrame(run,step) {
  const t=step/CONFIG.hz, target=run.scene.cubes.find(c=>c.color===run.scene.target);
  let phase, p,gripper=0.08, lift=0;
  const home=[-.25,0,1.12], pre=[target.x,target.y,1.00], grasp=[target.x,target.y,.837];
  if(t<2.8){phase='approach';p=home.map((v,i)=>lerp(v,pre[i],smooth(t/2.8)));}
  else if(t<5.1){phase='align';p=pre.map((v,i)=>lerp(v,grasp[i],smooth((t-2.8)/2.3)));}
  else if(t<6.4){phase='close';p=grasp;gripper=lerp(.08,.04,smooth((t-5.1)/1.3));}
  else if(t<8.8){phase='lift';lift=.075*smooth((t-6.4)/2.4);p=[grasp[0],grasp[1],grasp[2]+lift];gripper=.04;}
  else{phase='hold';lift=.075;p=[grasp[0],grasp[1],grasp[2]+lift];gripper=.04;}
  return { source:'demo', step, hz:CONFIG.hz, phase, progress:Math.min(t/10.8,1),
    eef:{x:p[0],y:p[1],z:p[2]}, gripper, lift_m:lift, hold_seconds:Math.max(0,t-8.8),
    cubes:run.scene.cubes.map(c=>({...c,z:CONFIG.tableHeight+.02+(c.color===run.scene.target?lift:0)})),
    score:null, message:'界面演示动画，未调用训练模型' };
}
function send(run,event,data) {
  const msg=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for(const client of run.clients) client.write(msg);
  run.last={event,data};
}
function finish(run,status) {
  if(run.status!=='running')return;
  clearInterval(run.timer);run.status=status;
  send(run,'done',{source:'demo',status,success:null,steps:run.step,message:status==='cancelled'?'演示已停止':'演示完成；真实抓取结果将在接入模型后提供'});
  for(const client of run.clients)client.end();run.clients.clear();
  const cleanup=setTimeout(()=>runs.delete(run.id),10*60*1000);cleanup.unref();
}
async function proxy(req,res,suffix,method='GET',payload) {
  const controller=new AbortController();
  res.on('close',()=>controller.abort());
  const upstream=await fetch(backend+suffix,{method,signal:controller.signal,
    headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
  const headers={'Content-Type':upstream.headers.get('Content-Type') || 'application/json','Cache-Control':'no-cache','X-Accel-Buffering':'no'};
  if(upstream.headers.get('Content-Length'))headers['Content-Length']=upstream.headers.get('Content-Length');
  res.writeHead(upstream.status,headers);
  if(upstream.body)for await(const chunk of upstream.body){if(res.destroyed)break;res.write(chunk);}
  res.end();
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/api/health')return json(res,200,{status:'ok',mode:backend?'model':'demo'});
    if(req.method==='GET' && url.pathname==='/api/config'){
      let modelStatus=null;
      if(backend){try{modelStatus=await (await fetch(backend+'/health',{signal:AbortSignal.timeout(3000)})).json();}catch{modelStatus={ready:false,status:'offline',error:'模型服务无法连接'};}}
      return json(res,200,{...CONFIG,mode:backend?'model':'demo',backendConfigured:Boolean(backend),modelStatus,name:'ColorLift Studio'});
    }
    if(req.method==='POST' && url.pathname==='/api/runs') {
      const request=await body(req);
      const scene=validateScene(request);
      const controller=request.controller ?? 'b3';
      if(!['b3','direction'].includes(controller))return json(res,400,{error:'控制器无效'});
      if(backend)return await proxy(req,res,'/runs','POST',{...scene,controller,layout:toRobosuiteLayout(scene,Date.now()%2000000000)});
      if([...runs.values()].filter(r=>r.status==='running').length>=4)return json(res,429,{error:'正在运行的演示过多，请稍后重试'});
      const id=randomUUID(),run={id,scene,clients:new Set(),status:'running',step:0,last:null};runs.set(id,run);
      run.timer=setInterval(()=>{
        run.step++;send(run,'frame',demoFrame(run,run.step));
        if(run.step>=216)finish(run,'completed');
      },50);
      return json(res,201,{id,source:'demo'});
    }
    const match=url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/(events|cancel|video|result)$/);
    if(match){
      const [,id,action]=match;
      if((action==='video'||action==='result')&&req.method==='GET'){
        if(backend)return await proxy(req,res,`/runs/${id}/${action}`);
        return json(res,404,{error:'演示模式没有真实仿真文件'});
      }
      if(action==='events'&&req.method==='GET'){
        if(backend)return await proxy(req,res,`/runs/${id}/events`);
        const run=runs.get(id);if(!run)return json(res,404,{error:'运行记录不存在或已过期'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 1500\n\n');run.clients.add(res);
        if(run.last)res.write(`event: ${run.last.event}\ndata: ${JSON.stringify(run.last.data)}\n\n`);
        if(run.status!=='running'){run.clients.delete(res);res.end();}
        req.on('close',()=>run.clients.delete(res));return;
      }
      if(action==='cancel'&&req.method==='POST'){
        if(backend)return await proxy(req,res,`/runs/${id}/cancel`,'POST',{});
        const run=runs.get(id);if(!run)return json(res,404,{error:'运行记录不存在'});
        finish(run,'cancelled');return json(res,200,{status:run.status});
      }
    }
    if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
    if(req.method!=='GET' && req.method!=='HEAD')return json(res,405,{error:'请求方法不支持'});
    const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const base=relative==='vendor/three.module.js'?path.join(root,'node_modules/three/build'):path.join(root,'public');
    const file=relative==='vendor/three.module.js'?path.join(base,'three.module.js'):path.resolve(base,relative);
    if(!file.startsWith(base+path.sep))return json(res,403,{error:'路径不可访问'});
    try{const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}
    catch{return json(res,404,{error:'文件不存在'});}
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.end();}
});
server.listen(port,host,()=>console.log(`\n  ColorLift Studio → http://localhost:${port}\n  Listening: ${host}:${port}\n  Engine: ${backend?'model backend':'demo (no model connected)'}\n`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const run of runs.values())finish(run,'cancelled');server.close(()=>process.exit(0));});
