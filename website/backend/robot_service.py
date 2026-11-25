"""Local B3 inference bridge. Run with the existing Ubuntu project venv.

All MuJoCo/EGL and CUDA work stays on one worker thread. HTTP never touches
simulator state. Uses the released policy and original 4/2/1/4 OSC executor.
"""
import argparse
import base64
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import queue
import re
import signal
import sys
import threading
import time
import traceback
import uuid

COLORS = ("red", "yellow", "blue")


def json_value(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def dump(value):
    return json.dumps(value, ensure_ascii=False, default=json_value, allow_nan=False)


def save(path, value):
    path.write_text(dump(value), encoding="utf-8")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_scene(value, allow_touching=False):
    cubes = value.get("cubes")
    if not isinstance(cubes, list) or len(cubes) != 3:
        raise ValueError("需要红、黄、蓝三个方块")
    if value.get("target") not in COLORS or sorted(c.get("color", "") for c in cubes) != sorted(COLORS):
        raise ValueError("目标颜色或物块颜色无效")
    for c in cubes:
        if any(isinstance(c.get(k), bool) or not isinstance(c.get(k), (int, float)) or not math.isfinite(c[k]) for k in ("x", "y", "yaw")):
            raise ValueError("坐标和角度必须为有限数字")
        if abs(c["x"]) > .145 + 1e-9 or abs(c["y"]) > .145 + 1e-9:
            raise ValueError("方块中心超出 ±145 mm")
    # Separating axes for rotated square footprints. The released B3 policy
    # requires a positive gap; the direction teacher may test edge contact.
    def polygon(c):
        co, si = math.cos(c["yaw"]), math.sin(c["yaw"])
        return [(c["x"] + x*co-y*si, c["y"]+x*si+y*co) for x, y in ((-.02,-.02),(.02,-.02),(.02,.02),(-.02,.02))]
    for i in range(3):
        for j in range(i+1, 3):
            a, b = polygon(cubes[i]), polygon(cubes[j])
            gaps = []
            for poly in (a, b):
                for k in (0, 1):
                    dx, dy = poly[k+1][0]-poly[k][0], poly[k+1][1]-poly[k][1]
                    axis = (-dy/.04, dx/.04)
                    pa = [x*axis[0]+y*axis[1] for x,y in a]
                    pb = [x*axis[0]+y*axis[1] for x,y in b]
                    gaps.append(max(min(pb)-max(pa), min(pa)-max(pb)))
            maximum_gap = max(gaps)
            if allow_touching:
                if maximum_gap < -1e-7:
                    raise ValueError("方块发生重叠")
            elif maximum_gap <= 1e-7:
                raise ValueError("方块重叠或贴边，请留出少量间隙")
    return {"version": 1, "task": "ColorLift", "target": value["target"],
            "cubes": [{k:c[k] for k in ("color","x","y","yaw")} for c in cubes]}


class Run:
    def __init__(self, scene, controller="b3"):
        self.id = uuid.uuid4().hex
        self.scene = scene
        self.controller = controller
        self.source = "expert" if controller == "direction" else "model"
        self.cancel = threading.Event()
        self.condition = threading.Condition()
        self.sequence = 0
        self.frame = None
        self.result = None
        self.state = "queued"
        self.created = time.time()
        self.directory = None
        self.step = 0

    def publish(self, frame):
        with self.condition:
            self.frame = frame
            self.sequence += 1
            self.condition.notify_all()

    def finish(self, result):
        with self.condition:
            self.result = result
            self.state = result["status"]
            self.condition.notify_all()


class Service:
    def __init__(self, args):
        self.args = args
        self.lock = threading.Lock()
        self.tasks = queue.Queue()
        self.runs = {}
        self.active = None
        self.ready = False
        self.error = None
        self.stopping = threading.Event()
        self.identity = {}
        self.bridge_sha256 = sha(Path(__file__))
        self.thread = threading.Thread(target=self.worker, name="b3-cuda-egl", daemon=True)
        self.thread.start()

    def health(self):
        return {"status": "ready" if self.ready else "error" if self.error else "loading", "ready": self.ready,
                "error": self.error, "busy": self.active is not None, "model": "B3 frozen seed44",
                "source": "model", "controllers": ["b3", "direction"], **self.identity}

    @staticmethod
    def normalize_controller(controller):
        if controller not in ("b3", "direction"):
            raise ValueError("运行控制器无效")
        return controller

    def submit(self, scene, controller="b3"):
        controller = self.normalize_controller(controller)
        with self.lock:
            if not self.ready:
                raise RuntimeError(self.error or "模型正在加载，请稍后重试")
            if self.active is not None:
                raise BlockingIOError("GPU 正在执行另一个任务，请等待或停止当前任务")
            # Keep recent results, bounded independently of image frame count.
            old = [r for r in self.runs.values() if r.result is not None]
            for run in sorted(old, key=lambda r:r.created)[:-29]:
                del self.runs[run.id]
            run = Run(scene, controller)
            self.runs[run.id] = run
            self.active = run.id
            self.tasks.put(run)
            return run

    def worker(self):
        env = None
        try:
            args = self.args
            os.environ.update(CUDA_VISIBLE_DEVICES=str(args.gpu), MUJOCO_EGL_DEVICE_ID=str(args.gpu),
                              MUJOCO_GL="egl", PYOPENGL_PLATFORM="egl", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            sys.path.insert(0, str(args.repo))
            import torch
            import numpy as np
            from colorlift.broad_act.model import load_policy
            from colorlift.broad_act.runtime import make_env
            digest = sha(args.checkpoint)
            manifest = json.loads((args.repo / "publication/release_manifest.json").read_text())
            if digest not in {item["sha256"] for item in manifest["models"]}:
                raise RuntimeError("权重 SHA256 不匹配原发布清单，未加载")
            if not torch.cuda.is_available():
                raise RuntimeError("当前 Ubuntu Python 环境无法使用 CUDA")
            torch.set_num_threads(1)
            np.random.seed(2026)
            torch.manual_seed(2026)
            torch.backends.cudnn.benchmark = False
            torch.backends.cudnn.deterministic = True
            torch.backends.cuda.matmul.allow_tf32 = False
            torch.backends.cudnn.allow_tf32 = False
            model, checkpoint = load_policy(args.checkpoint)
            # CUDA and EGL context must be constructed and used on this thread.
            env = make_env(args.gpu)
            self.identity = {"checkpoint_sha256": digest, "gpu": torch.cuda.get_device_name(0),
                             "config": asdict(env.config), "controller": "original EventExecutor efficiency",
                             "query_intervals": [4,2,1,4],"bridge_sha256":self.bridge_sha256,
                             "source_sha256":{name:sha(args.repo/name) for name in
                               ("colorlift/broad_act/runtime.py","colorlift/broad_act/model.py","colorlift/conditional.py",
                                "colorlift/event_control.py","colorlift/env.py","colorlift/broad_v2/validity.py")}}
            self.ready = True
            print("B3 model and robosuite ready", flush=True)
            while not self.stopping.is_set():
                try:
                    run = self.tasks.get(timeout=.5)
                except queue.Empty:
                    continue
                try:
                    self.rollout(run, env, model, checkpoint)
                except Exception as exc:
                    traceback.print_exc()
                    result = {"source":run.source, "status":"error", "success":None, "steps":run.step,
                              "message":f"仿真执行异常：{exc}"}
                    if run.directory:
                        save(run.directory / "execution_error.json", {**result,"traceback":traceback.format_exc()})
                    run.finish(result)
                    # Recreate after errors; never reuse a half-reset simulation.
                    self.ready = False
                    env.close()
                    env = make_env(args.gpu)
                    self.ready = True
                finally:
                    with self.lock:
                        self.active = None
        except Exception as exc:
            self.ready = False
            self.error = str(exc)
            traceback.print_exc()
        finally:
            if env is not None:
                env.close()

    def rollout(self, run, env, model, checkpoint):
        import cv2
        import imageio.v2 as imageio
        import numpy as np
        import torch
        from colorlift.config import CAMERAS
        from colorlift.conditional import configuration
        from colorlift.event_control import EventExecutor, FingerContactSensor, event_config
        from colorlift.event_efficiency import PhysicsRecorder, eligibility
        from colorlift.broad_v2.layouts import footprint_gap
        from colorlift.primitives import MotionDiagnostics, policy_state
        from colorlift.step_recording import save_rows
        from colorlift.vision import observation_images
        from direction_expert import DirectionExecutor

        scene = run.scene
        seed = int(run.id[:8], 16) % 2000000000
        geometry = hashlib.sha256(dump(scene["cubes"]).encode()).hexdigest()
        layout = {"seed":seed,"level":"web_custom","suite":"web_custom","category":"manual",
                  "xy":[[c["x"],c["y"]] for c in scene["cubes"]],"yaw":[c["yaw"] for c in scene["cubes"]],
                  "colors_by_slot":[c["color"] for c in scene["cubes"]],"rendering_seed":seed,
                  "geometry_id":geometry,"scenario_id":run.id,"color_assignment_index":0}
        directory = self.args.output / run.id
        directory.mkdir(parents=True, exist_ok=False)
        run.directory = directory
        save(directory / "request.json", {"scene":scene,"layout":layout,"controller":run.controller,"model":self.identity,
                                          "bridge_sha256":self.bridge_sha256,"created_at":datetime.now(timezone.utc).isoformat()})
        run.state = "resetting"
        if run.cancel.is_set():
            result={"source":run.source,"status":"cancelled","success":None,"steps":0,"message":"已停止，未执行策略"}
            save(directory / "result.json",result);run.finish(result);return
        color = scene["target"]
        original_overlap_check = env.assert_no_overlap
        if run.controller == "direction":
            def allow_edge_contact():
                body_ids = env._physical_ids["body"]
                points = np.array([env.sim.data.body_xpos[body_id, :2] for body_id in body_ids])
                yaw = [
                    2 * np.arctan2(env.sim.data.body_xquat[body_id, 3], env.sim.data.body_xquat[body_id, 0])
                    for body_id in body_ids
                ]
                if footprint_gap(points, yaw) < -1e-7:
                    raise AssertionError("Overlapping rotated cube footprints")
            env.assert_no_overlap = allow_edge_contact
        try:
            obs = env.reset_layout(layout, color)
        finally:
            env.assert_no_overlap = original_overlap_check
        meta = env.episode_metadata()
        save(directory / "initial_state.json",meta)
        # Original settling, no object teleport or policy-based scene filtering.
        if env.settlement["max_drift_m"] > .0015 or env.settlement["max_height_error_m"] > .0015 or env.settlement["max_tilt_rad"] > .04:
            raise ValueError("初始场景静置后不稳定，请调整物块间距")
        expert = configuration()[1]
        executor = DirectionExecutor(env.config, expert, env) if run.controller == "direction" else EventExecutor(env.config, expert, event_config("efficiency"))
        sensor = FingerContactSensor(env)
        diagnostic = MotionDiagnostics(env.config)
        prediction, last_query, queries, info = None, -1000, 0, {}
        run.state = "running"
        video = imageio.get_writer(str(directory / "front.mp4"),fps=env.config.hz/2,codec="libx264",quality=7)
        last_image = None
        frame_log = (directory / "frames.jsonl").open("w",encoding="utf-8")
        started = time.monotonic()

        def publish_frame(step, phase, terminal=False):
            nonlocal last_image
            bodies=[]
            for c in scene["cubes"]:
                bid=env.color_body_ids[c["color"]]
                p=env.sim.data.body_xpos[bid]
                q=env.sim.data.body_xquat[bid]
                yaw=math.atan2(2*(q[0]*q[3]+q[1]*q[2]),1-2*(q[2]*q[2]+q[3]*q[3]))
                bodies.append({"color":c["color"],"x":float(p[0]),"y":float(p[1]),"z":float(p[2]),"yaw":yaw})
            position=obs["robot0_eef_pos"]
            lift=float(env.sim.data.body_xpos[env.color_body_ids[color],2]-env.initial_heights[color])
            frame={"source":run.source,"controller":run.controller,"run_id":run.id,"step":step,"hz":env.config.hz,"phase":phase,
                   "progress":1. if info.get("success") else step/env.config.horizon,
                   "eef":dict(zip(("x","y","z"),map(float,position))),"gripper":float(np.abs(obs["robot0_gripper_qpos"]).sum()),
                   "lift_m":lift,"hold_seconds":info.get("hold_streak",0)/env.config.hz,"cubes":bodies,
                   "score":bool(info.get("success",False)),"camera":"color_front","image_source":"robosuite_camera"}
            # Higher resolution for humans; model still sees its original 128px
            # two-camera inputs. Reading this camera never enters policy inputs.
            if step%2==0 or terminal or last_image is None:
                rgb=env.sim.render(width=640,height=480,camera_name=CAMERAS[0])[::-1].copy()
                video.append_data(rgb)
                ok,jpeg=cv2.imencode('.jpg',cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR),[cv2.IMWRITE_JPEG_QUALITY,80])
                if not ok:raise RuntimeError("相机图像编码失败")
                last_image="data:image/jpeg;base64,"+base64.b64encode(jpeg).decode("ascii")
                if step==0:cv2.imwrite(str(directory / "initial_front.png"),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR))
            frame_log.write(dump(frame)+"\n")
            frame["image"]=last_image
            run.publish(frame)

        try:
            publish_frame(0,"approach")
            with PhysicsRecorder(env,sensor) as recorder:
                for tick in range(env.config.horizon):
                    if run.cancel.is_set() or self.stopping.is_set():break
                    phase_before=executor.phase
                    interval=(4,2,1,4)[executor.phase]
                    if run.controller == "direction":
                        xyz=env.sim.data.body_xpos[env.color_body_ids[color]].copy()
                        requested=executor.phase
                        new_query=False
                    else:
                        new_query=prediction is None or tick-last_query>=interval
                        if new_query:
                            states=(policy_state(obs,executor.phase)[:16]-checkpoint["stats"]["state_mean"])/checkpoint["stats"]["state_std"]
                            rgb=observation_images(obs)
                            with torch.inference_mode():
                                output,_,_=model(torch.as_tensor(states[None],device="cuda"),torch.as_tensor(rgb.transpose(0,3,1,2)[None].copy(),device="cuda").float()/255,
                                                 torch.tensor([COLORS.index(color)],device="cuda"))
                            prediction=output[0][0].cpu().numpy()
                            prediction[:,:3]=prediction[:,:3]*checkpoint["stats"]["xyz_std"]+checkpoint["stats"]["xyz_mean"]
                            last_query=tick
                            queries+=1
                        xyz=prediction[tick-last_query,:3]
                        requested=int(prediction[tick-last_query,3:].argmax())
                    action,control=executor.action(obs,requested,xyz,sensor.read(obs))
                    before=obs
                    obs,_,done,info=env.step(action)
                    diagnostic.update(env,before,obs,control,info)
                    diagnostic.rows[-1].update(transition_event=control["transition_event"],new_policy_query=new_query,execution_length=interval,hold_drift_m=info["hold_drift_m"])
                    executor.after_step(obs,control)
                    if executor.phase!=phase_before:prediction=None
                    empty=executor.phase>=2 and executor.phase_steps>=12 and np.abs(obs["robot0_gripper_qpos"]).sum()<.006
                    run.step=tick+1
                    phase=("approach","align","close","lift")[executor.phase]
                    if info["hold_streak"]>0:phase="hold"
                    publish_frame(run.step,phase,terminal=done or empty)
                    if done or empty:break
                    # Limit to at most real-time. Slow GPUs simply stream slower.
                    run.cancel.wait(max(0,(tick+1)/env.config.hz-(time.monotonic()-started)))
                rows=recorder.enrich(diagnostic.rows,seed=seed)
            save_rows(directory / "steps.csv",rows)
            cancelled=(run.cancel.is_set() or self.stopping.is_set()) and not info.get("success")
            success=bool(info.get("success")) if not cancelled else None
            reason="cancelled" if cancelled else "success" if success else "wrong_color" if info.get("wrong_color_grasp") else "timeout" if run.step>=env.config.horizon else "empty_grasp"
            messages={"success":"目标抓取成功，并稳定保持2秒","wrong_color":"抓取了非目标颜色","timeout":"达到220步上限，未满足成功判据","empty_grasp":"夹爪空抓，已提前结束","cancelled":"模型运行已停止"}
            result={**meta,**info,**diagnostic.summary(),"source":run.source,"controller":run.controller,"run_id":run.id,
                    "status":"cancelled" if cancelled else "completed" if success else "failed", "success":success,
                    "steps":run.step,"control_steps":run.step,"termination":reason,"message":messages[reason],
                    "completion_steps":run.step if success else None,"completion_seconds":run.step/env.config.hz if success else None,
                    "hz":env.config.hz,"policy_queries":queries,"checkpoint_sha256":self.identity["checkpoint_sha256"],
                    "settlement":env.settlement,"wall_seconds":time.monotonic()-started,
                    "artifacts":{"video":f"/api/runs/{run.id}/video","result":f"/api/runs/{run.id}/result"}}
            reasons=eligibility(result,rows,env.color_body_ids[color]) if rows else ["cancelled_before_first_step"]
            result.update(eligible=not reasons,rejection_reasons=reasons)
            save(directory / "result.json",result)
        finally:
            if run.controller == "direction":
                executor.restore()
            video.close()
            frame_log.close()
        run.finish(result)


