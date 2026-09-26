# tools/ — MatDEM 结果摘要提取工具

`matdem_result_summary.py`：把 MatDEM 运行产物整理成可核对的表格（零硬依赖，scipy 可选）。

## 背景（为什么不是 .mat 解析）

MatDEM 的 `*Result.mat` 多为 **MATLAB MCOS 对象序列化**（`_Class=obj_Box/build`），Python/scipy 无法解析其属性。
因此统计量建议由脚本用 `fprintf` 写文本（参考 `AI/` 内 `DSH_EQv10_result.txt` 的格式），再用本工具提取/汇总。

## 用法

```
py -X utf8 matdem_result_summary.py list    <dir> [--ext .mat,.txt] [--recurse] [--limit N]
py -X utf8 matdem_result_summary.py extract <file.txt> [--out x.csv]
py -X utf8 matdem_result_summary.py merge   <dir> [--ext txt,log,csv] [--recurse] [--out x.csv]
py -X utf8 matdem_result_summary.py mat     <a.mat> [b.mat ...]
```

- `extract` / `merge` 输出 CSV 为 UTF-8-SIG（Excel 直接打开）。
- 解析规则：一行可含多对 `key=value`（如 `aNum=5243 mNum=4718`）；支持阈值式键名（`nDisp>0.5`、`nX>=100`、`nZ<50`）、键内空格（`kineticEs max`）、中文键；`#` `//` `%` 与装饰行（`=== … ===`）自动跳过。
- `mat` 子命令需要 scipy（可选）：报告 MCOS 类名与可读标量变量；无 scipy 时仅报文件元数据（大小等）。

## 已验证（2026-09-26，真实产物）

- `AI/DSH_EQv10_result.txt` → 18 项；`AI/DSH_EQv10_cracks.txt` → 12 项；`AI/DSH_EQv5_result.txt` → 15 项。
- `AI/*.txt`（12 文件）merge → 79 键宽表 CSV。
- `.mat` 探测：`LandslideEQResult.mat` → `B:obj_Box, d:build`；`DSH_EQv10_step0.mat` → 除 MCOS 对象外可读 `mNum=4718, amp=0.01, gpuStatus='off', nCycles=10`。

## 边界

- 只读产物；不启动任何求解器；不修改任何文件。
- MCOS `.mat` 的属性经 Python 不可解析（如实标注为限制，不做绕过）。
- 仅供执行层结果整理使用；不改变任何闸门与证据口径。