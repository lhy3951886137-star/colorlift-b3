# ColorLift 模型后端约定

本机实现：`backend/robot_service.py`；一键启动：`启动模型网站.cmd`（网页4180、后端8000）。仅使用已有Ubuntu项目依赖，无需额外FastAPI安装。`GET /health` 返回真实ready/busy、模型hash和配置；网关 `/api/config.modelStatus` 提供连接状态。

在线文件接口：`GET /runs/{id}/video` 和 `GET /runs/{id}/result`，网关对应 `/api/runs/{id}/video|result`。视频只在结束后可用。取消请求先返回 `cancelling`，待策略循环检查取消标志后通过SSE发送最终cancelled；不要仅凭HTTP取消确认就声称GPU已停止。

默认最多一个GPU任务，忙时HTTP409；未就绪HTTP503。后端重算布局并验证坐标/旋转轮廓：原B3要求正间隙，direction教师允许边缘接触但拒绝实际重叠。原始成功判据不变；不使用图像显示、simulator真值物块位置替代B3策略输入。

前端→本站 Node 网关→Python robosuite 服务。模型权重留在后端，不在浏览器中加载。

默认 `ROBOT_BACKEND_URL` 为空，Node 运行标为 DEMO 的程序轨迹。配置该环境变量后，以下请求透传到真实后端。仅配置地址不证明模型已加载，实际错误会在启动或流连接时显示。

## POST /runs

网站公开路径是 `/api/runs`，后端接收路径是 `/runs`。请求 JSON：

```json
{
  "version": 1,
  "task": "ColorLift",
  "target": "red",
  "controller": "b3",
  "cubes": [
    {"color":"red","x":-0.08,"y":0.055,"yaw":0.18},
    {"color":"yellow","x":0.075,"y":0.065,"yaw":-0.12},
    {"color":"blue","x":0.025,"y":-0.075,"yaw":0.28}
  ],
  "layout": {
    "seed": 123,
    "level": "web_custom",
    "suite": "web_custom",
    "category": "manual",
    "xy": [[-0.08,0.055],[0.075,0.065],[0.025,-0.075]],
    "yaw": [0.18,-0.12,0.28],
    "colors_by_slot": ["red","yellow","blue"],
    "color_assignment_index": 0,
    "rendering_seed": 123,
    "geometry_id": "web_123",
    "scenario_id": "web_123",
    "target_color": "red"
  }
}
```

The optional controller field accepts b3 or direction and defaults to b3. The direction teacher uses simulator object positions to choose a wrist yaw, turns at high clearance, then grasps. Its result source is expert, is judged by the same native collision/contact rules, and is excluded from B3 success statistics. This privileged diagnostic controller is not a learned policy or a training trajectory.

`x/y`是世界坐标，米；yaw绕竖直轴，弧度。方块4cm，质量/摩擦等由原环境配置。默认相同颜色唯一，共3个物体；颜色顺序与物理slot一一对应，不能把数组顺序当作固定颜色身份。`layout` 是方便复用现有 `reset_layout` 的描述，seed由网关生成；生产环境建议后端计算规范化几何hash并留存运行日志。

后端应确认工作空间、机器人可达性和初始碰撞状态，不能静默改动布局后再报告成功。成功条件和超时沿用原仿真配置。

响应HTTP201：

```json
{"id":"run_123","source":"model"}
```

id仅允许字母、数字、下划线、连字符。错误用非2xx和 `{"error":"说明"}`。

## GET /runs/{id}/events

对应公开路径 `/api/runs/{id}/events`。`Content-Type: text/event-stream`，每个事件即时flush。可约20 Hz发送状态，相机图像可降低频率/分辨率。无需与策略查询频率相同。

```text
event: frame
data: {"source":"model","step":42,"hz":20,"phase":"align","progress":0.3,"eef":{"x":-0.08,"y":0.055,"z":0.92},"gripper":0.08,"lift_m":0,"hold_seconds":0,"cubes":[{"color":"red","x":-0.08,"y":0.055,"z":0.82,"yaw":0.18},{"color":"yellow","x":0.075,"y":0.065,"z":0.82,"yaw":-0.12},{"color":"blue","x":0.025,"y":-0.075,"z":0.82,"yaw":0.28}],"image":"data:image/jpeg;base64,..."}

event: done
data: {"source":"model","status":"completed","success":true,"steps":77,"message":"抓取成功"}

```

- `phase`：`approach / align / close / lift / hold`。
- `image`可选，推荐真实robosuite相机JPEG data URL，前端直接显示；后续不带image的帧保留上次相机画面。不要将程序预览冒充真实画面。
- `eef/cubes`：真实世界坐标米。cube `z`是中心高度，gripper是夹爪开口宽度（米）。缺省image时使用这些状态驱动简化三维预览。当前程序机器人网格不表示精确关节状态。
- `progress`：0..1；失败时不要伪报100%，终止事件可使用 `status:"failed"`。
- `hold_seconds`是后端按原成功条件计算的连续有效保持时间，不是前端墙钟时间。
- `success`必须由真实环境判定；只有明确true才显示抓取成功。demo返回null，不代表成功实验。
- 发生错误也应发送done，例如 `{"source":"model","status":"failed","success":false,"message":"超时"}`，然后关闭流。
- 停止成功后发 `status:"cancelled",success:null`。SSE需允许已完成任务重连后读到最终done事件，不能无限重放策略。

## POST /runs/{id}/cancel

对应公开路径 `/api/runs/{id}/cancel`。请求为空JSON，后端停止控制循环、释放环境资源、广播终止事件。响应 `{"status":"cancelled"}`。建议幂等。

## 原仓库对接位置

可复用现有 `BroadColorLift.reset_layout(layout,target)`、checkpoint加载和 EventExecutor，但 `runtime.episode` 原实现只在结束时写视频，直接调用它不能实现网页实时画面。需要在推理循环每次 `env.step` 后推送状态/图像、检查取消标志，并在finally关闭环境。

保留原策略的输入归一化、目标颜色embedding、4/2/1/4查询节奏和原生成功判据。不要直接把ACT预测的宏目标当原始OSC动作；原运行器还会经过阶段执行器转换。
