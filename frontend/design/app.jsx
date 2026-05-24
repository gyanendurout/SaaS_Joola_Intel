// JOOLA INTEL — Executive Dashboard composition.

const D = window.JOOLA_DATA;
const BRAND_BY_ID = Object.fromEntries(D.BRANDS.map(b => [b.id, b]));
const brandColor = id => BRAND_BY_ID[id]?.color || "#888";
const brandName  = id => BRAND_BY_ID[id]?.name || id;

// ---------------- Icons (minimal inline) ----------------
const I = {
  overview: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>,
  ig: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/></svg>,
  yt: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor"/></svg>,
  reddit: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9 16c1 1 4 1 6 0"/></svg>,
  ads: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l16-6v14L3 13z"/><path d="M11 11v8"/></svg>,
  promo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 4L8 16l-4-4"/><circle cx="6" cy="6" r="2"/></svg>,
  product: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>,
  inf: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M15 19c0-2 2-3 4-3"/></svg>,
  mkt: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/></svg>,
  comments: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 11-3.5-6.6L21 4l-1.4 3.4A8 8 0 0121 12z"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>,
  bell: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>,
  refresh: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4v6h-6"/><path d="M3 20v-6h6"/><path d="M3 10a9 9 0 0114-4l4 4"/><path d="M21 14a9 9 0 01-14 4l-4-4"/></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>,
  warn: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3l10 18H2z"/><path d="M12 10v5" stroke="currentColor"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>,
  arrow: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
};

// ---------------- Sidebar ----------------
function Sidebar({ active, setActive }) {
  const items = [
    { id: "overview", label: "Executive Overview", ic: I.overview, badge: "LIVE" },
    { id: "instagram", label: "Instagram", ic: I.ig, badge: "250" },
    { id: "youtube", label: "YouTube", ic: I.yt, badge: "391" },
    { id: "reddit", label: "Reddit & Community", ic: I.reddit, badge: "362" },
    { id: "comments", label: "Comments Intel", ic: I.comments, badge: "2.9K" },
    { id: "influencers", label: "Influencer Network", ic: I.inf, badge: "27" },
    { id: "ads", label: "Ads Library", ic: I.ads, badge: "735" },
    { id: "promos", label: "Promotions", ic: I.promo, badge: "27" },
    { id: "products", label: "Product Catalog", ic: I.product, badge: "238" },
    { id: "mkt", label: "Market Intel", ic: I.mkt, badge: "" },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img src="assets/JOOLA_Trinity_Yellow.png" alt="JOOLA" />
        </div>
        <div className="brand-text">
          <span className="a">JOOLA</span> <span className="b">INTEL</span>
          <span className="s">Pickleball Intelligence</span>
        </div>
      </div>

      <div className="nav-section">
        <h6>Channels</h6>
        {items.map(it => (
          <a key={it.id} className={"nav-item " + (active === it.id ? "active" : "")}
             onClick={(e) => { e.preventDefault(); setActive(it.id); }}>
            <span className="ic">{it.ic}</span>
            <span>{it.label}</span>
            {it.badge && <span className="badge">{it.badge}</span>}
          </a>
        ))}
      </div>

      <div className="nav-section">
        <h6>Saved Views</h6>
        <a className="nav-item">
          <span className="ic" style={{color: "#F5E625"}}>★</span>
          <span>JOOLA vs Selkirk</span>
        </a>
        <a className="nav-item">
          <span className="ic" style={{color: "#F5E625"}}>★</span>
          <span>Weekly Briefing</span>
        </a>
      </div>

      <div className="sidebar-foot">
        <span className="live-dot"></span>
        <div>
          <div style={{ color: "#cbd1dc", fontWeight: 600, fontSize: 12 }}>Live data</div>
          <div>Mon · 07:00 IST · synced</div>
        </div>
      </div>
    </aside>
  );
}

// ---------------- Header ----------------
function PageHeader({ period, setPeriod, compare, setCompare }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "#F5E625", boxShadow: "0 0 0 4px rgba(245,230,37,0.18)" }}></span>
          LIVE INTELLIGENCE · WEEK 20 · MON 7:00 AM IST
        </div>
        <h1>Executive <em>briefing</em></h1>
        <div className="sub">JOOLA's competitive position across 11 brands, 5,500 data points, refreshed every Monday. What changed, what it means, and what to do.</div>
      </div>
      <div className="head-actions">
        <button className="btn btn-ghost">{I.search}<span>Search · <span className="kbd">⌘K</span></span></button>
        <select className="select" value={compare} onChange={e => setCompare(e.target.value)}>
          <option value="">JOOLA vs. all brands</option>
          {D.BRANDS.filter(b => !b.joola).map(b => (
            <option key={b.id} value={b.id}>JOOLA vs. {b.name}</option>
          ))}
        </select>
        <select className="select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option>This week</option>
          <option>Last 30 days</option>
          <option>This quarter</option>
          <option>All time</option>
        </select>
        <button className="btn">{I.refresh}Refresh</button>
        <button className="btn btn-yellow">{I.download}Export brief</button>
      </div>
    </header>
  );
}

