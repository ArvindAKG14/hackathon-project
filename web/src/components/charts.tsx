"use client";

import { useEffect, useRef, useState } from "react";

// Small hand-drawn SVG charts. Each one measures its container so text stays
// a readable size on phones, and shows a tooltip for the mark under the pointer.

const PAD = { top: 16, right: 16, bottom: 32, left: 44 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4) {
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / count)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => (max - min) / s <= count) ?? step * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / nice) * nice; t <= max + 1e-9; t += nice) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-sm whitespace-nowrap shadow-md"
      style={{ left }}
    >
      {children}
    </div>
  );
}

function YAxis({ ticks, y, width }: { ticks: number[]; y: (v: number) => number; width: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-soft text-[12px]">
            {t.toLocaleString()}
          </text>
        </g>
      ))}
    </g>
  );
}

function ThresholdLine({ value, label, y, width }: { value: number; label: string; y: (v: number) => number; width: number }) {
  return (
    <g>
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={y(value)}
        y2={y(value)}
        className="stroke-ink-soft"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={width - PAD.right} y={y(value) - 6} textAnchor="end" className="fill-ink-soft text-[12px]">
        {label}
      </text>
    </g>
  );
}

export type HourlyPoint = { hour: string; min: number; avg: number; max: number; label: string };

export function HeartRateChart({
  data,
  safeMin,
  safeMax,
  height = 240,
}: {
  data: HourlyPoint[];
  safeMin: number | null;
  safeMax: number | null;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const values = data.flatMap((d) => [d.min, d.max]).concat([safeMin, safeMax].filter((v): v is number => v !== null));
  const lo = Math.floor((Math.min(...values) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 5) / 10) * 10;
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (height - PAD.top - PAD.bottom);

  const band =
    data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.max)}`).join("") +
    data
      .map((d, i) => [d, i] as const)
      .reverse()
      .map(([d, i]) => `L${x(i)},${y(d.min)}`)
      .join("") +
    "Z";
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.avg)}`).join("");
  const labelEvery = Math.ceil(data.length / Math.max(Math.floor(innerW / 70), 1));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (data.length - 1));
    setActive(Math.min(Math.max(i, 0), data.length - 1));
  }

  const point = active === null ? null : data[active];

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Heart rate over the last 24 hours, hourly range and average">
          <YAxis ticks={niceTicks(lo, hi)} y={y} width={width} />
          {safeMax !== null && <ThresholdLine value={safeMax} label={`Safe max ${safeMax}`} y={y} width={width} />}
          {safeMin !== null && <ThresholdLine value={safeMin} label={`Safe min ${safeMin}`} y={y} width={width} />}
          <path d={band} className="fill-care" opacity={0.18} />
          <path d={line} className="fill-none stroke-care" strokeWidth={2} strokeLinejoin="round" />
          {data.map((d, i) =>
            safeMax !== null && d.max > safeMax ? (
              <circle key={d.hour} cx={x(i)} cy={y(d.max)} r={5} className="fill-rose stroke-surface" strokeWidth={2} />
            ) : null,
          )}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.hour} x={x(i)} y={height - 8} textAnchor="middle" className="fill-ink-soft text-[12px]">
                {d.label}
              </text>
            ) : null,
          )}
          {point && active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={height - PAD.bottom} className="stroke-ink-soft" strokeWidth={1} />
              <circle cx={x(active)} cy={y(point.avg)} r={5} className="fill-care stroke-surface" strokeWidth={2} />
            </g>
          )}
          <rect
            x={PAD.left}
            y={0}
            width={innerW}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {point && active !== null && (
        <Tooltip x={x(active)} width={width}>
          <strong>{point.label}</strong>
          <br />
          Average {Math.round(point.avg)} bpm
          <br />
          Range {Math.round(point.min)}–{Math.round(point.max)} bpm
        </Tooltip>
      )}
    </div>
  );
}

export type Bar = { key: string; label: string; value: number; tooltip: string; flagged?: boolean };

export function BarChart({
  data,
  ariaLabel,
  reference,
  height = 200,
}: {
  data: Bar[];
  ariaLabel: string;
  reference?: { value: number; label: string };
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const hi = Math.max(...data.map((d) => d.value), reference?.value ?? 0) * 1.1 || 1;
  const ticks = niceTicks(0, hi);
  const top = ticks.at(-1)! < hi ? hi : ticks.at(-1)!;
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const slot = innerW / data.length;
  const barW = Math.min(slot - 8, 48);
  const y = (v: number) => PAD.top + (1 - v / top) * (height - PAD.top - PAD.bottom);
  const base = y(0);

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <YAxis ticks={ticks} y={y} width={width} />
          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const h = Math.max(base - y(d.value), d.value > 0 ? 4 : 0);
            const r = Math.min(4, h);
            const left = cx - barW / 2;
            return (
              <g key={d.key}>
                {/* Rounded top, square base anchored to the axis */}
                <path
                  d={`M${left},${base}V${base - h + r}Q${left},${base - h} ${left + r},${base - h}H${left + barW - r}Q${left + barW},${base - h} ${left + barW},${base - h + r}V${base}Z`}
                  className={d.flagged ? "fill-marigold" : "fill-care"}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
                <text x={cx} y={height - 8} textAnchor="middle" className="fill-ink-soft text-[12px]">
                  {d.label}
                </text>
                <rect
                  x={cx - slot / 2}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
          {reference && <ThresholdLine value={reference.value} label={reference.label} y={y} width={width} />}
        </svg>
      )}
      {active !== null && (
        <Tooltip x={PAD.left + slot * active + slot / 2} width={width}>
          {data[active].tooltip}
        </Tooltip>
      )}
    </div>
  );
}

export type PressureReading = { key: string; label: string; systolic: number; diastolic: number; tooltip: string };

export function BloodPressureChart({
  data,
  maxSystolic,
  height = 240,
}: {
  data: PressureReading[];
  maxSystolic: number | null;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const values = data.flatMap((d) => [d.systolic, d.diastolic]).concat(maxSystolic ?? []);
  const lo = Math.floor((Math.min(...values) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 10) / 10) * 10;
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const slot = innerW / Math.max(data.length, 1);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (height - PAD.top - PAD.bottom);
  const labelEvery = Math.ceil(data.length / Math.max(Math.floor(innerW / 56), 1));

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Blood pressure readings over the last week, each bar spans diastolic to systolic">
          <YAxis ticks={niceTicks(lo, hi)} y={y} width={width} />
          {maxSystolic !== null && <ThresholdLine value={maxSystolic} label={`Safe max ${maxSystolic}`} y={y} width={width} />}
          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const high = maxSystolic !== null && d.systolic > maxSystolic;
            const fill = high ? "fill-rose" : "fill-care";
            return (
              <g key={d.key} opacity={active === null || active === i ? 1 : 0.55}>
                <rect x={cx - 3} y={y(d.systolic)} width={6} height={y(d.diastolic) - y(d.systolic)} rx={3} className={fill} opacity={0.45} />
                <circle cx={cx} cy={y(d.systolic)} r={4.5} className={`${fill} stroke-surface`} strokeWidth={2} />
                <circle cx={cx} cy={y(d.diastolic)} r={4.5} className={`${fill} stroke-surface`} strokeWidth={2} />
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="fill-ink-soft text-[12px]">
                    {d.label}
                  </text>
                )}
                <rect
                  x={cx - slot / 2}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && (
        <Tooltip x={PAD.left + slot * active + slot / 2} width={width}>
          {data[active].tooltip}
        </Tooltip>
      )}
    </div>
  );
}
