% t99_assembly_example.m - 拼接示例（模板 v1）
% 用法：在 MATLAB 中直接运行本文件（同目录须含 t01-t06）。
% 说明：run() 在调用者工作区执行，各段变量（d/cfg/mIds 等）自动共享；
%       正式使用时按任务修改 cfg（尤其 outDir）后再运行。
%       末行 save 的 .mat 为 MCOS 对象（插件工具仅可探测元数据，不能当数据源）。

tp = fileparts(mfilename('fullpath'));
run(fullfile(tp, 't01_box_slope_build.m'));
run(fullfile(tp, 't03_monitor_points.m'));
run(fullfile(tp, 't02_seismic_drive.m'));
run(fullfile(tp, 't04_result_export.m'));
run(fullfile(tp, 't06_newmark_jibson.m'));
run(fullfile(tp, 't05_figures_gif.m'));
save(fullfile(cfg.outDir, 'LandslideEQResult.mat'), 'B', 'd');
fs.disp('TEMPLATE_PIPELINE_DONE');
