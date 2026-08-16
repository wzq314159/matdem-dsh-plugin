# MatDEM 5.11 集成插件（DSH 动态 Cordis 插件）

把本机 **MatDEM 5.11**（矩阵离散元软件，MATLAB 编译版）接入 DeepSeek Harness：
检测环境 → 启动 GUI → 管理/编写 .m 脚本 → 在 GUI 中自动运行 → 读取结果。

## 文件说明

| 文件 | 作用 |
|---|---|
| `matdemctl.ps1` | GUI 自动化原语工具（窗口枚举/置前、截图、中文 OCR、鼠标点击/双击/滚轮、PostMessage 键盘、文件 mtime 查询）。被 Host 半部调用。 |
| `matdem-plugin-host.js` | 插件 Host 半部源码（Node 侧）：9 个模型工具 + 9 个 Client RPC 处理器 |
| `matdem-plugin-client.js` | 插件 Client 半部源码（浏览器侧）：运行卡片里的控制面板 |
| `README.md` | 本说明 |

> 插件本体由 DSH 会话动态加载（`cordis_define` / `cordis_run`），
> 本目录保存的是插件的全部构成文件（源码 + 自动化工具），供查看/复用。
> 恢复方式：在 DSH 中把 host/client 源码重新 `cordis_define` 为插件，
> 并把 `matdemctl.ps1` 放到 MatDEM 根目录（插件会检测它）。

## 版本记录

| 版本 | 内容 |
|---|---|
| pkg-1 ~ pkg-10 | 基础功能：工具注册、MCR/GPU 检测、窗口识别、OCR 行匹配、文件行尾 `_m` 归一化、最长文本行优先、taskkill /T /F 强杀、重启回退、mtime 完成检测 |
| pkg-11 (final4) | mtime 完成检测细化（TempModel 文件 mtime 晚于运行开始） |
| pkg-12 (final5) | **模态对话框自动关闭**（dismissDialogs/findModalDialog/dismissOne：优先点 取消/否，回退 确定/关闭，最后点右下角；运行前清理残留对话框，运行后弹出提示对话框时关闭并重新点击运行按钮）+ **文件行 OCR 归一化**（fileNorm：全角数字/〇囗口→0、。．·→.、℃→c、去非 ASCII，仅用于面板行匹配） |
| pkg-13 | Levenshtein 模糊行匹配（容忍 OCR 数字/字母混淆，如 EQv5→EQv6）、安全对话框关闭策略细化（跳过 figure/图 标题、大窗口） |

> 注：源码仓库中的文件即为最新版（host 34275B / client 6309B / matdemctl 14472B / README 7417B），
> 实际运行以 DSH 会话中 `cordis_define` 的包为准。

## 模型工具（Agent 可用）

- `matdem_status` — 环境检测：安装目录、MCR 9.14 (R2023a)、GUI 是否运行、窗口、NVIDIA GPU
- `matdem_launch` — 启动 MatDEM.exe，自动点击"主程序"进入编辑器主窗口（enterMain=false 停在启动页）
- `matdem_scripts` — 列出根目录 + examples* 的全部 .m 脚本
- `matdem_read_script` / `matdem_write_script` — 读写 .m 脚本
- `matdem_run_script` — **全自动运行**：进入主程序 → 文件管理器导航 → 双击载入脚本 → 点击"运行以上命令" → 轮询完成（输出条消息 / 新图形窗口 / TempModel 文件 mtime 变化）
- `matdem_output` — OCR 读取底部"输出消息"条
- `matdem_results` — 列出结果文件（根目录 PNG/GIF、TempModel/ 和 data/ 的 .mat）
- `matdem_close` — 强杀 MatDEM 进程树（释放 GPU）

## 关键实现要点（踩坑记录）

1. **MatDEM 是纯 GUI 程序**：`-batch`/`-r` 参数实测无效，只能 GUI 自动化。
   驱动方式 = 截图 + Windows 中文 OCR（WinRT `Windows.Media.Ocr`）+ 鼠标点击。
   MatDEM 界面是 Java AWT（SunAwtFrame），Java Access Bridge 已装入 MCR JRE
   但 MSAA 子对象不可用，OCR 路线最可靠。
2. **键盘**：SendInput 键盘事件到不了 Java 组件；改用 `PostMessage WM_CHAR`
   直接发给窗口（`wtype`/`wkey` 命令）才生效。
3. **输出**：用户代码的 `disp`/`fprintf` 不显示在"输出消息"条（只有应用内部消息
   显示，如 "GPU calculation is on now"）。但 **`fs.disp('文本')` 会显示**！
   脚本里用 `fs.disp` 打标记可被 `matdem_output` 读取。结果数据仍建议写入文件
   （`save` .mat、`print`/`saveas` PNG、`fopen`/`fprintf` 文本）后用
   `matdem_results` 检查。
4. **脚本坑**：用户脚本里**不要用 `return`**——MatDEM 的命令执行器会报
   "A return command can not include in for/while/switch and try/catch" 并中止运行。
   另外执行器对复杂嵌套（for 内嵌 if/else）偶发"缺少 END"解析错误——
   **保持脚本结构简单**（单层 if、避免嵌套 for/if、避免 if/else）最稳妥。
   字段访问用 `d.mo.*`（如 `mVX`/`mAX`/`totalT`）和 `d.status.*`
   （如 `totalEs`/`kineticEs`/`elasticEs`/`heats`/`Ts`/`breakId`）。
