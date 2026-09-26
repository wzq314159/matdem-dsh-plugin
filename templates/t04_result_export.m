% t04_result_export.m - 结果 txt 报表输出（模板 v1）
% 来源：AI/user_LandslideEQ.m phase 4 报表段。
% 前置：t01/t03/t02；产出：<outDir>/landslide_result.txt（键值行，
%       供 tools/matdem_result_summary.py 的 extract/merge 汇总）。
% 说明：MatDEM *Result.mat 为 MCOS 对象（Python 不可解）——报表走 txt 更实用。

aX = gather(d.mo.aX(1:mNum));
aZ = gather(d.mo.aZ(1:mNum));
dispSoil = sqrt((aX - aX0all).^2 + (aZ - aZ0all).^2);
nBr = size(d.status.breakId, 1);
if ~exist(cfg.outDir, 'dir'); mkdir(cfg.outDir); end
fid = fopen(fullfile(cfg.outDir, 'landslide_result.txt'), 'w');
if fid >= 0
    fprintf(fid, 'maxSoilDisp=%.4f meanSoilDisp=%.4f\n', max(dispSoil), mean(dispSoil));
    fprintf(fid, 'nSoilDisp>1=%d nSoilDisp>2=%d nSoilDisp>5=%d\n', sum(dispSoil > 1), sum(dispSoil > 2), sum(dispSoil > 5));
    fprintf(fid, 'breaks=%d\n', nBr);
    fprintf(fid, 'M1TopDispX=%.4f M2ToeDispX=%.4f\n', recX(end, 1), recX(end, 2));
    fprintf(fid, 'M1TopDispZ=%.4f M2ToeDispZ=%.4f\n', recZ(end, 1), recZ(end, 2));
    fprintf(fid, 'maxV=%.4f\n', max(max(sqrt(recVX.^2 + recVZ.^2))));
    fprintf(fid, 'totalT=%.6f\n', recT(end));
    fclose(fid);
end
fs.disp('T04_EXPORT_DONE');