// ---------------- Section nav ----------------
function SectionNav({ active, setActive }) {
  const items = [
    ["briefing", "Today's briefing"],
    ["pulse", "Pulse"],
    ["movers", "Movers"],
    ["matrix", "Engagement matrix"],
    ["ads", "Ads & spend"],
    ["promos", "Pricing war"],
    ["reddit", "Community"],
    ["influencers", "Influencers"],
    ["products", "Catalog"],
    ["opps", "Opportunities"],
  ];
  return (
    <nav className="section-nav">
      {items.map(([id, label]) => (
        <a key={id} className={"snav-item " + (active === id ? "active" : "")}
           href={"#" + id}
           onClick={() => setActive(id)}>{label}</a>
      ))}
    </nav>
  );
}

// ---------------- Briefing module ----------------
function Briefing() {
  const cards = [
    {
      kind: "crisis", tag: "🔴 Threat",
      title: "Selkirk launched 12 new ads — outpacing JOOLA by 6 this week.",
      body: "Selkirk Sport now runs 144 active campaigns vs. JOOLA's 92. Their Google share is 73% — built around 'VANGUARD POWER AIR' and Catherine Parenteau creatives.",
      action: "Open ad creative comparison",
    },
    {
      kind: "crisis", tag: "🔴 Pricing pressure",
      title: "JOOLA is the only top-3 brand with no active promotion.",
      body: "Selkirk runs 13 promos, Franklin 9. Combined: 48% of all tracked discounts in market. JOOLA last ran sitewide on Feb 14.",
      action: "Draft Memorial Day plan",
    },
    {
      kind: "threat", tag: "🟡 Engagement gap",
      title: "Franklin's engagement rate (1.80%) beats JOOLA for the 3rd week.",
      body: "Wilson, Engage, Franklin, Six Zero, CRBN all outperform JOOLA on engagement despite 4–10x smaller audiences. JOOLA's 114K is 8th by rate.",
      action: "Run content-format audit",
    },
    {
      kind: "opportunity", tag: "🟢 Opportunity",
      title: "Onix Sports showing brand distress — clearance pricing on Z5 line.",
      body: "Lowest engagement (0.06%), followers declining, paddles re-listed at $69. Their audience is searchable and conversion-ready.",
      action: "Target Onix audience with Magnus",
    },
  ];

  return (
    <section id="briefing">
      <div className="section-head">
        <div>
          <h2>Today's briefing</h2>
          <div className="sub">Four auto-generated signals derived from this week's data — read in 30 seconds.</div>
        </div>
        <div className="actions">
          <span className="pill pill-yellow">AUTO · 7:02 AM</span>
          <a className="section-link">View all 9 signals →</a>
        </div>
      </div>
      <div className="briefing-strip">
        {cards.map((c, i) => (
          <div key={i} className={"brief-card fade-up " + c.kind}>
            <div className="severity"></div>
            <div className="tag">{c.tag}</div>
            <h4>{c.title}</h4>
            <p>{c.body}</p>
            <div className="action">{c.action} {I.arrow}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- KPI strip ----------------
function KpiStrip() {
  const k = [
    { label: "JOOLA IG followers", value: "114.2K", delta: +1240, deltaPct: +1.1, spark: D.ig.find(x => x.brand === "joola").trend, color: "#22c55e", flavor: "joola", src: "ig_profiles_weekly" },
    { label: "JOOLA Eng. rate", value: "0.55%", delta: -0.03, deltaPct: -5.2, spark: [0.62,0.60,0.59,0.58,0.57,0.57,0.56,0.55], color: "#ef4444", flavor: "danger", src: "ig_posts · 250", customDelta: "▼ 0.03 pts" },
    { label: "Active ads (all)", value: "735", delta: +28, deltaPct: +4.0, spark: [665,672,684,691,702,714,721,735], color: "#f59e0b", flavor: "warn", src: "marketing_ads", customVs: "JOOLA: 92 · 12.5% share" },
    { label: "Most active advertiser", value: "Selkirk", delta: +12, deltaPct: null, spark: [128,131,133,136,139,141,142,144], color: "#F5E625", flavor: "warn", src: "marketing_ads", customDelta: "▲ 12 new this wk", customVs: "144 active · 19.6% share" },
    { label: "Active promos (market)", value: "27", delta: +4, deltaPct: +17.4, spark: [18,19,21,22,23,24,25,27], color: "#D6182A", flavor: "danger", src: "promotions", customVs: "JOOLA: 0 · last on Feb 14" },
    { label: "Reddit mentions (JOOLA)", value: "92", delta: +14, deltaPct: +18.0, spark: [62,68,72,76,80,84,88,92], color: "#22c55e", flavor: "joola", src: "reddit_mentions" },
    { label: "Tracked athletes", value: "27", delta: +2, deltaPct: null, spark: [25,25,25,25,26,26,27,27], color: "#818cf8", flavor: "", src: "influencers", customVs: "JOOLA: 8 · 24% reach" },
    { label: "Products tracked", value: "238", delta: +6, deltaPct: +2.6, spark: [218,221,224,226,229,232,234,238], color: "#cbd1dc", flavor: "", src: "products", customVs: "JOOLA catalog: 56 (#1)" },
  ];
  return (
    <section id="pulse">
      <div className="section-head">
        <div>
          <h2>The pulse — 8 metrics, all with deltas</h2>
          <div className="sub">Every number shows what moved this week. Click any card to drill in.</div>
        </div>
      </div>
      <div className="kpi-grid">
        {k.slice(0, 4).map((c, i) => <KpiCard key={i} {...c} />)}
      </div>
      <div className="kpi-grid">
        {k.slice(4).map((c, i) => <KpiCard key={i} {...c} />)}
      </div>
    </section>
  );
}
function KpiCard({ label, value, delta, deltaPct, spark, color, flavor, src, customDelta, customVs }) {
  return (
    <div className={"kpi " + flavor}>
      <div className="label">
        <span>{label}</span>
        <span className="src">{src}</span>
      </div>
      <div className="row">
        <div className="value">{value}</div>
        <div className="spark"><Sparkline data={spark} color={color} /></div>
      </div>
      <div className={"delta " + (delta > 0 ? "up" : delta < 0 ? "down" : "flat")}>
        {customDelta || (delta > 0 ? "▲" : delta < 0 ? "▼" : "▬") + " " + fmtDelta(delta).replace(/^[+-]/, "")}
        {deltaPct !== null && deltaPct !== undefined && !customDelta ? ` (${fmtPct(deltaPct)})` : ""}
        <span className="vs">{customVs || "vs. last wk"}</span>
      </div>
    </div>
  );
}

// ---------------- Movers + signal feed ----------------
function MoversAndSignals() {
  // Sort IG by delta
  const winners = [...D.ig].sort((a, b) => b.deltaPct - a.deltaPct).slice(0, 5);
  const losers  = [...D.ig].sort((a, b) => a.deltaPct - b.deltaPct).slice(0, 5);

  return (
    <section id="movers">
      <div className="section-head">
        <div>
          <h2>This week's movers</h2>
          <div className="sub">Who gained, who slipped, what they're doing about it.</div>
        </div>
        <div className="actions">
          <div className="chip-row">
            <button className="chip on">Followers</button>
            <button className="chip">Engagement</button>
            <button className="chip">Ad spend</button>
            <button className="chip">Reddit</button>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>↑ Top gainers · IG followers % growth</h3>
            <span className="meta">wk over wk</span>
          </div>
          {winners.map((w, i) => (
            <div key={w.brand} className={"mover-row " + (w.brand === "joola" ? "joola" : "")}>
              <div className="rank">#{i + 1}</div>
              <div className="brand">
                <span className="brand-dot" style={{ background: brandColor(w.brand) }}></span>
                <span className="name">{brandName(w.brand)}</span>
              </div>
              <div className="value">{fmt(w.followers)}</div>
              <div className="delta up">+{fmtPct(w.deltaPct)}</div>
            </div>
          ))}
          <div className="card-head" style={{ borderTop: "1px solid var(--line)", borderBottom: 0, paddingTop: 14 }}>
            <h3>↓ Slipping</h3>
            <span className="meta">wk over wk</span>
          </div>
          {losers.filter(l => l.deltaPct < 0).map((w, i) => (
            <div key={w.brand} className="mover-row">
              <div className="rank">#{i + 1}</div>
              <div className="brand">
                <span className="brand-dot" style={{ background: brandColor(w.brand) }}></span>
                <span className="name">{brandName(w.brand)}</span>
              </div>
              <div className="value">{fmt(w.followers)}</div>
              <div className="delta down">{fmtPct(w.deltaPct)}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Competitor activity feed</h3>
            <span className="meta">last 72h</span>
          </div>
          {D.signals.map((s, i) => (
            <div key={i} className="signal">
              <span className={"sig-tag " + s.type}>{s.type === "ad" ? "AD" : s.type === "promo" ? "PROMO" : s.type === "social" ? "SOCIAL" : s.type === "reddit" ? "REDDIT" : "PRODUCT"}</span>
              <span className="brand-pill">
                <span className="brand-dot" style={{ background: brandColor(s.brand) }}></span>
                {brandName(s.brand)}
              </span>
              <span className="desc">{s.desc}</span>
              <span className="when">{s.when}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------- Engagement matrix (scatter) ----------------
function EngagementMatrix() {
  const data = D.ig.map(d => ({
    brand: d.brand, name: brandName(d.brand), color: brandColor(d.brand),
    followers: d.followers, engRate: d.engRate, posts: 30,
  }));
  return (
    <section id="matrix">
      <div className="section-head">
        <div>
          <h2>The engagement matrix</h2>
          <div className="sub">Reach (followers) vs. resonance (engagement rate). The yellow crosshair is JOOLA — anything top-right of it is winning the audience JOOLA has built.</div>
        </div>
        <div className="actions">
          <span className="pill pill-ghost">11 brands · ig_posts · ig_profiles_weekly</span>
        </div>
      </div>
      <div className="card">
        <div className="card-pad-lg">
          <ScatterChart data={data} />
          <div className="legend" style={{ marginTop: 12 }}>
            <span className="item"><span className="swatch" style={{background:"#22c55e"}}></span>JOOLA (anchor)</span>
            <span className="item"><span className="swatch" style={{background:"rgba(245,230,37,0.4)"}}></span>JOOLA benchmark crosshair</span>
            <span className="item" style={{marginLeft:"auto",color:"var(--fg-4)"}}>bubble size = avg posts/wk</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- IG follower growth (line) ----------------
function IGGrowth() {
  const series = D.ig.slice(0, 7).map(d => ({
    id: d.brand,
    label: brandName(d.brand),
    color: brandColor(d.brand),
    data: d.trend,
  }));
  return (
    <section id="ig-growth">
      <div className="section-head">
        <div>
          <h2>Instagram · 8-week follower trajectory</h2>
          <div className="sub">JOOLA's lead is shrinking. CRBN closed the gap by 6.1% in 8 weeks — at current pace they cross 60K by July.</div>
        </div>
        <div className="actions">
          <div className="chip-row">
            <button className="chip on">Top 7</button>
            <button className="chip">All 11</button>
            <span className="chip-divider"></span>
            <button className="chip on">Followers</button>
            <button className="chip">Engagement</button>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-pad">
          <LineChart series={series} />
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 24 }}>
        <div>
          <h2>Followers · benchmark vs. JOOLA</h2>
          <div className="sub">Yellow line marks JOOLA's 114.2K. Sparklines show 8-wk shape.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-pad">
          {D.ig.map(d => {
            const max = 120000;
            return (
              <div key={d.brand} className={"bar-row " + (d.brand === "joola" ? "joola" : "")}>
                <div className="lbl">{brandName(d.brand)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: Math.max(2, (d.followers / max) * 100) + "%",
                    background: `linear-gradient(90deg, ${brandColor(d.brand)}, ${brandColor(d.brand)}99)`,
                  }}>
                    {fmt(d.followers)}
                  </div>
                </div>
                <div className="spark-mini"><Sparkline data={d.trend} color={brandColor(d.brand)} w={70} h={20} fill={false} strokeW={1.5} /></div>
                <div className={"delta-mini " + (d.deltaPct > 0 ? "up" : d.deltaPct < 0 ? "down" : "flat")}>
                  {fmtPct(d.deltaPct)}
                </div>
              </div>
            );
          })}
          {/* JOOLA benchmark line: simple visual cue */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
            <span className="pill pill-green">JOOLA BENCHMARK</span>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>114.2K followers · +1,240 this week (+1.1%) — line shown in green on all comparisons.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- Ads section ----------------
function AdsSection() {
  // Stacked area: 13 weeks
  const series = [
    { id: "selkirk",   label: "Selkirk",   color: brandColor("selkirk"),   data: [108,112,118,121,124,127,130,133,135,137,140,142,144] },
    { id: "crbn",      label: "CRBN",      color: brandColor("crbn"),      data: [102,106,110,114,118,122,125,128,131,134,137,139,141] },
    { id: "paddletek", label: "Paddletek", color: brandColor("paddletek"), data: [115,114,112,111,110,108,107,106,105,104,103,102,102] },
    { id: "joola",     label: "JOOLA",     color: brandColor("joola"),     data: [76,78,80,82,83,85,86,87,88,89,90,91,92] },
    { id: "franklin",  label: "Franklin",  color: brandColor("franklin"),  data: [62,64,67,69,71,72,73,74,75,76,77,77,78] },
    { id: "engage",    label: "Engage",    color: brandColor("engage"),    data: [44,45,47,49,51,52,53,54,55,56,57,57,58] },
    { id: "other",     label: "Others",   color: "#3a4150",               data: [70,72,75,76,78,80,82,84,86,88,90,92,94] },
  ];

  const platformDonut = [
    { name: "Google Search", value: 574, color: "#4ade80" },
    { name: "Google Display", value: 0, color: "#22c55e" },
    { name: "Meta Feed", value: 102, color: "#818cf8" },
    { name: "Meta Reels", value: 35, color: "#a855f7" },
    { name: "Meta Stories", value: 20, color: "#ec4899" },
  ];

  return (
    <section id="ads">
      <div className="section-head">
        <div>
          <h2>Ad activity · 735 creatives across 11 brands</h2>
          <div className="sub">Selkirk and CRBN have been climbing for 13 weeks straight. Paddletek pulling back. JOOLA growing slowly.</div>
        </div>
        <div className="actions">
          <div className="chip-row">
            <button className="chip on">All</button>
            <button className="chip">Meta</button>
            <button className="chip">Google</button>
            <button className="chip">Active only</button>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Ad volume over time · stacked by brand</h3>
            <span className="meta">last 13 wks · marketing_ads</span>
          </div>
          <div className="card-pad">
            <StackedArea series={series} weeks={13} />
            <div className="legend" style={{ marginTop: 10 }}>
              {series.map(s => (
                <span key={s.id} className="item">
                  <span className="swatch" style={{ background: s.color, opacity: s.id === "joola" ? 0.95 : 0.7 }}></span>{s.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Platform mix</h3>
            <span className="meta">735 total · 78% Google</span>
          </div>
          <div className="card-pad" style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <Donut data={platformDonut} size={170} thickness={28} centerLabel="735" centerSub="creatives" />
            <div className="donut-legend" style={{ flex: 1 }}>
              {platformDonut.map((p, i) => (
                <div key={i} className="row">
                  <span className="swatch" style={{ background: p.color }}></span>
                  <span className="name">{p.name}</span>
                  <span className="val">{p.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ad table — REDESIGNED from card grid */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>Ad library · 9 of 735 — filterable, searchable, readable</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="select" style={{ width: 220 }} placeholder="Search ad copy, CTA, athlete…" />
            <button className="btn btn-ghost" style={{ padding: "6px 10px" }}>Export CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Platform</th>
                <th style={{ width: "44%" }}>Copy</th>
                <th>CTA</th>
                <th>First seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {D.adSample.map((a, i) => (
                <tr key={i} className={a.brand === "joola" ? "joola" : ""}>
                  <td>
                    <span className="brand-pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="brand-dot" style={{ background: brandColor(a.brand) }}></span>
                      <span style={{ fontWeight: 700, color: a.brand === "joola" ? "#22c55e" : "var(--fg)" }}>{brandName(a.brand)}</span>
                    </span>
                  </td>
                  <td><span className={"pill " + (a.platform === "Meta" ? "pill-info" : "pill-amber")}>{a.platform}</span></td>
                  <td style={{ color: "var(--fg)" }}>{a.copy}</td>
                  <td><span className="pill pill-ghost">{a.cta}</span></td>
                  <td className="cell-num">{a.started}</td>
                  <td>{a.active ? <span className="pill pill-green">ACTIVE</span> : <span className="pill pill-ghost">PAUSED</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ads by brand bar */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h3>Total ads by brand · with weekly delta</h3>
          <span className="meta">JOOLA #4 · 12.5% share of voice</span>
        </div>
        <div className="card-pad">
          {D.ads.map(d => {
            const max = 150;
            return (
              <div key={d.brand} className={"bar-row " + (d.brand === "joola" ? "joola" : "")}>
                <div className="lbl">{brandName(d.brand)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: Math.max(2, (d.total / max) * 100) + "%",
                    background: `linear-gradient(90deg, ${brandColor(d.brand)}, ${brandColor(d.brand)}99)`,
                  }}>
                    {d.total} · {d.meta}M / {d.google}G
                  </div>
                </div>
                <div className="spark-mini">{d.share}% share</div>
                <div className={"delta-mini " + (d.delta > 0 ? "up" : d.delta < 0 ? "down" : "flat")}>
                  {d.delta > 0 ? "+" : ""}{d.delta}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------- Promotions / price war ----------------
function PromosSection() {
  return (
    <section id="promos">
      <div className="section-head">
        <div>
          <h2>Pricing &amp; promotions</h2>
          <div className="sub">Selkirk is running a permanent discount campaign. Franklin joined the war. JOOLA is unarmed.</div>
        </div>
      </div>

      <div className="price-war">
        <div className="icn">{I.warn}</div>
        <div>
          <h4>PRICE WAR ALERT — JOOLA IS THE ONLY TOP-3 BRAND WITH ZERO ACTIVE PROMOS</h4>
          <p>Selkirk Sport (13) and Franklin Pickleball (9) together account for <strong style={{color: "var(--fg)"}}>81% of the 27 active discounts in market</strong>. Selkirk has run a promo on 13 of the past 13 weeks. JOOLA's last sitewide was Feb 14 — 90 days ago.</p>
        </div>
        <div className="stat">
          0<span style={{color:"var(--fg-3)"}}>/13</span>
          <span className="sub">JOOLA WEEKS WITH PROMO · Q2</span>
        </div>
      </div>

      <div className="two-col-even">
        <div className="card">
          <div className="card-head">
            <h3>Active promotions by brand</h3>
            <span className="meta">27 total · promotions</span>
          </div>
          <div className="card-pad">
            {D.promos.filter(p => p.count > 0).map(d => (
              <div key={d.brand} className={"bar-row " + (d.brand === "joola" ? "joola" : "")}>
                <div className="lbl">{brandName(d.brand)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: Math.max(4, (d.count / 14) * 100) + "%",
                    background: `linear-gradient(90deg, ${brandColor(d.brand)}, ${brandColor(d.brand)}99)`,
                  }}>{d.count}</div>
                </div>
                <div className="spark-mini" style={{fontSize: 10}}>{d.types.join(", ")}</div>
                <div className="delta-mini flat">{d.pct.toFixed(1)}%</div>
              </div>
            ))}
            <div className="bar-row joola" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
              <div className="lbl">JOOLA</div>
              <div className="track">
                <div className="fill" style={{ width: 0, background: "transparent" }}>—</div>
              </div>
              <div className="spark-mini" style={{ color: "var(--red)", fontWeight: 700 }}>NO ACTIVE PROMOS</div>
              <div className="delta-mini down">0</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Promo cadence · last 13 weeks</h3>
            <span className="meta">heatmap · darker = more promos</span>
          </div>
          <div className="card-pad">
            <div className="heatmap">
              <div></div>
              {Array.from({ length: 13 }).map((_, i) => <div key={i} className="h-head">W{i + 1}</div>)}
              {Object.entries(D.calendar).map(([b, row]) => (
                <React.Fragment key={b}>
                  <div className="h-lbl" style={{ color: b === "joola" ? "#22c55e" : "var(--fg-3)" }}>{brandName(b)}</div>
                  {row.map((v, i) => (
                    <div key={i} className="h-cell"
                      style={{
                        background: v === 0 ? "rgba(255,255,255,0.025)" :
                                    `${brandColor(b)}${["00","30","55","85","ff"][Math.min(v,4)]}`,
                      }}
                      title={v + " promos in W" + (i + 1)}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 11, color: "var(--fg-4)" }}>
              <span>Earlier ←</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                less <span style={{ width: 12, height: 12, background: "rgba(255,255,255,0.04)" }}></span>
                <span style={{ width: 12, height: 12, background: "#F5E62555" }}></span>
                <span style={{ width: 12, height: 12, background: "#F5E625" }}></span>
                more
              </span>
              <span>→ This week</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- Reddit / community ----------------
function CommunitySection() {
  return (
    <section id="reddit">
      <div className="section-head">
        <div>
          <h2>Community sentiment · Reddit</h2>
          <div className="sub">JOOLA leads in volume (92 mentions) AND positive share (45% positive, 17% negative). Onix is the only brand with majority-negative discussion.</div>
        </div>
        <div className="actions">
          <span className="pill pill-green">JOOLA #1 · positive share</span>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Mention volume + sentiment split</h3>
            <span className="meta">362 mentions · last 90 days</span>
          </div>
          <div className="card-pad">
            <SentimentBar data={D.reddit.map(d => ({ ...d, name: brandName(d.brand) }))} />
            <div className="legend" style={{ marginTop: 14 }}>
              <span className="item"><span className="swatch" style={{ background: "#22c55e" }}></span>Positive</span>
              <span className="item"><span className="swatch" style={{ background: "#94a3b8", opacity: 0.5 }}></span>Neutral / question</span>
              <span className="item"><span className="swatch" style={{ background: "#ef4444" }}></span>Negative</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Trending keywords · r/pickleball</h3>
            <span className="meta">Market Intel</span>
          </div>
          <div>
            {D.trends.map(t => (
              <div key={t.rank} className={"trend-row " + (t.joola ? "joola" : "")}>
                <div className="rank">#{t.rank}</div>
                <div className="kw">{t.kw}</div>
                <div className="mtrack">
                  <div className="mfill" style={{ width: (t.mentions / 18 * 100) + "%", background: t.joola ? "#22c55e" : "#F5E625" }}></div>
                </div>
                <div className="mvol">{t.mentions}</div>
                <div>
                  {t.joola
                    ? <span className="pill pill-green">JOOLA</span>
                    : <span className="pill pill-ghost">{t.related[0]}</span>}
                </div>
              </div>
            ))}
            <div style={{ padding: 14, fontSize: 12, color: "var(--fg-3)", borderTop: "1px solid var(--line-2)" }}>
              <strong style={{ color: "var(--warn)" }}>⚠ Gap:</strong> "MLP" is the #1 trending term but no JOOLA-related signal references it. PPA is JOOLA's focus — but the conversation has moved.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- Influencers ----------------
function InfluencersSection() {
  const sorted = [...D.influencers].sort((a, b) => b.engRate - a.engRate);
  return (
    <section id="influencers">
      <div className="section-head">
        <div>
          <h2>Influencer ROI · engagement rate &gt; follower count</h2>
          <div className="sub">JOOLA's 4 athletes (Ben, Tyson, Anna, Agassi) account for 1.01M reach — 38% of all tracked influencer audience. But Paddletek's new signings (Riley, Zane) post higher engagement rates per post.</div>
        </div>
        <div className="actions">
          <div className="chip-row">
            <button className="chip on">All brands</button>
            <button className="chip">JOOLA only</button>
            <button className="chip">Threats</button>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Athlete</th>
                <th>Brand</th>
                <th style={{ textAlign: "right" }}>Followers</th>
                <th style={{ textAlign: "right" }}>Posts/wk</th>
                <th style={{ textAlign: "right" }}>Avg likes</th>
                <th style={{ textAlign: "right" }}>Eng. rate</th>
                <th style={{ width: 160 }}>Position</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a, i) => {
                const isJ = a.brand === "joola";
                return (
                  <tr key={i} className={isJ ? "joola" : ""}>
                    <td className="cell-num">{i + 1}</td>
                    <td>
                      <div className="athlete-row">
                        <div className="athlete-avatar" style={{ background: brandColor(a.brand) + "33", color: brandColor(a.brand), borderColor: brandColor(a.brand) + "44" }}>
                          {a.init}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: "var(--fg)", fontSize: 13 }}>{a.name}</div>
                          <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                            {isJ ? "JOOLA athlete" : "Competitor"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="brand-pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="brand-dot" style={{ background: brandColor(a.brand) }}></span>
                        {brandName(a.brand)}
                      </span>
                    </td>
                    <td className="cell-num" style={{ textAlign: "right" }}>{fmt(a.followers)}</td>
                    <td className="cell-num" style={{ textAlign: "right" }}>{(a.posts / 4).toFixed(1)}</td>
                    <td className="cell-num" style={{ textAlign: "right" }}>{fmt(a.avgLikes)}</td>
                    <td className="cell-num" style={{ textAlign: "right", color: a.engRate > 8 ? "#F5E625" : "var(--fg)" }}>{a.engRate.toFixed(2)}%</td>
                    <td>
                      <div style={{ height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: (a.engRate / 10 * 100) + "%", height: "100%", background: brandColor(a.brand) }}></div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--line-2)", fontSize: 12, color: "var(--fg-3)" }}>
          <strong style={{ color: "var(--warn)" }}>📌 Watch:</strong> Hayden Patriquin (Engage) hit 10.00% engagement rate — highest in dataset — at just 41K followers. Worth a courtesy outreach before he gets locked in for 2027.
        </div>
      </div>
    </section>
  );
}

// ---------------- Products ----------------
function ProductsSection() {
  const totalProducts = D.products.reduce((s, p) => s + p.count, 0);
  return (
    <section id="products">
      <div className="section-head">
        <div>
          <h2>Catalog &amp; pricing positioning</h2>
          <div className="sub">JOOLA has the largest catalog (56 paddles, 2.5× CRBN) but mid-tier average price. CRBN owns the premium tier at $251 avg. Onix is in price-war territory.</div>
        </div>
        <div className="actions">
          <span className="pill pill-ghost">{totalProducts} products · 211 priced</span>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Price distribution per brand · min / median / avg / max</h3>
          <span className="meta">vertical tick = median · box = ±15% of avg</span>
        </div>
        <div className="card-pad">
          <BoxPlot data={D.products.map(p => ({ ...p, name: brandName(p.brand), color: brandColor(p.brand) }))} />
        </div>
      </div>

      <div className="two-col-even" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head"><h3>Catalog size · paddles tracked</h3><span className="meta">238 total</span></div>
          <div className="card-pad">
            {D.products.map(p => (
              <div key={p.brand} className={"bar-row " + (p.brand === "joola" ? "joola" : "")}>
                <div className="lbl">{brandName(p.brand)}</div>
                <div className="track">
                  <div className="fill" style={{
                    width: (p.count / 60 * 100) + "%",
                    background: `linear-gradient(90deg, ${brandColor(p.brand)}, ${brandColor(p.brand)}99)`,
                  }}>{p.count}</div>
                </div>
                <div className="spark-mini">${p.avg} avg</div>
                <div className="delta-mini flat">{((p.count / totalProducts) * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Strategic position · price × catalog</h3><span className="meta">where each brand plays</span></div>
          <div className="card-pad">
            <PricePositionScatter />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- Opportunities ----------------
function Opportunities() {
  const cards = [
    {
      n: "01", tag: "Pricing", color: "#D6182A",
      title: "Launch Memorial Day sitewide before Selkirk extends to W14",
      body: "Five competitors are running discounts; JOOLA hasn't promoted since Feb. Selkirk's promo cadence has been continuous for 13 weeks — match it or cede share of voice on every paid search query.",
      why: "0 of 27 active promos · Selkirk owns 48%",
    },
    {
      n: "02", tag: "Content", color: "#F5E625",
      title: "Copy Engage's 'comment GEAR' DM strategy for Perseus IV",
      body: "Engage's Pursuit MX Reel generated 184K views and 864 comments at just 27.9K followers — 4× JOOLA's comment volume with 1/4 the audience. The trigger phrase converts engagement into qualified DM leads.",
      why: "Engage 0.86 comments/follower · JOOLA 0.19",
    },
    {
      n: "03", tag: "Influencer", color: "#22c55e",
      title: "Pre-empt Engage on Hayden Patriquin (10% engagement rate)",
      body: "Patriquin posts at 10.00% engagement rate — highest in tracked dataset — at only 41K followers. Sub-tier athlete cost, A-tier output. Paddletek already signed Riley & Zane for 2026; don't lose another.",
      why: "Highest engagement % · lowest cost tier",
    },
    {
      n: "04", tag: "Reddit", color: "#06b6d4",
      title: "Build an MLP content series — JOOLA owns PPA, not MLP",
      body: "MLP is the #1 trending keyword on r/pickleball with 18 mentions. JOOLA-related signal is zero. PPA is JOOLA's focus and is #2 — but the conversation drift is real and worth a content investment.",
      why: "18 MLP mentions, 0 JOOLA tie-in",
    },
    {
      n: "05", tag: "Premium", color: "#818cf8",
      title: "Carve a premium sub-tier at $250+ to challenge CRBN",
      body: "CRBN's $251 average price commands 49% premium over JOOLA at $168 — with a catalog 2.5× smaller. JOOLA's catalog is broad but mid-priced. A 3-paddle premium line (Perseus Pro V, Magnus Pro, Hyperion Pro) would close the price-perception gap.",
      why: "JOOLA $168 avg · CRBN $251 avg",
    },
    {
      n: "06", tag: "Watch", color: "#a855f7",
      title: "Tag Six Zero & CRBN as rising threats — both growing 5–6% wk/wk",
      body: "Six Zero (+5.7%) and CRBN (+6.1%) are growing 5× JOOLA's follower rate. At current pace CRBN crosses 60K by July and Six Zero passes Onix by August. Reassess the competitive set quarterly, not annually.",
      why: "Accelerating · auto-flag from ig_profiles_weekly",
    },
  ];
  return (
    <section id="opps">
      <div className="section-head">
        <div>
          <h2>Strategic opportunities</h2>
          <div className="sub">Six actions ranked by leverage. Each derived from this week's data and ready to assign.</div>
        </div>
        <div className="actions">
          <button className="btn btn-yellow">Assign all 6 →</button>
        </div>
      </div>
      <div className="opps">
        {cards.map((c, i) => (
          <div key={i} className="opp-card fade-up">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="num">{c.n}</div>
              <span className="pill" style={{ background: c.color + "20", color: c.color, border: "1px solid " + c.color + "44" }}>{c.tag}</span>
            </div>
            <h4>{c.title}</h4>
            <p>{c.body}</p>
            <div className="why">▸ {c.why}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="cta">Open playbook {I.arrow}</span>
              <span className="pill pill-ghost">Assign</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- Overview page (composition of sections) ----------------
function OverviewPage({ period, setPeriod, compare, setCompare }) {
  const [snav, setSnav] = useState("briefing");
  return (
    <>
      <PageHeader period={period} setPeriod={setPeriod} compare={compare} setCompare={setCompare} />
      <SectionNav active={snav} setActive={setSnav} />
      <Briefing />
      <KpiStrip />
      <MoversAndSignals />
      <EngagementMatrix />
      <IGGrowth />
      <AdsSection />
      <PromosSection />
      <CommunitySection />
      <InfluencersSection />
      <ProductsSection />
      <Opportunities />
    </>
  );
}

// ---------------- Root ----------------
function App() {
  const [active, setActive] = useState("overview");
  const [period, setPeriod] = useState("This week");
  const [compare, setCompare] = useState("");

  // Scroll to top on page change
  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [active]);

  const page = (() => {
    switch (active) {
      case "overview":    return <OverviewPage period={period} setPeriod={setPeriod} compare={compare} setCompare={setCompare} />;
      case "instagram":   return <InstagramPage />;
      case "youtube":     return <YouTubePage />;
      case "reddit":      return <RedditPage />;
      case "comments":    return <CommentsPage />;
      case "influencers": return <InfluencersPage />;
      case "ads":         return <AdsPage />;
      case "promos":      return <PromosPage />;
      case "products":    return <ProductsPage />;
      case "mkt":         return <MarketIntelPage />;
      default:            return <OverviewPage period={period} setPeriod={setPeriod} compare={compare} setCompare={setCompare} />;
    }
  })();

  return (
    <div className="shell">
      <div className="app-bg"></div>
      <div className="dot-grid"></div>
      <Sidebar active={active} setActive={setActive} />
      <main className="main">
        <div className="main-inner">
          {page}
          <footer className="foot">
            <div>
              <strong style={{ color: "var(--fg-2)" }}>JOOLA INTEL</strong> · 5,500 rows · 17 tables · refreshed Mondays 7:00 AM IST · viewing <span style={{ color: "#F5E625", fontWeight: 700 }}>{active.toUpperCase()}</span>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <a>Data sources</a><a>Methodology</a><a>Request a chart</a><a>v2.1 · changelog</a>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
