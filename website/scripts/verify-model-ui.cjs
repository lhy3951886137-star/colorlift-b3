const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const output=path.resolve(__dirname,'../test-results');
const base='http://127.0.0.1:4180';
async function main(){
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_EXE?{executablePath:process.env.EDGE_EXE}:{channel:'msedge'})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const responses=[];page.on('response',async response=>{if(response.url()===base+'/api/runs'&&response.status()===201)responses.push(await response.json());});
  await page.goto(base);await page.locator('#engine-status').filter({hasText:'B3 模型已连接'}).waitFor();
  await page.click('#load-example');
  if(process.env.TEST_TARGET)await page.click(`[data-target=${process.env.TEST_TARGET}]`);
  await page.click('#run-button');
  await page.waitForFunction(()=>!document.querySelector('#live-frame').classList.contains('hidden')&&document.querySelector('#live-frame').naturalWidth===640,null,{timeout:90000});
  await page.screenshot({path:path.join(output,'b3-live-running.png'),fullPage:true});
  await page.waitForFunction(()=>!document.querySelector('#run-button').classList.contains('hidden'),null,{timeout:120000});
  const id=responses[0]?.id;assert(id,'Run must originate from the real API');
  const result=await(await page.request.get(`${base}/api/runs/${id}/result`)).json();
  await fs.writeFile(path.join(output,'b3-web-result.json'),JSON.stringify(result,null,2));
  assert.equal(result.source,'model');assert.equal(typeof result.success,'boolean');
  assert.equal(result.checkpoint_sha256,'d34b91b8882a764d7556a6a28663b6fe3d5d2b8a94426dbffa798d41ba41704d');
  assert(result.policy_queries>0&&result.steps>0);assert.equal(result.hz,20);
  assert.equal(await page.locator('#stat-model').innerText(),`${result.success?1:0} / 1`);
  const video=await page.request.get(`${base}/api/runs/${id}/video`);assert.equal(video.status(),200);assert((await video.body()).length>10000);
  await page.screenshot({path:path.join(output,'b3-live-completed.png'),fullPage:true});
  await page.locator('#record-rows tr').first().getByRole('button',{name:'详情',exact:true}).click();
  await page.locator('#dialog-body video').waitFor();await page.waitForFunction(()=>document.querySelector('#dialog-body video').readyState>=1);
  await page.locator('#info-dialog').screenshot({path:path.join(output,'b3-model-record.png')});await page.click('#close-dialog');
  await page.click('[data-target=blue]');await page.click('#run-button');
  await page.waitForFunction(()=>Number(document.querySelector('#metric-steps').textContent.replace(/\D/g,''))>=3,null,{timeout:90000});
  await page.click('#stop-button');await page.waitForFunction(()=>!document.querySelector('#run-button').classList.contains('hidden'),null,{timeout:90000});
  const stopId=responses[1]?.id;const stopped=await(await page.request.get(`${base}/api/runs/${stopId}/result`)).json();
  assert.equal(stopped.status,'cancelled');assert.equal(stopped.success,null);
  assert.equal(await page.locator('#stat-model').innerText(),`${result.success?1:0} / 1`,'Stopped model runs must not enter success denominator');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({verified:true,id,success:result.success,steps:result.steps,hold_streak:result.hold_streak,eligible:result.eligible,cancel_status:stopped.status,camera_width:640},null,2));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
