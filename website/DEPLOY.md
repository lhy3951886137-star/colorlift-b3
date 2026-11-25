# 公网部署：GitHub → Render

当前部署的是可交互的演示网站，不包含 robosuite 模型服务。网站运行在云端后，本机可以关机，别人仍可通过网址使用。休眠、配额、价格和可用区域以部署平台当时显示为准。

## 1. 选择网站源码

网站源码位于本仓库的 `website/` 子目录。部署时在 Render 连接 `colorlift-b3` 仓库，并将 Root Directory 设为 `website`。也可以将该目录单独复制到独立网站仓库；此时 Root Directory 留空。

网站目录包含源码、依赖锁文件和文档；不包含 `node_modules`、模型、训练数据或检查截图。若部署平台未读取 `.node-version`，可设置环境变量 `NODE_VERSION=22`。

## 2. 在 Render 创建 Node 网站服务

登录 https://dashboard.render.com ，选择 `New → Web Service`，连接GitHub，并授权上一步的网站仓库。必须选择 **Web Service**，因为实时演示依赖Node服务和SSE；只上传静态页面不能运行完整功能。

填写：

| 设置 | 值 |
|---|---|
| Name | `colorlift-studio`（被占用时加后缀） |
| Language / Runtime | Node |
| Branch | 你上传代码的分支，通常是 `main` |
| Root Directory | `website`（使用本仓库时）；独立网站仓库时留空 |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

添加环境变量：

| 名称 | 值 |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `HOST` | `0.0.0.0` |

不要填写 `PORT`，由平台提供。暂时不设置 `ROBOT_BACKEND_URL`，保持演示模式。

实例方案以平台当前页面为准。如果提供适合测试的Free方案，可以先用Free；是否休眠、需要付款或绑卡，以页面提示为准。无需为了本阶段演示购买GPU。

确认方案后点击 `Deploy Web Service`。日志出现安装成功和 `Listening: 0.0.0.0:...` 后，等待服务变为Live。页面会提供形如 `https://你的服务名.onrender.com` 的真实地址。这里的示例不是已创建的网址。

## 3. 检查公网功能

1. 打开平台给出的HTTPS网址，确认首页能加载。
2. 打开 `https://实际域名/api/health`，应返回 `{"status":"ok","mode":"demo"}`。
3. 清空场景，重新放置、旋转方块，检查重叠禁止标志。
4. 点击运行，确认三维动画和步数持续更新，最后显示演示完成。
5. 用手机关闭Wi-Fi、改用移动网络访问同一地址，确认它是公网服务。

实例重启会清除服务端临时运行记录；浏览器中的场景保存仍在各自浏览器本地。演示版建议保持一个服务实例，目前运行记录放在该实例内存中，不适合直接扩成多个副本。

## 4. 以后接真实模型

云端网站必须能连接到模型后端。Render中的 `127.0.0.1` 指云端容器，不是你的电脑，因此不能直接填写本机 `http://127.0.0.1:8000`。

可选方式：

- GPU服务器运行Python/robosuite服务，网站通过可达的后端地址连接。
- 课堂临时演示时，本机运行模型服务，再通过经过认证的隧道供云端网站连接；本机需一直开机。

模型接入阶段按 `API.md` 实现后端，并增加后端认证、任务排队和相机流验证。当前不上传权重即可把网站先部署出来。

## 常见问题

- `package.json not found`：仓库多了一层目录，修正Root Directory。
- 部署成功但无法访问：检查HOST是否为0.0.0.0，是否使用平台提供的PORT。
- 三维页面空白：确认Build Command安装了three，且浏览器支持WebGL。
- SSE没有状态：看服务日志，确认请求到达同一个实例；后续自建代理时关闭流缓冲。
- 本地网站仍然只能本机访问：这是正常的。部署完成后分享平台给出的HTTPS地址。
