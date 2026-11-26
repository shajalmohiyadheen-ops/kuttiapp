"use client";

import { useId, useState } from "react";
import { formatSar } from "@expresscash/shared";

const money = (cents: number) => formatSar(cents, { halalas: true });
const short = (cents: number) => (cents >= 100000_00 ? `SAR ${+(cents / 100000).toFixed(1)}k` : money(cents));

/** Fixed slot order for categories (validated for colour-blind separation in both themes). Never cycled: extras fold into "Other". */
const SLOTS = 6;
export const sliceColor = (i: number) => (i < SLOTS ? `var(--series-${i + 1})` : "var(--series-other)");

export interface Slice { label: string; cents: number }

/** Donut with the total in the centre; hovering a slice or its legend row shows that slice instead. */
export function Donut({ data, title }: { data: Slice[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...data].filter((d) => d.cents > 0).sort((a, b) => b.cents - a.cents);
  const slices = sorted.length > SLOTS ? [...sorted.slice(0, SLOTS - 1), { label: "Other", cents: sorted.slice(SLOTS - 1).reduce((a, d) => a + d.cents, 0) }] : sorted;
  const total = slices.reduce((a, d) => a + d.cents, 0);
  const R = 80, W = 22, C = 2 * Math.PI * R;
  const offsets = slices.map((_, i) => slices.slice(0, i).reduce((a, d) => a + (d.cents / total) * C, 0));
  const shown = hover === null ? null : slices[hover];
  const colorOf = (i: number) => (slices[i].label === "Other" ? "var(--series-other)" : sliceColor(i));
  const uid = useId().replace(/:/g, "");
  return (
    <div className="chart-card">
      <div className="chart-head"><h3>{title}</h3></div>
      {total === 0 ? (
        <p className="muted chart-empty">No spending yet.</p>
      ) : (
        <div className="donut-wrap">
          <svg viewBox="0 0 200 200" className="donut" role="img" aria-label={`${title}: total ${money(total)}`}>
            <defs>
              {slices.map((d, i) => (
                <linearGradient key={d.label} id={`${uid}-s${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${colorOf(i)} 78%, white)` }} />
                  <stop offset="1" style={{ stopColor: colorOf(i) }} />
                </linearGradient>
              ))}
            </defs>
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--track)" strokeWidth={W} />
            <g className="donut-g">
            {slices.map((d, i) => {
              const len = (d.cents / total) * C;
              const gap = slices.length > 1 ? Math.min(2.5, len / 3) : 0;
              return (
                <circle key={d.label} className={hover === i ? "slice on" : "slice"} cx="100" cy="100" r={R} fill="none" stroke={`url(#${uid}-s${i})`} strokeWidth={hover === i ? W + 6 : W}
                  strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 100 100)"
                  style={{ "--c": colorOf(i) } as React.CSSProperties} opacity={hover === null || hover === i ? 1 : 0.35}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <title>{`${d.label}: ${money(d.cents)} (${Math.round((d.cents / total) * 100)}%)`}</title>
                </circle>
              );
            })}
            </g>
            <text x="100" y="92" textAnchor="middle" className="donut-label">{shown ? shown.label.slice(0, 18) : "Total spent"}</text>
            <text x="100" y="116" textAnchor="middle" className="donut-value">{short(shown ? shown.cents : total)}</text>
          </svg>
          <ul className="legend">
            {slices.map((d, i) => (
              <li key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? "on" : undefined}>
                <span className="dot" style={{ background: colorOf(i) }} />
                <span className="name">{d.label}</span>
                <span className="amt">{money(d.cents)} <span className="pct">· {Math.round((d.cents / total) * 100)}%</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface Bar { label: string; sub?: string; cents: number; current?: boolean }

/** Vertical bars, one series, rounded tops anchored to the baseline, hover tooltip per bar. */
export function Bars({ data, title, legend }: { data: Bar[]; title: string; legend: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.cents));
  const anyCurrent = data.some((d) => d.current);
  const step = niceStep(max / 100 / 4);
  const top = Math.max(step, Math.ceil(max / 100 / step) * step);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i).filter((v, i, a) => a.indexOf(v) === i);
  const H = 180, L = 44, B = 26, T = 8, Wd = 520;
  const bw = Math.min(46, ((Wd - L) / Math.max(1, data.length)) * 0.55);
  const uid = useId().replace(/:/g, "");
  const x = (i: number) => L + ((Wd - L) / data.length) * (i + 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  return (
    <div className="chart-card">
      <div className="chart-head"><h3>{title}</h3></div>
      <div className="bars-wrap">
        <svg viewBox={`0 0 ${Wd} ${H}`} className="bars" role="img" aria-label={title}>
          <defs>
            <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--grad-b)" }} />
              <stop offset="1" style={{ stopColor: "var(--grad-a)" }} />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={Wd} y1={y(v)} y2={y(v)} className={v === 0 ? "axis" : "grid"} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="tick">{compact(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const h = Math.max(0, y(0) - y(d.cents / 100));
            const r = Math.min(5, bw / 2, h);
            const x0 = x(i) - bw / 2, y0 = y(0) - h;
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={x(i) - ((Wd - L) / data.length) / 2} y={T} width={(Wd - L) / data.length} height={H - T - B} fill="transparent" />
                {h > 0 && (
                  <path d={`M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y(0)} Z`}
                    className={["bar", hover === i && "on", d.current && "current", anyCurrent && !d.current && hover !== i && "dim"].filter(Boolean).join(" ")} style={{ animationDelay: `${i * 70}ms` }}
                    fill={`url(#${uid}-bar)`} opacity={hover === null || hover === i ? undefined : 0.45} />
                )}
                <text x={x(i)} y={H - 8} textAnchor="middle" className={d.current ? "tick current" : "tick"}>{d.label}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <div className="bar-tip" style={{ left: `${(x(hover) / Wd) * 100}%`, top: `${(y(data[hover].cents / 100) / H) * 100}%` }}>
            <div className="small muted">{data[hover].sub ?? data[hover].label}</div>
            <strong>{money(data[hover].cents)}</strong>
          </div>
        )}
      </div>
      <div className="chart-foot"><span className="dot" style={{ background: "var(--grad)" }} /> {legend}</div>
    </div>
  );
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function compact(v: number) {
  return v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v));
}
