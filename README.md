# ColorLift B3：Goal-Relative ACT

MuJoCo + robosuite 的三色方块抓取项目，包含冻结的 B3a 模型、四阶段 OSC 执行器、训练/验证示范、全部训练状态与研究评测记录。

- **主模型**：原已冻结的 B3 seed44，`λ_rel = 0.1`，未重新训练或按最终测试挑选种子。
- **模型输入**：两路 RGB、本体状态、目标颜色的 32 维可学习嵌入。真实目标坐标仅供训练监督和评测记录。
- **执行**：接近 → 对准 → 夹紧 → 抬升/保持；预测容量 4，原执行长度为 `4/2/1/4`。
- **任务成功**：正确目标抬升超过 0.04 m，并稳定保持 2 s；接触合格、抓错颜色与执行步数另行统计。

[下载全部发布文件](https://github.com/lhy3951886137-star/colorlift-b3/releases/tag/b3-frozen-20261104) · [主模型权重](https://github.com/lhy3951886137-star/colorlift-b3/releases/download/b3-frozen-20261104/B3_main_frozen_reference_seed44.pt) · [确认性实验报告](research/reports/reproduction/REPORT.zh-CN.md)

## 安装和运行

原运行环境为 Linux、Python 3.11、PyTorch 2.6.0 / torchvision 0.21.0、MuJoCo 3.3.7、robosuite 1.5.2，以及 NVIDIA CUDA/EGL。原始环境导出位于 [`environment_records`](environment_records)，离线 wheelhouse 保留在完整源码归档中。

```bash
git clone https://github.com/lhy3951886137-star/colorlift-b3.git
cd colorlift-b3
conda create -n colorlift-b3 python=3.11 -y
conda activate colorlift-b3
python -m pip install -r requirements.txt -r requirements-act.txt
python -m pip install scipy==1.17.1
python -m pip install -e .
python scripts/download_artifacts.py --profile main
python scripts/run_b3.py --gpu 1 --color red
```

`run_b3.py` 复用未改动的冻结模型与原 OSC 执行器，在已归档的开发布局上运行一次，输出 `steps.csv`、`metadata.json` 和单前视视频。可将目标改为 `yellow` / `blue`，或用 `--layout` 指定同格式布局。默认使用一张物理 GPU，只允许 GPU 1 或 2；不会自动训练。

原机器专用的 `activate.sh` 和历史实验命令保留供追溯；换机器时使用自己的 Conda 环境和路径。源码包中的 `requirements-*.freeze.txt` 包含原服务器路径，属于历史环境记录。

## Interactive website

The ColorLift Studio web workbench lives in [`website/`](website/). It provides a local scene editor, a demo mode, and an optional bridge to the robosuite model service. See [`website/README.md`](website/README.md) for setup. The web app is not part of B3 training and does not change the frozen model or its evaluation results.

## 权重和完整数据

权重与大数据通过 GitHub Release 提供；Git 仓库保存源码、配置、报告和校验清单。

```bash
# 下载八份独立 B3 policy，按原目录保存并核对 SHA256
python scripts/download_artifacts.py --profile models

# 下载完整项目归档，合并分卷并校验原始压缩包
python scripts/download_artifacts.py --profile complete --output ./b3_archive
```

完整数据约 33 GB；下载工具会保留分卷以便续传，若同时保留分卷、合并文件和解压文件，应预留更多磁盘空间。所有分卷须按清单顺序拼接，不能分别解压。

| 原始压缩包 | 内容 |
|---|---|
| `expert_demonstrations.tar.gz` | 实际使用的 2,337 条训练、432 条验证示范，原 RGB、状态、动作、接触记录、几何标签与媒体 |
| `training_cache.tar.gz` | 38 个冻结数组及完成记录，解压约 28.7 GB |
| `training_checkpoints.tar.gz` | B3 历史 λ 扫描及种子 43–50 的中间权重、选定权重、优化器、调度器、随机状态与采样计划 |
| `source_environment.tar.gz` | 冻结源码、资产 XML、第三方 ACT、原环境导出及离线安装包 |
| `stage1_results.tar.gz` | 16 个 B2/B3 模型共 86,016 次确认评测、开发评测、初始 PNG、逐步记录、视频与统计 |
| `round1_results.tar.gz` | 首轮 B0–B4 共 26,880 次最终评测及原研究证据 |
| `b3_selected_models_and_reports.tar.gz` | 八份可直接使用的 B3 权重、原配置/报告、369 个 B3 失败或接触不合格案例和离线视频索引 |

下载清单：[`publication/release_manifest.json`](publication/release_manifest.json)。逐资产校验：[`publication/SHA256SUMS.txt`](publication/SHA256SUMS.txt)。完整数据保留原目录与 SHA256，没有去除失败案例或修改统计。

## 模型选择与结果范围

主权重路径为 `models/main_frozen_reference_seed44/policy.pt`，SHA256：

```text
d34b91b8882a764d7556a6a28663b6fe3d5d2b8a94426dbffa798d41ba41704d
```

另保存历史 seed43 与新增 seeds45–50，彼此独立，未做权重平均。模型索引见 [`MODEL_INDEX.json`](research/original_archive/MODEL_INDEX.json)。

六对新训练种子的预注册确认实验，在全新预封存的 768 个独立布局上得到：

| 方法 | 目标成功率 | 接触合格成功率 | 平均执行步数 |
|---|---:|---:|---:|
| B2 | 99.7675% | 99.0296% | 76.8637 |
| B3 | 99.8636% | 99.1598% | 76.8223 |

B3−B2 目标成功率差为 **+0.0961 个百分点**，种子×布局交叉 bootstrap 的 95% 区间为 **[−0.0403, +0.2697] 个百分点**，双侧精确种子置换 **p = 0.21875**。主分析未观察到抓错颜色，但不能由此推断总体风险严格为零。

**采用 B3 是项目使用选择；确认实验尚无充分证据区分 B2/B3 优劣。** 结论限于已冻结的混合/Sobol 分布，不能推广为所有随机场景的最优模型。模型继承旧 checkpoint，历史空间暴露限制仍然存在。原 768 个首轮布局只作历史与补充；本轮确认使用新封存布局。分散、并排和图案场景的第二阶段尚未开展。

原封存实验包含禁止再次训练/选模的锁与源文件/mtime 审核。完整归档用于恢复和审计；新研究应建立独立实验目录和协议，保留这些已完成的实验记录。

## 项目结构

- `colorlift/`：环境、视觉、专家、ACT 适配、几何辅助学习、冻结评测/统计流程。
- `catlab_assets/`：正方体与 T 形块资产。
- `lift_act/`、`third_party/act/`：ACT 基础适配和上游实现。
- `models/`：八个模型各自配置、训练/选模记录；权重由下载脚本填充。
- `research/`：原报告、统计、协议、封存和选模记录。
- `scripts/`：发布下载工具与单场景运行入口；未改变冻结的 184 个 Python 源文件。

第三方许可和来源见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)，原许可证随源码保留。
