% t05_figures_gif.m - 6 子图分析图 + GIF 动画（模板 v1）
% 来源：AI/user_LandslideEQ.m phase 4 图件段。
% 前置：t01/t02/t03/t04/t06（nmDisp/nBr）；
%       产出：<outDir>/landslide_final.png/.fig + landslide_animation.gif。
% 说明：子图 4 为 Newmark 预测与坡顶位移对比。

figure(2);
clf;
subplot(2, 3, 1);
plot(recT, recX(:, 1), 'r-', recT, recX(:, 2), 'g-', recT, recX(:, 3), 'b-', recT, recX(:, 4), 'm-', recT, recX(:, 5), 'k-');
legend(mNames);
title('Monitor X displacement (m)');
xlabel('t (s)');
grid on;
subplot(2, 3, 2);
plot(recT, sqrt(recVX.^2 + recVZ.^2));
legend(mNames);
title('Monitor velocity (m/s)');
xlabel('t (s)');
grid on;
subplot(2, 3, 3);
plot(recT, sqrt(recAX.^2 + recAZ.^2));
legend(mNames);
title('Monitor acceleration (m/s^2)');
xlabel('t (s)');
grid on;
subplot(2, 3, 4);
plot(recT, nmDisp, 'k-', recT, recX(:, 1), 'r--');
legend('Newmark prediction', 'Simulation (slope top)');
title(['Empirical vs simulation (Jibson=' num2str(DnJ, 4) 'cm, kc=' num2str(cfg.kc, 3) ')']);
xlabel('t (s)');
ylabel('displacement (m)');
grid on;
subplot(2, 3, 5);
scatter(aX0all, aZ0all, 3, d.mo.aMatId(1:mNum), 'filled');
axis equal;
colorbar;
title('Before shaking');
subplot(2, 3, 6);
scatter(aX, aZ, 3, d.mo.aMatId(1:mNum), 'filled');
axis equal;
colorbar;
title(['After shaking (breaks=' num2str(nBr) ')']);
sgtitle('Slope landslide under seismic shaking (template)');
saveas(gcf, fullfile(cfg.outDir, 'landslide_final.png'));
saveas(gcf, fullfile(cfg.outDir, 'landslide_final.fig'));
if ~isempty(frames)
    [imind, cm] = rgb2ind(frames(1).cdata, 256);
    imwrite(imind, cm, fullfile(cfg.outDir, 'landslide_animation.gif'), 'gif', 'DelayTime', 0.1, 'LoopCount', inf);
    for k = 2:length(frames)
        [imind, cm] = rgb2ind(frames(k).cdata, 256);
        imwrite(imind, cm, fullfile(cfg.outDir, 'landslide_animation.gif'), 'gif', 'WriteMode', 'append', 'DelayTime', 0.1);
    end
end
fs.disp('T05_FIGURES_DONE');
