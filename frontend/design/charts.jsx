// JOOLA INTEL — SVG chart primitives. No external chart lib.

const { useState, useRef, useEffect, useMemo } = React;

// ---------------- Sparkline ----------------
function Sparkline({ data, w = 90, h = 30, color = "#22c55e", fill = true, strokeW = 1.5 }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = path + ` L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;
  const id = "sg-" + Math.random().toString(36).slice(2, 8);
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  );
}

// ---------------- Number formatting ----------------
function fmt(n, opts = {}) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (opts.money) {
    return "$" + (abs >= 1000 ? (n / 1000).toFixed(1) + "k" : n.toFixed(0));
  }
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 10_000) return (n / 1000).toFixed(0) + "K";
  if (abs >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}
function fmtPct(n) { return (n > 0 ? "+" : "") + n.toFixed(1) + "%"; }
function fmtDelta(n) { return (n > 0 ? "+" : "") + n.toLocaleString(); }

// ---------------- Delta pill ----------------
function Delta({ value, pct, suffix = "this wk" }) {
  if (value === 0) return <span className="delta flat">▬ flat <span className="vs">{suffix}</span></span>;
  const up = value > 0;
  return (
    <span className={"delta " + (up ? "up" : "down")}>
      {up ? "▲" : "▼"} {fmtDelta(value).replace(/^\+/, "")}{pct !== undefined ? ` (${fmtPct(pct)})` : ""}
      <span className="vs">{suffix}</span>
    </span>
  );
}

// ---------------- Multi-line trend chart ----------------
function LineChart({ series, w = 760, h = 260, yLabel = "" }) {
  const padL = 44, padR = 16, padT = 14, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const allVals = series.flatMap(s => s.data);
  const max = Math.max(...allVals);
  const min = 0;
  const N = series[0].data.length;
  const x = i => padL + (i / (N - 1)) * innerW;
  const y = v => padT + innerH - (v / max) * innerH;

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((max / yTicks) * i));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
          <text x={padL - 8} y={y(t) + 3} textAnchor="end" className="scatter-axis">{fmt(t)}</text>
        </g>
      ))}
      {/* X axis weeks */}
      {Array.from({ length: N }).map((_, i) => (
        <text key={i} x={x(i)} y={h - 10} textAnchor="middle" className="scatter-axis">W{i + 1}</text>
      ))}
      {series.map((s, si) => {
        const path = s.data.map((v, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(v)).join(" ");
        const isJoola = s.id === "joola";
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color}
              strokeWidth={isJoola ? 2.5 : 1.4}
              opacity={isJoola ? 1 : 0.65}
              strokeDasharray={isJoola ? "0" : "0"}
            />
            {isJoola && s.data.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={s.color} />
            ))}
            {/* End label */}
            <text x={x(N - 1) + 6} y={y(s.data[N - 1]) + 3} className="scatter-label"
              style={{ fill: s.color, fontSize: 10, fontWeight: 700 }}>
              {s.label}
            </text>
          </g>
        );
      })}
      {yLabel && <text x={10} y={padT + 6} className="scatter-axis" style={{fontWeight: 700}}>{yLabel}</text>}
    </svg>
  );
}

// ---------------- Stacked area chart ----------------
function StackedArea({ series, weeks = 13, w = 760, h = 240, colors }) {
  const padL = 36, padR = 12, padT = 12, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  // sum at each x
  const N = weeks;
  const x = i => padL + (i / (N - 1)) * innerW;
  const totals = Array.from({ length: N }, (_, i) => series.reduce((s, ser) => s + ser.data[i], 0));
  const yMax = Math.max(...totals) * 1.05;
  const y = v => padT + innerH - (v / yMax) * innerH;

  // Compute stacked baselines
  const stacks = [];
  for (let si = 0; si < series.length; si++) {
    const layer = [];
    for (let i = 0; i < N; i++) {
      const below = series.slice(0, si).reduce((s, ser) => s + ser.data[i], 0);
      layer.push({ x: x(i), yTop: y(below + series[si].data[i]), yBot: y(below) });
    }
    stacks.push(layer);
  }

  const ticks = 4;
  const yticks = Array.from({ length: ticks + 1 }, (_, i) => (yMax / ticks) * i);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {yticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.04)" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="scatter-axis">{Math.round(t)}</text>
        </g>
      ))}
      {Array.from({ length: N }).map((_, i) => (
        i % 2 === 0 && <text key={i} x={x(i)} y={h - 8} textAnchor="middle" className="scatter-axis">W{i + 1}</text>
      ))}
      {stacks.map((layer, si) => {
        const top = layer.map((p, i) => (i === 0 ? "M" : "L") + p.x + "," + p.yTop);
        const bot = layer.slice().reverse().map(p => "L" + p.x + "," + p.yBot);
        const d = top.join(" ") + " " + bot.join(" ") + " Z";
        return (
          <path key={si} d={d}
            fill={series[si].color}
            opacity={series[si].id === "joola" ? 0.95 : 0.7}
            stroke={series[si].color}
            strokeWidth="0.5"
          />
        );
      })}
    </svg>
  );
}

// ---------------- Scatter plot (engagement matrix) ----------------
function ScatterChart({ data, w = 760, h = 360 }) {
  const padL = 56, padR = 30, padT = 30, padB = 44;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  // x = followers (log-ish), y = eng rate
  const xMax = 150000, yMax = 2.5;
  const xMid = 50000, yMid = 1.0; // quadrant split
  const x = v => padL + (Math.min(v, xMax) / xMax) * innerW;
  const y = v => padT + innerH - (Math.min(v, yMax) / yMax) * innerH;

  // Bubble size from posts/ads volume
  const r = v => 5 + Math.min(v, 100) / 12;

  const [hover, setHover] = useState(null);

  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        {/* Grid */}
        <g className="scatter-grid">
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={"x" + i} x1={padL + t * innerW} x2={padL + t * innerW} y1={padT} y2={padT + innerH} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={"y" + i} x1={padL} x2={padL + innerW} y1={padT + t * innerH} y2={padT + t * innerH} />
          ))}
        </g>
        {/* Quadrant dividers */}
        <line x1={x(xMid)} x2={x(xMid)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.18)" strokeDasharray="3 3" />
        <line x1={padL} x2={padL + innerW} y1={y(yMid)} y2={y(yMid)} stroke="rgba(245,230,37,0.18)" strokeDasharray="3 3" />

        {/* Quadrant labels */}
        <text x={padL + 10} y={padT + 18} className="scatter-quadrant">High engagement · Small reach</text>
        <text x={padL + innerW - 10} y={padT + 18} textAnchor="end" className="scatter-quadrant" style={{fill:"#22c55e"}}>HIGH VALUE</text>
        <text x={padL + 10} y={padT + innerH - 10} className="scatter-quadrant">Underperforming</text>
        <text x={padL + innerW - 10} y={padT + innerH - 10} textAnchor="end" className="scatter-quadrant">Large reach · Low engagement</text>

        {/* Axes */}
        <g>
          {[10000, 30000, 50000, 80000, 114000, 150000].map((v, i) => (
            <text key={i} x={x(v)} y={h - 22} textAnchor="middle" className="scatter-axis">{fmt(v)}</text>
          ))}
          <text x={padL + innerW / 2} y={h - 6} textAnchor="middle" className="scatter-axis" style={{fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>FOLLOWERS →</text>
          {[0, 0.5, 1.0, 1.5, 2.0, 2.5].map((v, i) => (
            <text key={i} x={padL - 8} y={y(v) + 3} textAnchor="end" className="scatter-axis">{v.toFixed(1)}%</text>
          ))}
          <text transform={`translate(14 ${padT + innerH / 2}) rotate(-90)`} textAnchor="middle" className="scatter-axis" style={{fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>ENGAGEMENT RATE ↑</text>
        </g>

        {/* JOOLA crosshair */}
        <line x1={x(114200)} x2={x(114200)} y1={padT} y2={padT + innerH} stroke="#22c55e" strokeOpacity="0.25" />
        <line x1={padL} x2={padL + innerW} y1={y(0.55)} y2={y(0.55)} stroke="#22c55e" strokeOpacity="0.25" />

        {/* Dots */}
        {data.map((d, i) => {
          const cx = x(d.followers);
          const cy = y(d.engRate);
          const isJ = d.brand === "joola";
          return (
            <g key={i}
               onMouseEnter={() => setHover({ ...d, cx, cy })}
               onMouseLeave={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={r(d.posts || 30) + 4} fill={d.color} opacity="0.10" />
              <circle className="scatter-dot" cx={cx} cy={cy} r={r(d.posts || 30)}
                fill={d.color} opacity={isJ ? 1 : 0.85}
                stroke={isJ ? "#fff" : "rgba(0,0,0,0.4)"} strokeWidth={isJ ? 2 : 1} />
              <text x={cx} y={cy - r(d.posts || 30) - 6} textAnchor="middle" className="scatter-label"
                style={{fontWeight: isJ ? 800 : 600, fill: isJ ? "#22c55e" : "#e2e8f0"}}>
                {d.name}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tip" style={{ left: hover.cx * (100 / 760) + "%", top: hover.cy / 360 * 100 + "%" }}>
          <div className="t-name">{hover.name}</div>
          {fmt(hover.followers)} followers · {hover.engRate.toFixed(2)}% eng
        </div>
      )}
    </div>
  );
}

// ---------------- Donut chart ----------------
function Donut({ data, size = 200, thickness = 36, centerLabel, centerSub }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - thickness / 2 - 2;
  const cx = size / 2, cy = size / 2;
  let start = -Math.PI / 2;
  const arcs = data.map(d => {
    const angle = (d.value / total) * Math.PI * 2;
    const end = start + angle;
    const a = describeArc(cx, cy, r, start, end);
    start = end;
    return { d: a, color: d.color, value: d.value, name: d.name };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={thickness} />
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="butt" />
      ))}
      {centerLabel && (
        <g>
          <text x={cx} y={cy - 2} textAnchor="middle" className="scatter-label"
            style={{fontSize: 22, fontWeight: 800, fill: "#fff", fontFamily: "Archivo Black"}}>
            {centerLabel}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="scatter-label"
            style={{fontSize: 9, fill: "#8a93a4", letterSpacing: "0.14em", textTransform: "uppercase"}}>
            {centerSub}
          </text>
        </g>
      )}
    </svg>
  );
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

// ---------------- Box plot per brand ----------------
function BoxPlot({ data, w = 760, h = 280 }) {
  const padL = 100, padR = 24, padT = 20, padB = 36;
  const innerH = h - padT - padB;
  const innerW = w - padL - padR;
  const rowH = innerH / data.length;
  const maxVal = Math.max(...data.map(d => d.max));
  const x = v => padL + (v / maxVal) * innerW;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      {[0, 50, 100, 150, 200, 250, 300].map((v, i) => (
        <g key={i}>
          <line x1={x(v)} x2={x(v)} y1={padT} y2={padT + innerH} stroke="rgba(255,255,255,0.04)" />
          <text x={x(v)} y={h - 12} textAnchor="middle" className="scatter-axis">${v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const y = padT + i * rowH + rowH / 2;
        const isJ = d.brand === "joola";
        return (
          <g key={i}>
            <text x={padL - 10} y={y + 3} textAnchor="end" className="scatter-label"
              style={{fill: isJ ? "#22c55e" : "#e2e8f0", fontWeight: isJ ? 800 : 600, fontSize: 11}}>
              {d.name}
            </text>
            {/* Whiskers */}
            <line x1={x(d.min)} x2={x(d.max)} y1={y} y2={y} stroke={d.color} strokeOpacity="0.4" />
            <line x1={x(d.min)} x2={x(d.min)} y1={y - 6} y2={y + 6} stroke={d.color} strokeOpacity="0.6" />
            <line x1={x(d.max)} x2={x(d.max)} y1={y - 6} y2={y + 6} stroke={d.color} strokeOpacity="0.6" />
            {/* Box (~ avg ± 25%) */}
            <rect x={x(d.avg * 0.85)} y={y - 9} width={x(d.avg * 1.15) - x(d.avg * 0.85)} height="18"
              fill={d.color} opacity={isJ ? 0.65 : 0.3} stroke={d.color} strokeWidth="1" />
            {/* Median tick */}
            <line x1={x(d.med)} x2={x(d.med)} y1={y - 11} y2={y + 11} stroke={d.color} strokeWidth="2" />
            {/* Avg label */}
            <text x={x(d.max) + 8} y={y + 3} className="scatter-label" style={{fontSize: 10, fill: "#cbd1dc"}}>
              avg ${d.avg} · {d.count} items
            </text>
          </g>
        );
      })}
      <text x={padL + innerW / 2} y={h - 2} textAnchor="middle" className="scatter-axis"
        style={{fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase"}}>
        PRICE ($) · low → high
      </text>
    </svg>
  );
}

// ---------------- Stacked horizontal bar (sentiment) ----------------
function SentimentBar({ data }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d, i) => {
        const total = d.positive + d.neutral + d.negative;
        const isJ = d.brand === "joola";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 60px 50px", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: isJ ? "#22c55e" : "#cbd1dc" }}>{d.name}</div>
            <div style={{ display: "flex", height: 20, borderRadius: 3, overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ width: (d.positive / total * 100) + "%", background: "#22c55e", opacity: 0.85 }} title={`Positive: ${d.positive}`} />
              <div style={{ width: (d.neutral / total * 100) + "%", background: "#94a3b8", opacity: 0.5 }} title={`Neutral: ${d.neutral}`} />
              <div style={{ width: (d.negative / total * 100) + "%", background: "#ef4444", opacity: 0.85 }} title={`Negative: ${d.negative}`} />
            </div>
            <div style={{ fontFamily: "JetBrains Mono", fontSize: 11, color: "#cbd1dc", fontWeight: 600 }}>
              {d.mentions} mentions
            </div>
            <div className={"cell-delta " + (d.delta >= 0 ? "up" : "down")} style={{ textAlign: "right" }}>
              {d.delta >= 0 ? "▲" : "▼"}{Math.abs(d.delta)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { Sparkline, fmt, fmtPct, fmtDelta, Delta, LineChart, StackedArea, ScatterChart, Donut, BoxPlot, SentimentBar, PricePositionScatter });

// ---------------- Price × catalog position scatter ----------------
function PricePositionScatter() {
  const D = window.JOOLA_DATA;
  const w = 380, h = 280;
  const padL = 40, padR = 14, padT = 20, padB = 36;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const xMax = 60, yMax = 280;
  const x = v => padL + (v / xMax) * innerW;
  const y = v => padT + innerH - (v / yMax) * innerH;
  const c = id => D.BRANDS.find(b => b.id === id)?.color || "#888";
  const n = id => D.BRANDS.find(b => b.id === id)?.name || id;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      <line x1={x(30)} x2={x(30)} y1={padT} y2={padT + innerH} stroke="rgba(245,230,37,0.2)" strokeDasharray="3 3" />
      <line x1={padL} x2={padL + innerW} y1={y(170)} y2={y(170)} stroke="rgba(245,230,37,0.2)" strokeDasharray="3 3" />
      <text x={padL + 4} y={padT + 12} className="scatter-quadrant" style={{ fontSize: 9 }}>PREMIUM × LEAN</text>
      <text x={padL + innerW - 4} y={padT + 12} textAnchor="end" className="scatter-quadrant" style={{ fontSize: 9, fill: "#22c55e" }}>PREMIUM × WIDE</text>
      <text x={padL + 4} y={padT + innerH - 6} className="scatter-quadrant" style={{ fontSize: 9 }}>VALUE × LEAN</text>
      <text x={padL + innerW - 4} y={padT + innerH - 6} textAnchor="end" className="scatter-quadrant" style={{ fontSize: 9 }}>VALUE × WIDE</text>
      {[0, 15, 30, 45, 60].map((v, i) => (<text key={i} x={x(v)} y={h - 16} textAnchor="middle" className="scatter-axis">{v}</text>))}
      {[0, 100, 200, 280].map((v, i) => (<text key={i} x={padL - 6} y={y(v) + 3} textAnchor="end" className="scatter-axis">${v}</text>))}
      <text x={padL + innerW / 2} y={h - 2} textAnchor="middle" className="scatter-axis" style={{ fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>CATALOG SIZE →</text>
      {D.products.map((p, i) => {
        const isJ = p.brand === "joola";
        return (
          <g key={i}>
            <circle cx={x(p.count)} cy={y(p.avg)} r={isJ ? 9 : 6} fill={c(p.brand)} opacity={isJ ? 1 : 0.85} stroke={isJ ? "#fff" : "rgba(0,0,0,0.4)"} strokeWidth={isJ ? 2 : 1} />
            <text x={x(p.count)} y={y(p.avg) - (isJ ? 13 : 10)} textAnchor="middle" className="scatter-label" style={{ fontSize: 9, fontWeight: isJ ? 800 : 600, fill: isJ ? "#22c55e" : "#cbd1dc" }}>{n(p.brand)}</text>
          </g>
        );
      })}
    </svg>
  );
}
