% t02_seismic_drive.m - 底部正弦位移驱动主循环（模板 v1）
% 来源：AI/user_LandslideEQ.m phase 3 循环体。
% 前置：t01（B/d/cfg）；t03（mIds/initX/initZ）。产出：recT/recX/recZ/
%       recVX/recVZ/recAX/recAZ/aInHist/frames。
% 坑点：①边界名写全 'bottom'（简写 'bot' 无效）；②位移驱动（非加速度积分）：
%        每步先 moveBoundary 再 balance；③循环内每步切回 GPU；④gather 读属性。

d.resetStatus();
d.mo.isHeat = 1;
d.mo.isCrack = 1;
d.mo.mVis = d.mo.mVis * 1e-6;
gpuStatus = d.mo.setGPU('auto');
d.setStandarddT();
mNum = d.mNum;
N = cfg.N;
recT = zeros(N + 1, 1);
recX = zeros(N + 1, 5);
recZ = zeros(N + 1, 5);
recVX = zeros(N + 1, 5);
recVZ = zeros(N + 1, 5);
recAX = zeros(N + 1, 5);
recAZ = zeros(N + 1, 5);
aInHist = zeros(N + 1, 1);
vPrev = zeros(5, 1);
vPrevZ = zeros(5, 1);
xB = 0;
xBprev = 0;
d.showB = 3;
d.isUI = 0;
d.figureNumber = 1;
hF = d.show('Displacement');
title('Landslide displacement (t=0)');
drawnow;
frames(1) = getframe(hF);
d.tic(N);
for i = 1:N
    d.mo.setGPU(gpuStatus);
    t = i * d.mo.dT;
    xB = cfg.amp * sin(2 * pi * cfg.cycles * i / N);
    d.moveBoundary('bottom', xB - xBprev, 0, 0);
    xBprev = xB;
    d.balance('Standard', cfg.rmseTol);
    d.clearData(1);
    d.calculateData();
    recT(i + 1) = t;
    aInHist(i + 1) = -cfg.amp * (2 * pi * cfg.cycles / (N * d.mo.dT))^2 * sin(2 * pi * cfg.cycles * i / N);
    ax = gather(d.mo.aX(mIds));
    az = gather(d.mo.aZ(mIds));
    recX(i + 1, :) = (ax - initX)';
    recZ(i + 1, :) = (az - initZ)';
    vx = gather(d.mo.mVX(mIds));
    vz = gather(d.mo.mVZ(mIds));
    recVX(i + 1, :) = vx';
    recVZ(i + 1, :) = vz';
    recAX(i + 1, :) = (vx - vPrev)' / d.mo.dT;
    recAZ(i + 1, :) = (vz - vPrevZ)' / d.mo.dT;
    vPrev = vx;
    vPrevZ = vz;
    if mod(i, 4) == 0
        d.figureNumber = 1;
        hF = d.show('Displacement');
        title(['Landslide t=' num2str(t, 4) 's']);
        drawnow;
        frames(end + 1) = getframe(hF);
    end
    d.toc();
end
fs.disp('T02_DRIVE_DONE');
