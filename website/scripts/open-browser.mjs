import {spawn} from 'node:child_process';

// The URL is a fixed local endpoint supplied by the launcher, never shell text.
export function openBrowser(url){
  if(process.platform!=='win32')return;
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,windowsHide:true,stdio:'ignore'});
  child.on('error',error=>console.log(`无法自动打开浏览器，请手动打开 ${url}：${error.message}`));
  child.unref();
}
