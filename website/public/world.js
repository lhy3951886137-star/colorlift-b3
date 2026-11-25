import * as THREE from '/vendor/three.module.js';

// A lightweight, articulated preview, with the same metric coordinates as the
// editor. It is not a MuJoCo simulation. Live robosuite camera frames can replace
// this canvas when a policy backend is connected.
export function createWorld(container) {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#eff2eb');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
  container.appendChild(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(36,1,.01,20);
  const target=new THREE.Vector3(-.08,.88,0);
  let orbit={yaw:-.7,pitch:1.02,radius:1.72},active=true,pointer=null;
  function positionCamera(){camera.position.set(target.x+Math.sin(orbit.yaw)*Math.sin(orbit.pitch)*orbit.radius,target.y+Math.cos(orbit.pitch)*orbit.radius,target.z+Math.cos(orbit.yaw)*Math.sin(orbit.pitch)*orbit.radius);camera.lookAt(target);}
  positionCamera();
  scene.add(new THREE.HemisphereLight(0xffffff,0x8e9c7f,2.3));
  const key=new THREE.DirectionalLight(0xfffcf1,4);key.position.set(-1,3,1.3);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-1.3;key.shadow.camera.right=1.3;key.shadow.camera.top=1.7;key.shadow.camera.bottom=-1;
  key.shadow.camera.near=.1;key.shadow.camera.far=6;key.shadow.bias=-.00015;key.shadow.normalBias=.001;key.shadow.radius=4;scene.add(key);
  const fill=new THREE.DirectionalLight(0xf1f7ff,1.7);fill.position.set(2,1.8,-2);scene.add(fill);
  const material=(color,roughness=.55,metalness=.05)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const ivory=material('#eeeFE9',.3,.15),white=material('#f9faf6',.35,.06),dark=material('#333b38',.45,.3),metal=material('#a6afa9',.32,.65);
  function box(w,h,d,mat,x,y,z,parent=scene){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function sphere(radius,mat,parent=scene){const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,24,16),mat);mesh.castShadow=true;parent.add(mesh);return mesh;}
  function cylinder(radiusTop,radiusBottom,height,mat,parent=scene){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radiusTop,radiusBottom,height,32),mat);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  const floor=box(200,.025,200,material('#e8ede1',.9,0),0,-.025,0);floor.receiveShadow=true;
  const slab=box(.8,.035,.8,material('#eceee5',.7,.05),0,.7825,0);
  box(.81,.008,.81,metal,0,.762,0);
  box(.77,.005,.77,material('#fafbf4',.9,0),0,.8025,0);
  for(const x of [-.32,.32])for(const z of [-.32,.32])box(.035,.72,.035,dark,x,.39,z);
  for(const x of [-.32,.32])box(.035,.03,.66,dark,x,.14,0);
  box(.66,.03,.035,dark,0,.14,-.32);
  const grid=new THREE.GridHelper(.74,20,0xcdd5c3,0xe0e5d8);grid.position.y=.806;grid.material.transparent=true;grid.material.opacity=.55;scene.add(grid);
  const workspacePoints=[[-.145,-.145],[-.145,.145],[.145,.145],[.145,-.145],[-.145,-.145]].map(([x,y])=>new THREE.Vector3(x,.807,-y));
  const outline=new THREE.Line(new THREE.BufferGeometry().setFromPoints(workspacePoints),new THREE.LineDashedMaterial({color:0x9eaf8c,dashSize:.009,gapSize:.007,transparent:true,opacity:.8}));outline.computeLineDistances();scene.add(outline);
  // Panda-inspired articulated shells. This procedural preview deliberately
  // avoids claiming that the robot mesh is the robosuite asset.
  const robot=new THREE.Group();scene.add(robot);
  const mount=cylinder(.08,.09,.018,metal,robot);mount.position.set(-.46,.81,0);
  const base=cylinder(.057,.065,.12,ivory,robot);base.position.set(-.46,.88,0);
  const baseRing=cylinder(.06,.06,.014,dark,robot);baseRing.position.set(-.46,.836,0);
  const shoulderBase=cylinder(.05,.055,.08,white,robot);shoulderBase.position.set(-.46,.97,0);
  const linkA=cylinder(.037,.047,1,white,robot),linkB=cylinder(.033,.039,1,ivory,robot);
  const linkAShadow=cylinder(.043,.043,1,dark,robot),linkBShadow=cylinder(.038,.038,1,dark,robot);
  const joints=[sphere(.052,dark,robot),sphere(.047,dark,robot),sphere(.039,dark,robot)];
  const jointCaps=[sphere(.039,white,robot),sphere(.035,white,robot),sphere(.03,ivory,robot)];
  const wrist=cylinder(.029,.035,1,white,robot);
  const gripper=new THREE.Group();robot.add(gripper);
  const hand=cylinder(.031,.034,.055,ivory,gripper);hand.position.y=.062;
  const handRing=cylinder(.032,.032,.013,dark,gripper);handRing.position.y=.088;
  box(.069,.018,.038,dark,0,.027,0,gripper);
  const fingers=[box(.01,.04,.022,metal,-.045,.001,0,gripper),box(.01,.04,.022,metal,.045,.001,0,gripper)];
  const tips=[box(.012,.018,.024,dark,-.045,-.016,0,gripper),box(.012,.018,.024,dark,.045,-.016,0,gripper)];
  const toolDot=sphere(.004,material('#e77543'),gripper);toolDot.position.set(0,.042,.033);
  function segment(mesh,a,b){const d=new THREE.Vector3().subVectors(b,a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.y=d.length();mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());}
  let currentEEF=new THREE.Vector3(-.25,1.12,0),desiredEEF=currentEEF.clone(),currentGap=.08,desiredGap=.08;
  function poseRobot(){
    const shoulder=new THREE.Vector3(-.46,1.015,0),end=currentEEF.clone().add(new THREE.Vector3(0,.125,0));
    const delta=end.clone().sub(shoulder),length=Math.min(delta.length(),.675),dir=delta.clone().normalize();
    const bias=new THREE.Vector3(0,1,.28);bias.addScaledVector(dir,-bias.dot(dir)).normalize();
    const elbow=shoulder.clone().addScaledVector(dir,length*.5).addScaledVector(bias,Math.sqrt(Math.max(.005,.34*.34-length*length/4)));
    segment(linkA,shoulder,elbow);segment(linkB,elbow,end);
    segment(linkAShadow,shoulder.clone().lerp(elbow,.08),shoulder.clone().lerp(elbow,.24));
    segment(linkBShadow,elbow.clone().lerp(end,.05),elbow.clone().lerp(end,.2));
    [shoulder,elbow,end].forEach((p,i)=>{joints[i].position.copy(p);jointCaps[i].position.copy(p).add(new THREE.Vector3(0,0,.025));});
    segment(wrist,end,currentEEF.clone().add(new THREE.Vector3(0,.08,0)));
    gripper.position.copy(currentEEF);fingers[0].position.x=tips[0].position.x=-currentGap/2-.005;fingers[1].position.x=tips[1].position.x=currentGap/2+.005;
  }
  const cubeMeshes=new Map(),cubeMaterials={red:material('#df4439',.5,0),yellow:material('#eec134',.5,0),blue:material('#3274ce',.5,0)};
  const cubeEdges=new THREE.EdgesGeometry(new THREE.BoxGeometry(.04,.04,.04));
  const targetRing=new THREE.Mesh(new THREE.RingGeometry(.031,.0335,64),new THREE.MeshBasicMaterial({color:0x81976b,side:THREE.DoubleSide,transparent:true,opacity:.7}));targetRing.rotation.x=-Math.PI/2;targetRing.position.y=.809;scene.add(targetRing);
  function syncCubes(cubes){
    for(const [color,mesh]of cubeMeshes)if(!cubes.some(c=>c.color===color)){scene.remove(mesh);mesh.geometry.dispose();cubeMeshes.delete(color);}
    for(const cube of cubes){
      let mesh=cubeMeshes.get(cube.color);
      if(!mesh){mesh=box(.04,.04,.04,cubeMaterials[cube.color],cube.x,.825,-cube.y);const edge=new THREE.LineSegments(cubeEdges,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.17}));mesh.add(edge);cubeMeshes.set(cube.color,mesh);}
      mesh.position.set(cube.x,cube.z??.825,-cube.y);mesh.rotation.y=cube.yaw;
    }
  }
  let chosen='red';
  function setScene(cubes,targetColor){chosen=targetColor;syncCubes(cubes);const cube=cubes.find(c=>c.color===targetColor);targetRing.visible=Boolean(cube);if(cube)targetRing.position.set(cube.x,.809,-cube.y);desiredEEF.set(-.25,1.12,0);currentEEF.copy(desiredEEF);currentGap=desiredGap=.08;poseRobot();}
  function applyFrame(frame){if(frame.eef)desiredEEF.set(frame.eef.x,frame.eef.z,-frame.eef.y);if(Number.isFinite(frame.gripper))desiredGap=frame.gripper;if(frame.cubes)syncCubes(frame.cubes);}
  function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  container.addEventListener('pointerdown',event=>{pointer={x:event.clientX,y:event.clientY,button:event.button,id:event.pointerId};container.setPointerCapture(event.pointerId);});
  container.addEventListener('pointermove',event=>{
    if(!pointer)return;const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    if(pointer.button===2){const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);target.addScaledVector(right,-dx*.001);target.y+=dy*.001;}
    else{orbit.yaw-=dx*.007;orbit.pitch=Math.max(.12,Math.min(1.52,orbit.pitch-dy*.006));}
    pointer.x=event.clientX;pointer.y=event.clientY;positionCamera();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(event,()=>pointer=null);
  container.addEventListener('contextmenu',event=>event.preventDefault());
  container.addEventListener('wheel',event=>{event.preventDefault();orbit.radius=Math.max(.75,Math.min(3.2,orbit.radius*Math.exp(event.deltaY*.001)));positionCamera();},{passive:false});
  let last=0;
  function animate(time){requestAnimationFrame(animate);if(!active)return;const dt=Math.min(.1,(time-last)/1000);last=time;currentEEF.lerp(desiredEEF,1-Math.exp(-25*dt));currentGap=THREE.MathUtils.lerp(currentGap,desiredGap,1-Math.exp(-25*dt));poseRobot();renderer.render(scene,camera);}
  requestAnimationFrame(animate);
  function setCamera(name){target.set(-.08,.88,0);orbit=name==='top'?{yaw:0,pitch:.08,radius:1.8}:name==='front'?{yaw:0,pitch:1.25,radius:1.8}:{yaw:-.7,pitch:1.02,radius:1.72};positionCamera();}
  return{setScene,applyFrame,resize,setCamera,setActive(value){active=value;last=performance.now();},renderer,scene};
}
