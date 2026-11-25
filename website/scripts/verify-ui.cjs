// Optional browser QA helper. Install Playwright separately or set
// PLAYWRIGHT_MODULE to its module directory. Requires the website server running.
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const output=path.resolve(__dirname,'../test-results');
async function main(){
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.EDGE_EXE?{executablePath:process.env.EDGE_EXE}:{channel:'msedge'})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#engine-status').filter({hasText:'演示引擎就绪'}).waitFor();
  await page.screenshot({path:path.join(output,'desktop-2d.png'),fullPage:true});
  const point=async(x,y)=>page.locator('#editor-svg').evaluate((svg,{x,y})=>{const p=svg.createSVGPoint();p.x=450+x*1600;p.y=330-y*1600;const q=p.matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},{x,y});
  const clickAt=async(x,y)=>{const p=await point(x,y);await page.mouse.move(p.x,p.y);await page.mouse.click(p.x,p.y);};
  await page.click('#clear-scene');assert.equal(await page.locator('#placed-count').innerText(),'0 / 3');
  await page.click('[data-color=red]');await clickAt(-.07,0);assert.equal(await page.locator('#placed-count').innerText(),'1 / 3');
  await page.click('[data-color=yellow]');const overlap=await point(-.06,0);await page.mouse.move(overlap.x,overlap.y);
  await page.screenshot({path:path.join(output,'collision.png'),fullPage:true});
  assert(await page.locator('#collision-layer polygon').count()>0,'Overlap should be highlighted');
  await page.mouse.click(overlap.x,overlap.y);assert.equal(await page.locator('#placed-count').innerText(),'1 / 3','Invalid placement must be rejected');
  await clickAt(.07,.06);await page.click('[data-color=blue]');await clickAt(.06,-.07);assert.equal(await page.locator('#placed-count').innerText(),'3 / 3');
  // Rotate using the actual gray handle.
  const original=Number(await page.locator('#input-yaw').inputValue());
  const start=await point(.06,-.07+.055),finish=await point(.06+.055,-.07);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(finish.x,finish.y,{steps:12});await page.mouse.up();
  assert(Math.abs(Number(await page.locator('#input-yaw').inputValue())-original)>40,'Arc rotation should change yaw');
  // Invalid drag reverts instead of leaving intersecting objects.
  const a=await point(.06,-.07),b=await point(-.07,0);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  assert.equal(await page.locator('#input-x').inputValue(),'60');
  await page.click('[data-target=yellow]');assert.equal(await page.locator('[data-target=yellow]').getAttribute('aria-pressed'),'true');
  await page.click('#tab-3d');await page.locator('#three-container canvas').waitFor();
  await page.waitForTimeout(3500);
  await page.screenshot({path:path.join(output,'desktop-3d.png'),fullPage:true});
  assert.equal(await page.locator('#webgl-error').isVisible(),false);
  await page.click('#run-button');await page.waitForFunction(()=>document.querySelector('#run-status').textContent.includes('演示完成'),null,{timeout:25000});
  assert.equal(await page.locator('#metric-steps').innerText(),'216 steps');
  assert.match(await page.locator('#run-status').innerText(),/尚未连接训练模型/);
  await page.screenshot({path:path.join(output,'demo-completed.png'),fullPage:true});
  // Stop requests should terminate the state stream and restore editing.
  await page.click('#run-button');await page.waitForFunction(()=>Number(document.querySelector('#metric-steps').textContent.replace(/\D/g,''))>4);
  await page.click('#stop-button');await page.waitForFunction(()=>!document.querySelector('#run-button').classList.contains('hidden'));
  await page.click('#tab-2d');await page.click('#load-example');
  await page.waitForTimeout(3500);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No mobile horizontal overflow');
  assert.deepEqual(errors,[],'No browser JavaScript errors');
  console.log('PASS: placement, collision rejection/highlight, rotation, invalid-drag rollback, target, WebGL, SSE demo completion, stop, and mobile layout.');
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
