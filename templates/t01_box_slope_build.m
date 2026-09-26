% t01_box_slope_build.m - 滑坡箱体建模 + 坡面雕刻 + 弱土材料（模板 v1）
% 来源：AI/user_LandslideEQ.m phase 1-2（已跑通）；此处参数化并补充注释。
% 前置：无（本段最先执行）。产出：B, d, cfg, mNum。
% 坑点：①坡面雕刻必须用 delElement（不要用 makeModelByGroups：其依赖的
%        getBoxSample 等 6 个名字在 MatDEM 5.11 内核中无定义）；
%        ②sampleL = 0 表示二维模型（不调用 convert2D）。

cfg = struct();
% ---- 全局参数区（后续各段共用；改这里即可）----
cfg.seed       = 3;         % 随机种子（复现性）
cfg.ballR      = 0.8;       % 颗粒半径基准
cfg.distriRate = 0.15;      % 粒径级配率
cfg.sampleW    = 160;       % 箱体宽度
cfg.sampleH    = 62;        % 箱体高度
cfg.slopeW     = 140;       % 斜坡段水平长度（x < slopeW 为斜坡段）
cfg.slopeTopZ  = 62;        % 坡顶 z
cfg.slopeToeZ  = 12;        % 坡脚平台 z
cfg.material   = [2e9 0.2 5e4 5e4 0.25 1800];  % 弱土：[E, nu, S(键强), C(聚合力), phi(摩擦), rho]
cfg.dtFactor   = 4;         % 平衡阶段 dT 放大倍数
cfg.shoulderXY = [30 51];   % 肩部监测点参考坐标（仅用于选点）
cfg.N          = 240;       % 振动总步数（t02 用）
cfg.cycles     = 12;        % 正弦周期数（t02 用）
cfg.amp        = 0.2;       % 底部位移幅值 m（t02 用）
cfg.rmseTol    = 0.01;      % 每步平衡收敛容差（t02 用）
cfg.kc         = 0.15;      % Newmark 临界加速度比（t06 用）
cfg.outDir     = fullfile(pwd, 'out');  % 输出目录（t04/t05 用；请按任务改名）

% ---- phase 1: 建箱体（topPlaten 型；无侧墙）----
fs.randSeed(cfg.seed);
B = obj_Box;
B.name = 'LandslideEQ';
B.GPUstatus = 'auto';
B.ballR = cfg.ballR;
B.distriRate = cfg.distriRate;
B.sampleW = cfg.sampleW;
B.sampleL = 0;              % 二维
B.sampleH = cfg.sampleH;
B.type = 'topPlaten';
B.setType();
B.buildInitialModel();
B.setUIoutput();
d = B.d;
B.gravitySediment();
B.compactSample(1);
d.status.dispEnergy();
d.clearData(1);
fs.disp('T01_PHASE1_DONE');

% ---- phase 2: 雕刻坡面（删除坡面线以上的颗粒）----
d.calculateData();
d.mo.setGPU('off');
d.getModel();
mNum = d.mNum;
mX = gather(d.mo.aX(1:mNum));
mZ = gather(d.mo.aZ(1:mNum));
zs = cfg.slopeTopZ - (cfg.slopeTopZ - cfg.slopeToeZ) / cfg.slopeW * mX;
zs(mX >= cfg.slopeW) = cfg.slopeToeZ;
delId = find(mZ > zs + 0.01);
d.mo.setShear('off');
d.delElement(delId);
d.calculateData();
if ~exist(cfg.outDir, 'dir'); mkdir(cfg.outDir); end
fid = fopen(fullfile(cfg.outDir, 'carve_groups.txt'), 'w');
if fid >= 0
    fprintf(fid, 'deleted=%d aNum=%d mNum=%d\n', length(delId), d.aNum, d.mNum);
    fprintf(fid, 'X range=[%.2f, %.2f] Z range=[%.2f, %.2f]\n', min(d.mo.aX), max(d.mo.aX), min(d.mo.aZ), max(d.mo.aZ));
    fprintf(fid, 'nZ>%g=%d nNaN=%d\n', cfg.sampleH, sum(d.mo.aZ > cfg.sampleH), sum(isnan(d.mo.aX)));
    fclose(fid);
end
Mats{1, 1} = material('WeakSoil', cfg.material, B.ballR);
Mats{1, 1}.Id = 1;
d.Mats = Mats;
d.mo.aMatId(1:d.mNum) = 1;
d.balanceBondedModel0();
d.mo.zeroBalance();
d.mo.bFilter(:) = true;
d.mo.dT = d.mo.dT * cfg.dtFactor;
d.balance('Standard', 1);
d.mo.bFilter(:) = true;
d.balance('Standard', 0.5);
d.mo.dT = d.mo.dT / cfg.dtFactor;
d.calculateData();
fs.disp('T01_PHASE2_DONE');