class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"

    def log_message(self, *args):
        pass

    def respond(self, code, value):
        raw=dump(value).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        service=self.server.service
        if self.path=="/health":return self.respond(200,service.health())
        match=re.fullmatch(r"/runs/([a-f0-9]{32})/(events|result|video)",self.path)
        if not match:return self.respond(404,{"error":"接口不存在"})
        run=service.runs.get(match[1])
        if not run:return self.respond(404,{"error":"运行不存在或已过期"})
        action=match[2]
        if action=="result":
            return self.respond(200,run.result) if run.result else self.respond(409,{"error":"运行尚未结束"})
        if action=="video":
            if not run.result or not run.directory or not (run.directory/"front.mp4").exists():return self.respond(409,{"error":"视频尚未生成"})
            file=run.directory/"front.mp4"
            size=file.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type","video/mp4")
            self.send_header("Content-Length",str(size))
            self.end_headers()
            with file.open("rb") as stream:
                for block in iter(lambda:stream.read(65536),b""):
                    self.wfile.write(block)
            return
        self.send_response(200)
        self.send_header("Content-Type","text/event-stream; charset=utf-8")
        self.send_header("Cache-Control","no-cache")
        self.send_header("Connection","close")
        self.send_header("X-Accel-Buffering","no")
        self.end_headers()
        seen=-1
        try:
            while True:
                with run.condition:
                    if seen==run.sequence and run.result is None:run.condition.wait(timeout=5)
                    frame=run.frame if seen!=run.sequence else None
                    seen=run.sequence
                    result=run.result
                if frame:self.wfile.write(f"event: frame\ndata: {dump(frame)}\n\n".encode())
                if result:self.wfile.write(f"event: done\ndata: {dump(result)}\n\n".encode())
                if not frame and not result:self.wfile.write(b": waiting for simulation\n\n")
                self.wfile.flush()
                if result:break
        except (BrokenPipeError,ConnectionResetError):
            pass
        finally:
            self.close_connection=True

    def do_POST(self):
        service=self.server.service
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not 0<=length<=65536:return self.respond(413,{"error":"请求过大"})
            value=json.loads(self.rfile.read(length) or b"{}")
            if self.path=="/shutdown":
                if not service.args.shutdown_token or self.headers.get("X-Local-Control")!=service.args.shutdown_token:
                    return self.respond(403,{"error":"禁止调用"})
                self.respond(202,{"status":"stopping"})
                service.stopping.set()
                for run in list(service.runs.values()):run.cancel.set()
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if self.path=="/runs":
                controller=service.normalize_controller(value.get("controller","b3"))
                scene=validate_scene(value,allow_touching=controller=="direction")
                run=service.submit(scene,controller)
                return self.respond(201,{"id":run.id,"source":run.source,"controller":run.controller,"model":service.identity})
            match=re.fullmatch(r"/runs/([a-f0-9]{32})/cancel",self.path)
            if match:
                run=service.runs.get(match[1])
                if not run:return self.respond(404,{"error":"运行不存在"})
                run.cancel.set()
                return self.respond(200,{"status":run.state if run.result else "cancelling"})
            return self.respond(404,{"error":"接口不存在"})
        except BlockingIOError as exc:return self.respond(409,{"error":str(exc)})
        except RuntimeError as exc:return self.respond(503,{"error":str(exc)})
        except Exception as exc:return self.respond(400,{"error":str(exc)})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo",type=Path,default=Path("/home/banus/colorlift-b3"))
    parser.add_argument("--checkpoint",type=Path)
    parser.add_argument("--gpu",type=int,default=0)
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--port",type=int,default=8000)
    parser.add_argument("--shutdown-token",default="",help=argparse.SUPPRESS)
    parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parents[2]/"results"/"web_model_runs")
    args=parser.parse_args()
    args.repo=args.repo.resolve()
    args.checkpoint=(args.checkpoint or args.repo/"models/main_frozen_reference_seed44/policy.pt").resolve()
    args.output.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads=True
    service=Service(args)
    server.service=service
    def stop(*_):
        service.stopping.set()
        for run in list(service.runs.values()):run.cancel.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGINT,stop)
    signal.signal(signal.SIGTERM,stop)
    print(f"Robot backend listening on {args.host}:{args.port}",flush=True)
    try:server.serve_forever(poll_interval=.2)
    finally:
        service.stopping.set()
        server.server_close()
        service.thread.join(timeout=30)


if __name__=="__main__":main()
