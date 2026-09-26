% t03_monitor_points.m - 监测点自动选取（5 类典型位置，模板 v1）
% 来源：AI/user_LandslideEQ.m phase 3 选点段。
% 前置：t01（d、mNum、cfg）；产出：idSoil/aX0all/aZ0all/mIds/mNames/initX/initZ。
% 说明：顶/趾/中/心/肩 5 点按几何自动选定；肩点用 cfg.shoulderXY 参考坐标。

d.mo.setGPU('off');
d.getModel();
mNum = d.mNum;
idSoil = 1:mNum;
aX0all = gather(d.mo.aX(1:mNum));
aZ0all = gather(d.mo.aZ(1:mNum));
[~, iTop] = max(aZ0all);
[~, iToe] = min(aZ0all);
[~, iMid] = min(abs(aZ0all - mean(aZ0all)));
[~, iCen] = min((aX0all - mean(aX0all)).^2 + (aZ0all - mean(aZ0all)).^2);
[~, iShd] = min(abs(aX0all - cfg.shoulderXY(1)) + abs(aZ0all - cfg.shoulderXY(2)));
mIds = [idSoil(iTop); idSoil(iToe); idSoil(iMid); idSoil(iCen); idSoil(iShd)];
mNames = {'SlopeTop'; 'SlopeToe'; 'SlopeMid'; 'SoilInner'; 'SlopeShoulder'};
initX = gather(d.mo.aX(mIds));
initZ = gather(d.mo.aZ(mIds));
fs.disp('T03_MONITORS_DONE');
