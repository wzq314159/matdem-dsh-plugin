# MatDEM 论文场景脚本模板库（templates/）

- 版本：v1（2026-09-26）｜维护：DSH MatDEM 插件（pkg-14）
- 来源：从已跑通的演示脚本 `AI/user_LandslideEQ.m`（滑坡箱体 + 坡面雕刻 + 底部正弦位移驱动 + 5 监测点 + Newmark/Jibson 对比）提炼与参数化。
- 定位：**论文场景套用骨架**——将来在获授权运行时按“拼接顺序”组合使用；模板本身不构成任何运行授权。
- 边界：本库为静态整理件（整理时未在 MATLAB 实跑）；使用前须先做小规模冒烟试跑。

## 文件清单与拼接顺序

| 顺序 | 文件 | 用途 | 依赖前置 |
|---|---|---|---|
| 1 | `t01_box_slope_build.m` | 箱体建模 + 坡面雕刻 + 弱土材料；定义全局参数区 `cfg` | 无 |
| 2 | `t03_monitor_points.m` | 5 类监测点自动选取（顶/趾/中/心/肩） | t01 |
| 3 | `t02_seismic_drive.m` | 底部正弦位移驱动主循环（记录历史数组） | t01、t03 |
| 4 | `t04_result_export.m` | 结果 txt 报表输出（供结果提取工具汇总） | t01、t03、t02 |
| 5 | `t06_newmark_jibson.m` | Newmark 滑块位移 + Jibson 经验式对比 | t02 |
| 6 | `t05_figures_gif.m` | 6 子图分析图 + GIF 动画导出 | t02、t06 |
| — | `t99_assembly_example.m` | 拼接示例（一次 run 全流程；改 cfg 即可套用） | 全部 |

## 五个关键坑点（来自实测脚本，务必遵守）

1. **坡面雕刻用 `delElement(id)`**：删除坡面线以上颗粒。不要用 `makeModelByGroups`——其依赖的 6 个名字（`getBoxSample` 等）在 MatDEM 5.11 内核与可见源码中均无定义（随包示例与内核不自洽）。
2. **边界驱动写全名 `'bottom'`**：`d.moveBoundary('bottom', dx, 0, 0)`；简写 `'bot'` 无效。
3. **用位移驱动而不是加速度积分**：`xB = amp*sin(2*pi*cycles*i/N)`，每步 `moveBoundary` 增量 `xB - xBprev` 后 `balance('Standard', tol)`；实测比直接积分加速度稳定。
4. **雕刻/取样阶段切 `setGPU('off')`**：主循环内每步 `d.mo.setGPU(gpuStatus)` 切回；读属性一律用 `gather()` 包装。
5. **平衡与时间步**：雕刻后先 `balanceBondedModel0()`；平衡加速用 `bFilter(:)=true` 与临时 `dT*4`（完成后还原）。

## 通过插件运行（需先获授权）

- 组装：将各段按上表顺序复制进同一目录（或直接用 `t99_assembly_example.m`），按任务修改 `cfg`（尤其 `outDir`）。
- 运行：用插件 `matdem_run_script`（`matdemctl.ps1`）或 MATLAB `-batch` 方式提交；长算/GPU 仍受闸门约束（本库不构成授权）。
- 汇总：运行后用 `tools/matdem_result_summary.py extract/merge` 汇总 txt 结果；`.mat` 存档为 MCOS 对象（Python 不可解，仅可探测元数据）。

## 已知限制

- 模板为静态整理（未实跑验证）；数值参数为演示脚本原值，套用论文场景时须按任务重新标定/声明。
- 只覆盖“滑坡箱体 + 位移驱动 + 监测 + 分析”一条经验链；其它场景（含水、破碎流等）另行扩展。
