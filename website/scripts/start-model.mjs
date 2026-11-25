import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openBrowser} from './open-browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=process.env.MODEL_WEB_PORT || '4180';
const backendPort=process.env.MODEL_BACKEND_PORT || '8000';
const backendUrl=`http://127.0.0.1:${backendPort}`;
const linuxPath=path.join(root,'backend','robot_service.py').replace(/^([A-Za-z]):/,(_,drive)=>'/mnt/'+drive.toLowerCase()).replaceAll('\\','/');
let robot=null,web=null,stopping=false;
const shutdownToken=randomUUID();
async function stop(){
 if(stopping)return;stopping=true;web?.kill();
 if(robot){
   try{await fetch(backendUrl+'/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Control':shutdownToken},body:'{}',signal:AbortSignal.timeout(3000)});}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));robot.kill();
 }
}
process.on('SIGINT',()=>{stop().finally(()=>process.exit(0));});
process.on('SIGTERM',()=>{stop().finally(()=>process.exit(0));});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let currentWebsite=null;
 try{currentWebsite=await (await fetch(`http://127.0.0.1:${port}/api/config`,{signal:AbortSignal.timeout(3000)})).json();}catch{}
 if(currentWebsite?.name==='ColorLift Studio'&&currentWebsite.mode==='model'&&currentWebsite.modelStatus?.ready){
   console.log(`模型工作台已在运行，正在打开 http://localhost:${port}`);
   openBrowser(`http://localhost:${port}`);
 }else{
 let existing=null;
 try{existing=await (await fetch(backendUrl+'/health',{signal:AbortSignal.timeout(2000)})).json();}catch{}
 if(existing?.source!=='model'){
   robot=spawn('wsl.exe',['-d','Ubuntu-22.04','--','/home/banus/colorlift-b3/.venv/bin/python','-u',linuxPath,'--port',backendPort,'--gpu','0','--shutdown-token',shutdownToken],{stdio:'inherit',windowsHide:true});
   robot.on('error',error=>console.error('无法启动 Ubuntu 模型服务：',error.message));
 }
 console.log('正在等待 B3 权重和 robosuite 环境加载…');
 let ready=false;
 for(let i=0;i<150;i++){
   if(i>0&&i%10===0)console.log('模型服务仍在加载，请保持窗口开启…');
   if(robot?.exitCode!==null&&robot?.exitCode!==undefined)throw Error('Ubuntu 模型服务已退出，请查看上方错误');
   try{const status=await(await fetch(backendUrl+'/health',{signal:AbortSignal.timeout(2000)})).json();if(status.error)throw Object.assign(Error(status.error),{modelError:true});if(status.ready){ready=true;console.log(`模型就绪：${status.model} / ${status.gpu}`);break;}}
   catch(error){if(error.modelError)throw error;}
   await sleep(1000);
 }
 if(!ready)throw Error('模型服务加载超时');
 web=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,ROBOT_BACKEND_URL:backendUrl,PORT:port,HOST:'127.0.0.1'},stdio:'inherit',windowsHide:true});
 web.on('exit',async(code)=>{await stop();process.exitCode=code || 0;});
 web.on('error',error=>{console.error('网站进程启动失败：',error.message);stop();process.exitCode=1;});
 for(let i=0;i<20;i++){
   if(web.exitCode!==null)throw Error('网站启动失败，请检查端口是否被占用');
   try{const status=await(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).json();if(status.status==='ok'&&status.mode==='model'){openBrowser(`http://localhost:${port}`);break;}}catch{}
   await sleep(500);
 }
 console.log(`\n真实模型工作台：http://localhost:${port}\n请保持此窗口开启，Ctrl+C 停止网站。\n`);
 }
}catch(error){console.error(error.message);await stop();process.exitCode=1;}
