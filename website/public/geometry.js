export const COLORS = ['red', 'yellow', 'blue'];
export const LABELS = { red: '红色', yellow: '黄色', blue: '蓝色' };
export const CONFIG = { cubeSize: 0.04, centerLimit: 0.145, tableSize: 0.8, tableHeight: 0.8, hz: 20, liftThreshold: 0.04, holdSeconds: 2 };

export function corners(cube) {
  const h = CONFIG.cubeSize / 2, c = Math.cos(cube.yaw), s = Math.sin(cube.yaw);
  return [[-h,-h],[h,-h],[h,h],[-h,h]].map(([x,y]) => [cube.x + x*c - y*s, cube.y + x*s + y*c]);
}

// Sutherland-Hodgman clipping, with CCW polygons. Only positive-area
// intersections block placement; edge contact is permitted.
export function intersection(a, b) {
  let output = a.map(p => [...p]);
  const cross = (a,b,p) => (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
  for (let i=0; i<b.length && output.length; i++) {
    const p=b[i], q=b[(i+1)%b.length], input=output; output=[];
    let prev=input.at(-1), dp=cross(p,q,prev);
    for (const curr of input) {
      const dc=cross(p,q,curr), inside=dc>=-1e-12, prevInside=dp>=-1e-12;
      if (inside !== prevInside) {
        const t=dp/(dp-dc);
        output.push([prev[0]+t*(curr[0]-prev[0]), prev[1]+t*(curr[1]-prev[1])]);
      }
      if (inside) output.push(curr);
      prev=curr; dp=dc;
    }
  }
  return output;
}
export function area(poly) {
  return Math.abs(poly.reduce((s,p,i) => { const q=poly[(i+1)%poly.length]; return s+p[0]*q[1]-q[0]*p[1]; },0))/2;
}
export function conflicts(cube, cubes) {
  return cubes.filter(c=>c.color!==cube.color).map(other=>intersection(corners(cube), corners(other))).filter(poly=>area(poly)>1e-10);
}
export function validCube(cube, cubes) {
  if (![cube.x,cube.y,cube.yaw].every(Number.isFinite)) return '坐标或角度无效';
  if (Math.abs(cube.x)>CONFIG.centerLimit+1e-9 || Math.abs(cube.y)>CONFIG.centerLimit+1e-9) return '方块中心超出可放置区域';
  if (conflicts(cube,cubes).length) return '方块发生重叠，请调整位置';
  return '';
}
export function validateScene(scene) {
  if (!scene || !Array.isArray(scene.cubes) || scene.cubes.length!==3) throw Error('请放置红、黄、蓝三个方块');
  if (!COLORS.includes(scene.target)) throw Error('请选择有效的目标颜色');
  if (new Set(scene.cubes.map(c=>c.color)).size!==3 || scene.cubes.some(c=>!COLORS.includes(c.color))) throw Error('每种颜色必须且只能有一个方块');
  for (const cube of scene.cubes) { const error=validCube(cube,scene.cubes); if (error) throw Error(error); }
  return { version: 1, task: 'ColorLift', target: scene.target, cubes: scene.cubes.map(({color,x,y,yaw})=>({color,x,y,yaw})) };
}
export function toRobosuiteLayout(scene, seed=0) {
  const value=validateScene(scene);
  return { seed, level: 'web_custom', suite: 'web_custom', category: 'manual',
    xy: value.cubes.map(c=>[c.x,c.y]), yaw: value.cubes.map(c=>c.yaw),
    colors_by_slot: value.cubes.map(c=>c.color), rendering_seed: seed,
    geometry_id: `web_${seed}`, scenario_id: `web_${seed}`, color_assignment_index: 0,
    target_color: value.target };
}
