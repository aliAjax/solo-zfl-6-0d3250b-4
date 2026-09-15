import React, { useEffect, useMemo, useState } from 'react';
import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCw,
  RotateCcw,
  Move,
  Scaling,
  Check,
  Undo2,
  Wand2,
  AlertCircle,
  Minus,
  Plus,
} from 'lucide-react';
import {
  computeGlyphTransform,
  CANVAS_SIZE,
  FIT_MARGIN,
  type TransformParams,
} from '@/utils/pathTransform';

interface TransformConsoleProps {
  /** 'base' 或阶段 id */
  target: string;
  targetLabel: string;
  sourcePath: string;
  accentColor?: string;
  onApply: (newPath: string) => void;
}

/** 解析数值输入框：空值按 fallback 处理，非法文本直接拦下 */
function parseField(raw: string, fallback: number, fieldName: string): { value: number } | { error: string } {
  const t = raw.trim();
  if (t === '') return { value: fallback };
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: `${fieldName}不是有效数字` };
  return { value: v };
}

export const TransformConsole: React.FC<TransformConsoleProps> = ({
  target,
  targetLabel,
  sourcePath,
  accentColor = '#3E2723',
  onApply,
}) => {
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [angle, setAngle] = useState('0');
  const [scale, setScale] = useState('1');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [appliedMsg, setAppliedMsg] = useState('');

  // 切换目标字形时，参数台整体归零，避免把上一个字形的参数误写到新目标
  useEffect(() => {
    setFlipH(false);
    setFlipV(false);
    setAngle('0');
    setScale('1');
    setOffsetX('0');
    setOffsetY('0');
    setAppliedMsg('');
  }, [target]);

  const hasSource = sourcePath.trim().length > 0;

  const parsed = useMemo(() => {
    if (!hasSource) return { error: '当前目标是空字形：请先绘制或从基础形状复制后再做变换' };
    const a = parseField(angle, 0, '角度');
    if ('error' in a) return { error: a.error };
    // 比例不允许空：空比例按"无效数值"拦下
    if (scale.trim() === '') return { error: '比例不能为空，请填写大于 0 的数字（如 1）' };
    const s = parseField(scale, 1, '比例');
    if ('error' in s) return { error: s.error };
    const ox = parseField(offsetX, 0, '横向偏移');
    if ('error' in ox) return { error: ox.error };
    const oy = parseField(offsetY, 0, '纵向偏移');
    if ('error' in oy) return { error: oy.error };

    const params: TransformParams = {
      flipH,
      flipV,
      angleDeg: a.value,
      scale: s.value,
      offsetX: ox.value,
      offsetY: oy.value,
    };
    const result = computeGlyphTransform(sourcePath, params);
    return { params, result };
  }, [hasSource, sourcePath, flipH, flipV, angle, scale, offsetX, offsetY]);

  const parseError = 'error' in parsed ? parsed.error : null;
  const result = !parseError && 'result' in parsed ? parsed.result : null;
  const error = parseError ?? (result && !result.ok ? result.error : null);

  const isChanged =
    flipH ||
    flipV ||
    Number(angle) !== 0 ||
    Number(scale) !== 1 ||
    Number(offsetX) !== 0 ||
    Number(offsetY) !== 0;

  const reset = () => {
    setFlipH(false);
    setFlipV(false);
    setAngle('0');
    setScale('1');
    setOffsetX('0');
    setOffsetY('0');
  };

  const handleApply = () => {
    if (!result?.ok || !result.path) return;
    onApply(result.path);
    setAppliedMsg('变换已写入，记得保存字根');
    setTimeout(() => setAppliedMsg(''), 2500);
  };

  const bump = (setter: React.Dispatch<React.SetStateAction<string>>, step: number) => {
    setter((prev) => {
      const v = prev.trim() === '' ? 0 : Number(prev);
      if (!Number.isFinite(v)) return prev;
      const next = Math.round((v + step) * 100) / 100;
      return String(next);
    });
  };

  const autoHint =
    result?.autoAction === 'shrink'
      ? '结果超出画布，已绕中心整体等比缩小至边界内'
      : result?.autoAction === 'enlarge'
        ? '较长边不足画布六成，已自动放大（仍保持在画布内）'
        : null;

  return (
    <div className="bg-parchment-50 rounded-2xl p-6 shadow-scroll border border-parchment-300/40">
      <h3 className="font-kai text-xl text-ink-500 font-bold mb-1 pb-3 border-b-2 border-dashed border-parchment-300/60 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Wand2 className="text-vermilion-500" size={20} />
          字形变换台
        </span>
        <span
          className="text-xs font-song px-2.5 py-1 rounded-lg bg-parchment-100/70"
          style={{ color: accentColor }}
        >
          目标：{targetLabel}
        </span>
      </h3>
      <p className="text-[11px] text-ink-300 font-song mb-4">
        参数仅用于预览，点「确认写入」才生效；其他阶段变体与基础形状保持原样
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* 实时预览 */}
        <div>
          <div className="text-xs font-kai text-ink-400 mb-1.5">实时预览（灰虚线为原字形）</div>
          <svg viewBox="0 0 100 100" className="w-full aspect-square bg-parchment-100/70 rounded-xl border-2 border-dashed border-parchment-300/50 shadow-inner">
            <defs>
              <pattern id="tf-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#D9BE82" strokeWidth="0.25" opacity="0.5" />
              </pattern>
            </defs>
            <rect width="100" height="100" fill="url(#tf-grid)" />
            {/* 安全活动区 */}
            <rect
              x={FIT_MARGIN}
              y={FIT_MARGIN}
              width={CANVAS_SIZE - FIT_MARGIN * 2}
              height={CANVAS_SIZE - FIT_MARGIN * 2}
              fill="none"
              stroke="#7CB342"
              strokeWidth="0.4"
              strokeDasharray="1.5 1.5"
              opacity="0.55"
            />
            <line x1="50" y1="2" x2="50" y2="98" stroke="#B23A29" strokeWidth="0.25" strokeDasharray="2 2" opacity="0.25" />
            <line x1="2" y1="50" x2="98" y2="50" stroke="#B23A29" strokeWidth="0.25" strokeDasharray="2 2" opacity="0.25" />

            {hasSource &&
              sourcePath
                .split(/(?=M)/)
                .filter((s) => s.trim())
                .map((seg, i) => (
                  <path key={`o-${i}`} d={seg} fill="none" stroke="#9E9E9E" strokeWidth="1.6" strokeDasharray="2 1.5" opacity="0.55" strokeLinecap="round" />
                ))}

            {result?.ok && result.matrix && (
              <g transform={`matrix(${['a', 'b', 'c', 'd', 'e', 'f'].map((k) => result.matrix![k as 'a']).join(' ')})`}>
                {sourcePath
                  .split(/(?=M)/)
                  .filter((s) => s.trim())
                  .map((seg, i) => (
                    <path
                      key={`n-${i}`}
                      d={seg}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
              </g>
            )}

            {result?.ok && result.bbox && (
              <rect
                x={result.bbox.x}
                y={result.bbox.y}
                width={result.bbox.width}
                height={result.bbox.height}
                fill="none"
                stroke="#1E88E5"
                strokeWidth="0.4"
                opacity="0.6"
              />
            )}

            {!hasSource && (
              <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="#A1887F" className="font-song">
                空字形
              </text>
            )}
          </svg>
          {autoHint && (
            <div className="mt-2 text-[11px] font-song text-bronze-500 bg-bronze-400/10 border border-bronze-400/25 rounded-lg px-2.5 py-1.5">
              ⚖ {autoHint}
            </div>
          )}
        </div>

        {/* 控制台 */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <ToggleBtn active={flipH} onClick={() => setFlipH((v) => !v)} icon={<FlipHorizontal2 size={15} />} label="水平镜像" />
            <ToggleBtn active={flipV} onClick={() => setFlipV((v) => !v)} icon={<FlipVertical2 size={15} />} label="垂直镜像" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => bump(setAngle, -90)}
              className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-ink-400 hover:text-ink-500 hover:bg-parchment-200/50 border border-parchment-300/40 text-xs font-kai transition-all"
            >
              <RotateCcw size={14} /> 左转 90°
            </button>
            <button
              type="button"
              onClick={() => bump(setAngle, 90)}
              className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-ink-400 hover:text-ink-500 hover:bg-parchment-200/50 border border-parchment-300/40 text-xs font-kai transition-all"
            >
              <RotateCw size={14} /> 右转 90°
            </button>
          </div>

          <NumberRow
            label="旋转角度"
            unit="°"
            value={angle}
            onChange={setAngle}
            onMinus={() => bump(setAngle, -1)}
            onPlus={() => bump(setAngle, 1)}
            stepHint="微调 ±1°"
          />
          <NumberRow
            label="等比缩放"
            unit="×"
            value={scale}
            onChange={setScale}
            onMinus={() => bump(setScale, -0.1)}
            onPlus={() => bump(setScale, 0.1)}
            stepHint="微调 ±0.1"
          />
          <NumberRow
            label="横向偏移"
            unit="px"
            value={offsetX}
            onChange={setOffsetX}
            onMinus={() => bump(setOffsetX, -1)}
            onPlus={() => bump(setOffsetX, 1)}
            stepHint="微调 ±1"
          />
          <NumberRow
            label="纵向偏移"
            unit="px"
            value={offsetY}
            onChange={setOffsetY}
            onMinus={() => bump(setOffsetY, -1)}
            onPlus={() => bump(setOffsetY, 1)}
            stepHint="微调 ±1"
          />

          {error && (
            <div className="flex items-start gap-2 text-[11px] font-song text-vermilion-600 bg-vermilion-500/10 border border-vermilion-500/25 rounded-lg px-2.5 py-2">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {appliedMsg && !error && (
            <div className="text-[11px] font-song text-emerald-700 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2.5 py-2">
              ✓ {appliedMsg}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              disabled={!isChanged}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-ink-400 hover:text-ink-500 hover:bg-parchment-200/50 border border-parchment-300/40 text-xs font-kai transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 size={14} /> 重置
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!result?.ok || !isChanged}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-vermilion-500 hover:bg-vermilion-600 text-parchment-50 text-sm font-kai shadow-seal transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-vermilion-500"
            >
              <Check size={15} /> 确认写入「{targetLabel}」
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ToggleBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-kai transition-all ${
      active
        ? 'bg-vermilion-500 text-parchment-50 border-vermilion-600/40 shadow-md'
        : 'text-ink-400 hover:text-ink-500 hover:bg-parchment-200/50 border-parchment-300/40'
    }`}
  >
    {icon}
    {label}
  </button>
);

const NumberRow: React.FC<{
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onMinus: () => void;
  onPlus: () => void;
  stepHint: string;
}> = ({ label, unit, value, onChange, onMinus, onPlus, stepHint }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-kai text-ink-400 flex items-center gap-1">
        {label === '等比缩放' ? <Scaling size={12} /> : label === '旋转角度' ? <RotateCw size={12} /> : <Move size={12} />}
        {label}
      </span>
      <span className="text-[10px] text-ink-200 font-song">{stepHint}</span>
    </div>
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onMinus}
        className="p-1.5 rounded-lg text-ink-400 hover:text-ink-500 hover:bg-parchment-200/60 border border-parchment-300/40 transition-all"
        title={`减少（${stepHint.replace('微调 ', '')}）`}
      >
        <Minus size={12} />
      </button>
      <div className="relative flex-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          className="w-full px-2.5 py-1.5 pr-7 rounded-lg bg-parchment-100/60 border border-parchment-300/50 text-ink-500 font-song text-sm text-center focus:outline-none focus:ring-2 focus:ring-vermilion-500/30"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-200 font-song">{unit}</span>
      </div>
      <button
        type="button"
        onClick={onPlus}
        className="p-1.5 rounded-lg text-ink-400 hover:text-ink-500 hover:bg-parchment-200/60 border border-parchment-300/40 transition-all"
        title={`增加（${stepHint.replace('微调 ', '')}）`}
      >
        <Plus size={12} />
      </button>
    </div>
  </div>
);
