% t06_newmark_jibson.m - Newmark 滑块位移 + Jibson 经验式（模板 v1）
% 来源：AI/user_LandslideEQ.m phase 4 分析段。
% 前置：t02（aInHist/recT/d.mo.dT/cfg.kc）；产出：amaxIn/ac/nmDisp/Ia/DnJ。
% 说明：①输入加速度 aInHist 由正弦位移二阶导公式导出（位移驱动场合）；
%       ②DnJ 为 Jibson 经验式，单位 cm——仅作参考对照，不是验证。

amaxIn = max(abs(aInHist));
ac = cfg.kc * amaxIn;
vrel = 0;
drel = 0;
nmDisp = zeros(cfg.N + 1, 1);
for i = 2:cfg.N + 1
    a = aInHist(i);
    if abs(a) > ac
        vrel = vrel + (abs(a) - ac) * sign(a) * d.mo.dT;
    else
        vrel = 0;
    end
    drel = drel + vrel * d.mo.dT;
    nmDisp(i) = drel;
end
Ia = trapz(recT, (aInHist / amaxIn).^2);
DnJ = 10^(1.521 - 0.659 * log10(cfg.kc) - 0.416 * log10(Ia));
fs.disp('T06_NEWMARK_DONE');
