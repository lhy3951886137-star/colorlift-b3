import test from 'node:test';
import assert from 'node:assert/strict';
import { corners, intersection, area, validCube, validateScene, toRobosuiteLayout } from '../public/geometry.js';
const cube=(color,x,y,yaw=0)=>({color,x,y,yaw});
test('rotated intersection detects collision that center-distance misses',()=>{
 const a=cube('red',0,0,Math.PI/4),b=cube('blue',.045,0,Math.PI/4);
 assert(area(intersection(corners(a),corners(b)))>0);
 assert.match(validCube(a,[a,b]),/重叠/);
});
test('contact permitted; separated and rotated squares accepted',()=>{
 const a=cube('red',0,0),b=cube('blue',.04,0);
 assert.equal(validCube(a,[a,b]),'');
 assert.equal(validCube({...b,x:.1,yaw:Math.PI/4},[a]),'');
});
test('finite coordinates, bounds, exactly three unique colors required',()=>{
 const scene={target:'red',cubes:[cube('red',-.1,0),cube('yellow',0,.1),cube('blue',.1,0)]};
 assert.deepEqual(validateScene(scene).cubes,scene.cubes);
 assert.throws(()=>validateScene({...scene,cubes:scene.cubes.slice(0,2)}));
 assert.throws(()=>validateScene({...scene,cubes:[...scene.cubes.slice(0,2),cube('blue',.146,0)]}));
 assert.throws(()=>validateScene({...scene,cubes:[cube('red',NaN,0),...scene.cubes.slice(1)]}));
 assert.throws(()=>validateScene({...scene,cubes:[cube('red',0,0),cube('red',0,.1),cube('blue',.1,0)]}));
});
test('repository layout retains radians, metric coordinates, and physical slot/color mapping',()=>{
 const scene={target:'yellow',cubes:[cube('blue',.1,0,.3),cube('yellow',0,.1),cube('red',-.1,0)]};
 const layout=toRobosuiteLayout(scene,123);
 assert.deepEqual(layout.colors_by_slot,['blue','yellow','red']);
 assert.equal(layout.yaw[0],.3);assert.equal(layout.target_color,'yellow');assert.equal(layout.seed,123);
});
