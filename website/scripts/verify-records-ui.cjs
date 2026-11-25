const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const output=path.resolve(__dirname,'../test-results');
async function main(){
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_EXE?{executablePath:process.env.EDGE_EXE}:{channel:'msedge'})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#engine-status').filter({hasText:'演示引擎就绪'}).waitFor();
  assert.equal(await page.locator('#stat-total').innerText(),'0');
  await page.click('[data-target=blue]');await page.click('#run-button');
  await page.waitForFunction(()=>document.querySelector('#run-status').textContent.includes('演示完成'),null,{timeout:30000});
  assert.equal(await page.locator('#stat-demo').innerText(),'1');assert.equal(await page.locator('#stat-model').innerText(),'—');
  assert.match(await page.locator('#record-rows').innerText(),/演示完成 · 未判分/);
  const firstId=await page.locator('#record-rows tr').getAttribute('data-record-id');
  await page.reload();await page.locator('#record-rows tr').waitFor();
  assert.equal(await page.locator('#stat-total').innerText(),'1','Records must survive reload');
  await page.locator('#record-rows button').filter({hasText:'详情'}).click();
  assert.match(await page.locator('#dialog-body').innerText(),/不计入成功率/);
  await page.locator('#info-dialog').screenshot({path:path.join(output,'record-detail.png')});
  const downloadPromise=page.waitForEvent('download');await page.click('#record-detail-export');
  const download=await downloadPromise,record=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(record.record.id,firstId);assert.equal(record.record.success,null);assert.equal(record.record.completion_steps,null);
  assert.equal(record.record.control_steps,216);assert.equal(record.record.scene.target,'blue');
  await page.click('#close-dialog');await page.click('#tab-2d');await page.click('#clear-scene');
  await page.locator('#record-rows button').filter({hasText:'恢复场景'}).click();
  assert.equal(await page.locator('#placed-count').innerText(),'3 / 3');assert.equal(await page.locator('[data-target=blue]').getAttribute('aria-pressed'),'true');
  await page.click('#run-button');await page.waitForFunction(()=>Number(document.querySelector('#metric-steps').textContent.replace(/\D/g,''))>5);
  await page.click('#stop-button');await page.waitForFunction(()=>document.querySelector('#record-rows').textContent.includes('已停止'));
  assert.equal(await page.locator('#stat-total').innerText(),'2');
  // Closing/reloading before a final event is not an experimental failure.
  await page.click('#run-button');await page.waitForFunction(()=>Number(document.querySelector('#metric-steps').textContent.replace(/\D/g,''))>5);
  await page.reload();await page.locator('#record-rows tr').first().waitFor();
  assert.match(await page.locator('#record-rows tr').first().innerText(),/页面中断/);
  assert.equal(await page.locator('#stat-total').innerText(),'3');
  await page.click('[data-record-filter=model]');assert.equal(await page.locator('#records-empty').isVisible(),true);
  await page.click('[data-record-filter=all]');assert.equal(await page.locator('#record-rows tr').count(),3);
  const exportPromise=page.waitForEvent('download');await page.click('#export-records');const exported=await exportPromise;
  const all=JSON.parse(await fs.readFile(await exported.path(),'utf8'));
  assert.equal(all.records.length,3);assert.equal(all.summary.judged_model_runs,0);assert.equal(all.summary.model_success_rate,null);
  await page.locator('#records-panel').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'run-records.png'),fullPage:true});
  await page.locator('#records-panel').screenshot({path:path.join(output,'run-records-panel.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#records-panel').scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page horizontal overflow on phone');
  await page.screenshot({path:path.join(output,'run-records-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: real demo record, persistence, details, per-run/all export, scene restore, stop, interrupted run, source filtering and mobile layout.');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
