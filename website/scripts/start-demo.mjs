import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openBrowser} from './open-browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=4173,url=`http://localhost:${port}`;
let child=null,stopping=false;
async function health(){try{const response=await fetch(`http://127.0.0.1:${port}/api/config`,{signal:AbortSignal.timeout(2000)});return await response.json();}catch{return null;}}
function stop(){if(stopping)return;stopping=true;child?.kill();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop();process.exit(0);});
try{
  const existing=await health();
  if(existing?.name==='ColorLift Studio'&&existing.mode==='demo'){
    console.log(`演示网站已在运行，正在打开 ${url}`);openBrowser(url);
  }else{
    console.log('正在启动本机演示网站…');
    child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ROBOT_BACKEND_URL:''},stdio:'inherit',windowsHide:true});
    child.on('error',error=>{console.error(error.message);process.exitCode=1;});
    let ready=false;
    for(let i=0;i<20;i++){
      if(child.exitCode!==null)throw Error('网站启动失败，请查看上方错误');
      const status=await health();
      if(status?.name==='ColorLift Studio'&&status.mode==='demo'){ready=true;openBrowser(url);break;}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw Error('网站启动超时');
    console.log(`网站已打开：${url}\n请保持此窗口开启，Ctrl+C 停止服务。`);
  }
}catch(error){console.error(error.message);stop();process.exitCode=1;}