5. **文件覆盖**：MatDEM 会用编辑器缓存覆盖磁盘上的 .m 文件 —— 写脚本前先
   `matdem_close`，或运行前重启应用（插件在文件列表过期/编辑器视图丢失时会自动重启重试）。
6. **窗口识别**：主程序窗口标题是 `MatDEM主程序-N <工作目录>`；启动页窗口标题是
   `矩阵离散元5.11-培训高性能版-已许可`。运行/载入等操作都针对主程序窗口。
7. **完成检测**：点击"运行以上命令"后，监测 (a) 输出条出现完成/错误标记、
   (b) 新 SunAwtFrame 图形窗口、(c) TempModel/ 下任何文件 mtime 晚于运行开始。
8. **模态对话框**：运行过程中可能弹出"退出?"/提示 对话框阻塞点击 —— 运行前
   `dismissDialogs()` 清理残留，点击运行后 2.5s 检查 `findModalDialog()`，
   如有则关闭并重新点击运行按钮。
9. **OCR 归一化**：文件管理器行文本 OCR 常有 全角数字/〇囗/。．·/℃ 混淆，
   面板行匹配用 `fileNorm()`（映射 + 去非 ASCII + 小写），UI 文字（如"运行以上命令"）
   用 `norm()` 保留中文。

## 使用流程建议（Agent 工作流）

```
matdem_close            # 关闭（如需安全写入脚本）
matdem_write_script     # 写 user_MySim.m
matdem_launch           # 启动 + 进入主程序
matdem_run_script       # 运行脚本（长任务用 wait=false + matdem_output 轮询）
matdem_results          # 检查结果文件（PNG / .mat / 文本）
```

## 已交付的演示算例（AI/ 文件夹）

| 文件 | 说明 |
|---|---|
| `AI/user_LandslideEQ.m` | **边坡地震滑坡模拟（FINAL 版）**：160×62 箱体 → 坡面线 z:62→12（19.6°）→ `delElement` 删除坡面以上 1839 颗粒（保留全部边界墙，避免 makeModelByGroups 破坏 boundary 结构导致 bondbal NaN / moveBoundary 失效）→ 弱土 `[2e9 0.2 5e4 5e4 0.25 1800]` → bondbal0 平衡 → 底部 `moveBoundary('bottom')` 正弦振动（amp 0.2m × 12 循环 × 240 步）→ **2862 断裂、平均位移 11m、坡脚水平右移 4.38m（真实滑坡）**。含动画 GIF + 5 监测点时程（位移/速度/加速度）+ Newmark/Jibson 对比 + 滑移前后图，截图存于 `边坡项目/模拟结果截图/815/Landslide_final.png` |
| `AI/user_EQv5.m` | 5 倍振幅振动案例（含动画+裂缝分布子图），截图存于 `边坡项目/模拟结果截图/815/EQv5_*` |
| `AI/BoxEarthquakeFreq10.mat` | 10 倍频率地震案例的数据文件（含振动参数） |

## 关键经验（本目录插件 + 脚本开发）

- **DEM 模型必须位移驱动**：通过"加速度→速度→位移"积分驱动边界时，受 dT（~4e-5s）限制，积分位移仅微米级，模型无响应。**直接给边界大位移振荡**（振幅≈0.2~0.4 倍球径）才能有效激励。
- **滑坡三要素**：坡角正切 > 土体摩擦系数（tanβ > μ）、弱粘结（S 小）、强振动。本例 tan19.6°=0.356 > μ=0.25。
- **makeModelByGroups 陷阱（重要）**：`makeModelByGroups(gNames)` **不会删除未列出的组**，且会**清空 platens**、破坏 boundary 结构 —— 之后 `balanceBondedModel0` 产生 NaN、`moveBoundary` 失效。**正确做法**：`d.delElement(delId)` 直接删除坡面以上颗粒的 id（保留所有边界墙），参考 `supo/yczd/729time2.m`。
- **moveBoundary 方向名**：有效值为 `'left' 'right' 'front' 'back' 'bottom' 'top'`（**`'bot'` 无效**！）。
- 2D 模型（sampleL=0）只有 topPlaten（topPlaten 类型）或 botPlaten（botPlaten 类型）；B 墙 lefB/rigB/botB/topB 始终存在。
- 监测点：`d.GROUP.layer1` 或 `1:mNum` 按位置选取坡顶/坡脚/坡中/内部 + 参考点；循环内每步记录 `aX/aZ/mVX/mVZ`，加速度用速度差分。
- 经验公式：Newmark 滑块法（输入加速度 + 临界加速度比 kc=0.15 双积分）；Jibson 简化式 Dn=10^(1.521-0.659log10(kc)-0.416log10(Ia))。
- 动画：`d.figureNumber=1` 复用 Figure 1 + `getframe` 逐帧捕获 → `imwrite(...,'gif','WriteMode','append')` 存 GIF（`fs.movie2gif` 路径处理有坑，imwrite 更稳）。

## 环境要求

- Windows + PowerShell 5.1（`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`）
- MATLAB Runtime R2023a (9.14)（本机已装于 `E:\matdem\R2023a`）
- NVIDIA GPU 可选（加速计算；MatDEM 支持 CPU/GPU 切换）