// JOOLA INTEL — Per-channel pages
// All pages share the same chrome (Sidebar, PageHeader) from app.jsx.
// This file exports page renderers via window.

const PG_D = window.JOOLA_DATA;
const pgColor = id => PG_D.BRANDS.find(b => b.id === id)?.color || "#888";
const pgName  = id => PG_D.BRANDS.find(b => b.id === id)?.name || id;

// Tiny components reused by pages -----------------------------------
function PageHead({ eyebrow, title, accent, sub, actions }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "#F5E625", boxShadow: "0 0 0 4px rgba(245,230,37,0.18)" }}></span>
          {eyebrow}
        </div>
        <h1>{title} <em>{accent}</em></h1>
        <div className="sub">{sub}</div>
      </div>
      <div className="head-actions">
        {actions}
      </div>
    </header>
  );
}

function MiniKpi({ label, value, delta, deltaPct, color, spark, src, customVs, flavor }) {
  return (
    <div className={"kpi " + (flavor || "")}>
      <div className="label">
        <span>{label}</span>
        {src && <span className="src">{src}</span>}
      </div>
      <div className="row">
        <div className="value">{value}</div>
        {spark && <div className="spark"><Sparkline data={spark} color={color || "#22c55e"} /></div>}
      </div>
      {delta !== undefined && (
        <div className={"delta " + (delta > 0 ? "up" : delta < 0 ? "down" : "flat")}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "▬"} {Math.abs(delta).toLocaleString()}
          {deltaPct !== undefined && deltaPct !== null && ` (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`}
          <span className="vs">{customVs || "vs. last wk"}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// INSTAGRAM PAGE
// ============================================================
function InstagramPage() {
  const joolaIg = PG_D.ig.find(x => x.brand === "joola");
  const series = PG_D.ig.slice(0, 6).map(d => ({
    id: d.brand, label: pgName(d.brand), color: pgColor(d.brand), data: d.trend,
  }));
  const scatterData = PG_D.ig.map(d => ({
    brand: d.brand, name: pgName(d.brand), color: pgColor(d.brand),
    followers: d.followers, engRate: d.engRate, posts: 30,
  }));
  return (
    <>
      <PageHead
        eyebrow="INSTAGRAM · 250 POSTS · 11 PROFILES · 1,896 COMMENTS"
        title="Instagram" accent="performance"
        sub="Who is growing, whose content actually resonates, and what JOOLA can learn from the brands punching above their weight."
        actions={<>
          <select className="select"><option>All 11 brands</option></select>
          <select className="select"><option>Last 8 weeks</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA followers" value="114.2K" delta={1240} deltaPct={1.1} color="#22c55e" spark={joolaIg.trend} src="ig_profiles_weekly" flavor="joola" />
          <MiniKpi label="JOOLA eng. rate" value="0.55%" delta={-0.03} deltaPct={-5.2} color="#ef4444" spark={[0.62,0.60,0.59,0.58,0.57,0.57,0.56,0.55]} src="ig_posts" flavor="danger" customVs="8th of 11 brands" />
          <MiniKpi label="JOOLA posts (wk)" value="14" delta={+2} deltaPct={+16.7} color="#818cf8" spark={[10,11,9,12,11,12,13,14]} src="ig_posts" customVs="vs. Selkirk: 22" />
          <MiniKpi label="Top post (wk)" value="218K" color="#F5E625" src="agassi drop" customVs="@joolausa · Reel · 7.62% ER" flavor="warn" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Follower trajectory · 8 weeks</h2><div className="sub">CRBN is closing the gap fastest. Six Zero punching well above its size.</div></div>
        </div>
        <div className="card"><div className="card-pad"><LineChart series={series} /></div></div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Engagement quality matrix</h2><div className="sub">Followers (reach) × engagement rate (resonance). Top-right = winning. JOOLA crosshair shown.</div></div>
        </div>
        <div className="card"><div className="card-pad-lg"><ScatterChart data={scatterData} /></div></div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Top performing posts · last 7 days</h2><div className="sub">Sorted by engagement rate. JOOLA owns 3 of the top 9 — Agassi drop carrying the line.</div></div>
          <div className="actions">
            <div className="chip-row">
              <button className="chip on">All</button>
              <button className="chip">JOOLA</button>
              <button className="chip">Reels</button>
              <button className="chip">Carousels</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Brand · handle</th><th style={{width:"40%"}}>Caption</th><th>Format</th>
                <th style={{textAlign:"right"}}>Likes</th><th style={{textAlign:"right"}}>Comments</th>
                <th style={{textAlign:"right"}}>Views</th><th style={{textAlign:"right"}}>ER</th>
              </tr></thead>
              <tbody>
                {[...PG_D.topIGPosts].sort((a,b)=>b.engRate-a.engRate).map((p,i)=>(
                  <tr key={i} className={p.brand==="joola"?"joola":""}>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span className="brand-dot" style={{background:pgColor(p.brand)}}></span>
                        <div>
                          <div style={{fontWeight:700,color:"var(--fg)",fontSize:12}}>{pgName(p.brand)}</div>
                          <div style={{fontSize:10,color:"var(--fg-4)",fontFamily:"JetBrains Mono"}}>{p.handle}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{color:"var(--fg)"}}>{p.caption}</td>
                    <td><span className={"pill " + (p.format==="Reel"?"pill-info":p.format==="Carousel"?"pill-amber":"pill-ghost")}>{p.format}</span></td>
                    <td className="cell-num" style={{textAlign:"right"}}>{fmt(p.likes)}</td>
                    <td className="cell-num" style={{textAlign:"right"}}>{fmt(p.comments)}</td>
                    <td className="cell-num" style={{textAlign:"right"}}>{fmt(p.views)}</td>
                    <td className="cell-num" style={{textAlign:"right",color:p.engRate>5?"#F5E625":"var(--fg)"}}>{p.engRate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head">
              <div><h2>Engagement rate · benchmark</h2><div className="sub">Yellow line = JOOLA 0.55%. Six brands beat it.</div></div>
            </div>
            <div className="card"><div className="card-pad">
              {[...PG_D.ig].sort((a,b)=>b.engRate-a.engRate).map(d => (
                <div key={d.brand} className={"bar-row " + (d.brand==="joola"?"joola":"")} style={{gridTemplateColumns:"110px 1fr 70px"}}>
                  <div className="lbl">{pgName(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width: (d.engRate / 2.2 * 100) + "%",
                      background: d.brand==="joola"?"#22c55e":`linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.engRate.toFixed(2)}%</div>
                  </div>
                  <div className="spark-mini" style={{textAlign:"right"}}>{fmt(d.followers)}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head">
              <div><h2>Posting cadence · last 4 weeks</h2><div className="sub">Selkirk posts ~22/wk. JOOLA ~14. Engage punches above with high-engagement Reels.</div></div>
            </div>
            <div className="card"><div className="card-pad">
              <PostFrequencyHeatmap />
            </div></div>
          </div>
        </div>
      </section>
    </>
  );
}

function PostFrequencyHeatmap() {
  const days = ["M","T","W","T","F","S","S"];
  const brands = ["joola","selkirk","crbn","engage","paddletek"];
  return (
    <div style={{display:"flex", flexDirection:"column", gap: 18}}>
      {brands.map(b => {
        const grid = PG_D.postFrequency[b];
        const max = 4;
        return (
          <div key={b}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span className="brand-dot" style={{background:pgColor(b)}}></span>
                <span style={{fontWeight:700,color:b==="joola"?"#22c55e":"var(--fg)",fontSize:12}}>{pgName(b)}</span>
              </div>
              <span style={{fontSize:10,color:"var(--fg-4)",fontFamily:"JetBrains Mono"}}>
                {grid.flat().reduce((s,v)=>s+v,0)} posts · 4wk
              </span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7, 1fr)",gap:3}}>
              {grid.flat().map((v,i)=>(
                <div key={i} style={{
                  height:14,
                  background: v===0?"rgba(255,255,255,0.03)":pgColor(b)+(["00","50","85","cc","ff"][Math.min(v,4)]),
                  borderRadius:2,
                }} title={v + " posts"} />
              ))}
            </div>
          </div>
        );
      })}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--fg-4)",borderTop:"1px solid var(--line-2)",paddingTop:8}}>
        <span>4 weeks ago →</span>
        <span>This week</span>
      </div>
    </div>
  );
}

// ============================================================
// YOUTUBE PAGE
// ============================================================
function YouTubePage() {
  return (
    <>
      <PageHead
        eyebrow="YOUTUBE · 391 VIDEOS · 11 CHANNELS · 1,078 COMMENTS"
        title="Youtube" accent="domination map"
        sub="Selkirk owns long-form pickleball video. JOOLA is a strong #2 but underweight given Ben Johns reach. The gap to close: short-form tutorial content."
        actions={<>
          <select className="select"><option>All channels</option></select>
          <select className="select"><option>Last 90 days</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA subscribers" value="38.4K" delta={210} deltaPct={0.5} color="#22c55e" spark={PG_D.ytTrend.joola} src="yt_channel_weekly" flavor="joola" customVs="vs. Selkirk: 84.2K" />
          <MiniKpi label="JOOLA videos" value="68" delta={2} deltaPct={3.0} color="#818cf8" spark={[58,60,62,63,65,66,67,68]} src="yt_videos" customVs="vs. Selkirk: 142" />
          <MiniKpi label="Total views (90d)" value="5.8M" delta={420000} deltaPct={7.8} color="#F5E625" spark={[4.6,4.9,5.1,5.3,5.5,5.6,5.7,5.8]} src="yt_videos" flavor="warn" />
          <MiniKpi label="Top video (wk)" value="624K" color="#ef4444" customVs="Perseus Pro IV walkthrough" flavor="danger" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Subscriber growth · 8 weeks</h2><div className="sub">Selkirk added ~5.8K subs in 8 weeks. JOOLA: 1.6K. CRBN catching up fast.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          <LineChart series={Object.entries(PG_D.ytTrend).map(([id,data])=>({
            id, label: pgName(id), color: pgColor(id), data,
          }))} />
        </div></div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div><h2>Channels by subscriber count</h2><div className="sub">11 brands · current snapshot</div></div></div>
            <div className="card"><div className="card-pad">
              {[...PG_D.yt].sort((a,b)=>b.subs-a.subs).map(d => (
                <div key={d.brand} className={"bar-row " + (d.brand==="joola"?"joola":"")}>
                  <div className="lbl">{pgName(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width:Math.max(2, d.subs/90000*100)+"%",
                      background:`linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{fmt(d.subs)}</div>
                  </div>
                  <div className="spark-mini">{d.videos} videos</div>
                  <div className={"delta-mini "+(d.delta>0?"up":d.delta<0?"down":"flat")}>{d.delta>0?"+":""}{d.delta}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div><h2>Views per video · efficiency</h2><div className="sub">Engage punches well above weight class.</div></div></div>
            <div className="card"><div className="card-pad">
              {[...PG_D.yt].filter(d=>d.videos>0).sort((a,b)=>(b.views/b.videos)-(a.views/a.videos)).map(d => {
                const vpv = Math.round(d.views/d.videos);
                return (
                  <div key={d.brand} className={"bar-row "+(d.brand==="joola"?"joola":"")}>
                    <div className="lbl">{pgName(d.brand)}</div>
                    <div className="track">
                      <div className="fill" style={{
                        width: Math.max(2, vpv/140000*100)+"%",
                        background:`linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                      }}>{fmt(vpv)}</div>
                    </div>
                    <div className="spark-mini">avg/vid</div>
                    <div className="delta-mini flat">{d.videos}v</div>
                  </div>
                );
              })}
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Top videos · last 60 days</h2><div className="sub">Long-form pickleball coaching wins. Note Selkirk's "How X actually trains" format.</div></div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Brand</th><th style={{width:"42%"}}>Title</th><th>Duration</th>
                <th style={{textAlign:"right"}}>Views</th><th style={{textAlign:"right"}}>Likes</th>
                <th style={{textAlign:"right"}}>Comments</th><th>Posted</th>
              </tr></thead>
              <tbody>
                {PG_D.topYTVideos.map((v,i)=>(
                  <tr key={i} className={v.brand==="joola"?"joola":""}>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span className="brand-dot" style={{background:pgColor(v.brand)}}></span>
                        <span style={{fontWeight:700,color:v.brand==="joola"?"#22c55e":"var(--fg)"}}>{pgName(v.brand)}</span>
                      </div>
                    </td>
                    <td style={{color:"var(--fg)"}}>{v.title}</td>
                    <td className="cell-num">{v.duration}</td>
                    <td className="cell-num" style={{textAlign:"right",color:"#F5E625"}}>{fmt(v.views)}</td>
                    <td className="cell-num" style={{textAlign:"right"}}>{fmt(v.likes)}</td>
                    <td className="cell-num" style={{textAlign:"right"}}>{fmt(v.comments)}</td>
                    <td className="cell-num">{v.days}d ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// REDDIT PAGE
// ============================================================
function RedditPage() {
  return (
    <>
      <PageHead
        eyebrow="REDDIT · 362 MENTIONS · 5 SUBREDDITS"
        title="Community" accent="sentiment"
        sub="JOOLA leads on positive share (45%) and total mentions (92). Onix is the only brand with majority-negative discussion. MLP keyword is trending but has no JOOLA tie."
        actions={<>
          <select className="select"><option>All brands</option></select>
          <select className="select"><option>Last 90 days</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA mentions" value="92" delta={14} deltaPct={18.0} color="#22c55e" spark={PG_D.redditTrend.joola} src="reddit_mentions" flavor="joola" />
          <MiniKpi label="JOOLA sentiment" value="+0.27" color="#22c55e" customVs="45% positive · 17% negative" flavor="joola" src="net score" />
          <MiniKpi label="Net positive #1" value="JOOLA" color="#F5E625" customVs="ahead of Selkirk by 12pts" flavor="warn" src="positive share" />
          <MiniKpi label="MLP trend gap" value="18 → 0" delta={-18} color="#ef4444" customVs="MLP mentions w/o JOOLA tie" flavor="danger" src="market signal" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Mention volume + sentiment</h2><div className="sub">Stacked by tone. Hover bars for breakdown.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          <SentimentBar data={PG_D.reddit.map(d=>({...d, name: pgName(d.brand)}))} />
          <div className="legend" style={{marginTop:14}}>
            <span className="item"><span className="swatch" style={{background:"#22c55e"}}></span>Positive</span>
            <span className="item"><span className="swatch" style={{background:"#94a3b8",opacity:0.5}}></span>Neutral / question</span>
            <span className="item"><span className="swatch" style={{background:"#ef4444"}}></span>Negative</span>
          </div>
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Mention trend · 8 weeks</h2><div className="sub">JOOLA accelerating. Onix declining. CRBN in the up-and-to-the-right club.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          <LineChart series={Object.entries(PG_D.redditTrend).map(([id,data])=>({
            id, label: pgName(id), color: pgColor(id), data,
          }))} />
        </div></div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div><h2>Subreddit distribution</h2><div className="sub">Where the conversation lives.</div></div></div>
            <div className="card"><div className="card-pad">
              {PG_D.subreddits.map((s,i)=>(
                <div key={i} className="bar-row" style={{gridTemplateColumns:"180px 1fr 80px"}}>
                  <div className="lbl" style={{fontFamily:"JetBrains Mono",fontSize:12}}>{s.name}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width:(s.mentions/220*100)+"%",
                      background:"linear-gradient(90deg, #F5E625, rgba(245,230,37,0.6))",
                      color:"#000",
                    }}>{s.mentions}</div>
                  </div>
                  <div className="spark-mini" style={{textAlign:"right",color:s.joolaShare>25?"#22c55e":"var(--fg-3)"}}>
                    JOOLA {s.joolaShare}%
                  </div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div><h2>Trending keywords</h2><div className="sub">MLP gap is the live opportunity.</div></div></div>
            <div className="card">
              {PG_D.trends.map(t=>(
                <div key={t.rank} className={"trend-row " + (t.joola?"joola":"")}>
                  <div className="rank">#{t.rank}</div>
                  <div className="kw">{t.kw}</div>
                  <div className="mtrack">
                    <div className="mfill" style={{width:(t.mentions/18*100)+"%",background:t.joola?"#22c55e":"#F5E625"}}></div>
                  </div>
                  <div className="mvol">{t.mentions}</div>
                  <div>{t.joola?<span className="pill pill-green">JOOLA</span>:<span className="pill pill-ghost">{t.related[0]}</span>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// COMMENTS PAGE
// ============================================================
function CommentsPage() {
  return (
    <>
      <PageHead
        eyebrow="COMMENTS INTEL · 1,896 IG · 1,078 YT · LAST 30 DAYS"
        title="Comments" accent="intelligence"
        sub="Real fan voice across IG and YouTube. Surface ambassadors, catch product issues, learn what's working."
        actions={<>
          <select className="select"><option>IG + YT</option></select>
          <select className="select"><option>All brands</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA IG comments" value="214" delta={28} deltaPct={15.1} color="#22c55e" spark={[164,168,178,184,190,198,206,214]} src="ig_comments" flavor="joola" />
          <MiniKpi label="Engage IG comments" value="864" color="#F5E625" customVs="4× JOOLA · 1/4 the followers" flavor="warn" src="benchmark" />
          <MiniKpi label="JOOLA YT comments" value="412" delta={42} deltaPct={11.4} color="#22c55e" spark={[280,310,335,358,376,388,396,412]} src="yt_comments" />
          <MiniKpi label="Net sentiment" value="+0.62" color="#22c55e" customVs="positive : negative ratio" flavor="joola" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Comments volume by brand</h2><div className="sub">Engage's "comment GEAR" trigger strategy is producing measurably more conversation per follower.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          {[
            {brand:"engage",ig:864,yt:184},
            {brand:"selkirk",ig:412,yt:842},
            {brand:"joola",ig:214,yt:412},
            {brand:"paddletek",ig:182,yt:194},
            {brand:"crbn",ig:148,yt:166},
            {brand:"franklin",ig:124,yt:88},
            {brand:"six-zero",ig:92,yt:62},
            {brand:"onix",ig:48,yt:18},
          ].map(d=>(
            <div key={d.brand} className={"bar-row " + (d.brand==="joola"?"joola":"")} style={{gridTemplateColumns:"110px 1fr 80px"}}>
              <div className="lbl">{pgName(d.brand)}</div>
              <div className="track" style={{display:"flex"}}>
                <div style={{
                  width:(d.ig/1000*70)+"%",
                  background:"linear-gradient(90deg, #818cf8, rgba(129,140,248,0.7))",
                  height:"100%",
                  display:"flex",alignItems:"center",padding:"0 8px",
                  fontFamily:"JetBrains Mono",fontSize:10,color:"#000",fontWeight:700,
                }}>IG {d.ig}</div>
                <div style={{
                  width:(d.yt/1000*70)+"%",
                  background:"linear-gradient(90deg, #ef4444, rgba(239,68,68,0.7))",
                  height:"100%",
                  display:"flex",alignItems:"center",padding:"0 8px",
                  fontFamily:"JetBrains Mono",fontSize:10,color:"#000",fontWeight:700,
                }}>YT {d.yt}</div>
              </div>
              <div className="spark-mini" style={{textAlign:"right"}}>{d.ig+d.yt}</div>
            </div>
          ))}
          <div className="legend" style={{marginTop:14}}>
            <span className="item"><span className="swatch" style={{background:"#818cf8"}}></span>Instagram</span>
            <span className="item"><span className="swatch" style={{background:"#ef4444"}}></span>YouTube</span>
          </div>
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Top comments · all brands · last 7 days</h2><div className="sub">Sorted by engagement. Tag ambassadors, flag complaints, copy what's working.</div></div>
          <div className="actions">
            <div className="chip-row">
              <button className="chip on">All</button>
              <button className="chip">Positive</button>
              <button className="chip">Negative</button>
              <button className="chip">JOOLA only</button>
            </div>
          </div>
        </div>
        <div className="card">
          {PG_D.topComments.map((c,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"auto auto 1fr auto auto",gap:12,padding:"14px 18px",borderBottom:"1px solid var(--line-2)",alignItems:"center"}}>
              <span className={"pill " + (c.platform==="ig"?"pill-info":"pill-red")} style={{fontFamily:"JetBrains Mono"}}>{c.platform.toUpperCase()}</span>
              <span className="brand-pill" style={{display:"inline-flex",alignItems:"center",gap:6}}>
                <span className="brand-dot" style={{background:pgColor(c.brand)}}></span>
                <span style={{fontWeight:700,color:c.brand==="joola"?"#22c55e":"var(--fg)",fontSize:12}}>{pgName(c.brand)}</span>
              </span>
              <div>
                <div style={{fontSize:13,color:"var(--fg)",marginBottom:2}}>"{c.text}"</div>
                <div style={{fontSize:10,color:"var(--fg-4)",fontFamily:"JetBrains Mono"}}>{c.user} · {c.days}d ago</div>
              </div>
              <span className={"pill " + (c.sentiment==="positive"?"pill-green":c.sentiment==="negative"?"pill-red":"pill-ghost")}>{c.sentiment}</span>
              <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:"var(--fg-3)",fontWeight:600}}>♥ {c.likes}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ============================================================
// INFLUENCERS PAGE
// ============================================================
function InfluencersPage() {
  const totalReach = PG_D.influencers.reduce((s,i)=>s+i.followers,0);
  const joolaReach = PG_D.influencers.filter(i=>i.brand==="joola").reduce((s,i)=>s+i.followers,0);
  const sorted = [...PG_D.influencers].sort((a,b)=>b.engRate-a.engRate);

  // Bubble chart: followers × engRate
  const bubW = 760, bubH = 360;
  const padL = 56, padR = 30, padT = 30, padB = 44;
  const innerW = bubW-padL-padR, innerH = bubH-padT-padB;
  const xMax = 450000, yMax = 11;
  const xb = v => padL + (v/xMax)*innerW;
  const yb = v => padT + innerH - (v/yMax)*innerH;

  return (
    <>
      <PageHead
        eyebrow="INFLUENCER NETWORK · 27 ATHLETES · 198 POSTS · 54 SNAPSHOTS"
        title="Influencer" accent="ROI"
        sub="JOOLA's 4 tracked athletes (Ben, Tyson, Anna, Agassi) deliver 1.01M reach — 38% of the entire tracked influencer audience. But engagement rate ≠ follower count."
        actions={<>
          <select className="select"><option>All athletes</option></select>
          <select className="select"><option>By engagement rate</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA reach" value="1.01M" color="#22c55e" customVs={`${Math.round(joolaReach/totalReach*100)}% of tracked total`} flavor="joola" src="influencer_snapshots" />
          <MiniKpi label="JOOLA athletes" value="4" delta={1} color="#22c55e" customVs="Agassi signed Apr 2026" />
          <MiniKpi label="Avg eng. rate (JOOLA)" value="6.84%" color="#818cf8" customVs="vs. Paddletek: 8.52%" flavor="warn" />
          <MiniKpi label="Top ER (market)" value="10.0%" color="#F5E625" customVs="Hayden Patriquin · Engage" flavor="warn" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Reach × engagement bubble map</h2><div className="sub">Bubble size = posts per month. Top-right = high-volume, high-engagement. JOOLA outlined in white.</div></div>
        </div>
        <div className="card"><div className="card-pad-lg">
          <svg viewBox={`0 0 ${bubW} ${bubH}`} width="100%" height={bubH}>
            <g className="scatter-grid">
              {[0,0.25,0.5,0.75,1].map((t,i)=>(<line key={"x"+i} x1={padL+t*innerW} x2={padL+t*innerW} y1={padT} y2={padT+innerH} />))}
              {[0,0.25,0.5,0.75,1].map((t,i)=>(<line key={"y"+i} x1={padL} x2={padL+innerW} y1={padT+t*innerH} y2={padT+t*innerH} />))}
            </g>
            <line x1={xb(150000)} x2={xb(150000)} y1={padT} y2={padT+innerH} stroke="rgba(245,230,37,0.2)" strokeDasharray="3 3"/>
            <line x1={padL} x2={padL+innerW} y1={yb(7)} y2={yb(7)} stroke="rgba(245,230,37,0.2)" strokeDasharray="3 3"/>
            <text x={padL+innerW-10} y={padT+18} textAnchor="end" className="scatter-quadrant" style={{fill:"#22c55e"}}>SUPERSTAR ZONE</text>
            <text x={padL+10} y={padT+18} className="scatter-quadrant">High ER · Smaller audience</text>
            <text x={padL+10} y={padT+innerH-10} className="scatter-quadrant">Low ER · Smaller audience</text>
            <text x={padL+innerW-10} y={padT+innerH-10} textAnchor="end" className="scatter-quadrant">Big reach · Low engagement</text>
            {[50000,150000,300000,450000].map((v,i)=>(<text key={i} x={xb(v)} y={bubH-22} textAnchor="middle" className="scatter-axis">{fmt(v)}</text>))}
            <text x={padL+innerW/2} y={bubH-6} textAnchor="middle" className="scatter-axis" style={{fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>FOLLOWERS →</text>
            {[0,2,4,6,8,10].map((v,i)=>(<text key={i} x={padL-8} y={yb(v)+3} textAnchor="end" className="scatter-axis">{v}%</text>))}
            <text transform={`translate(14 ${padT+innerH/2}) rotate(-90)`} textAnchor="middle" className="scatter-axis" style={{fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>ENGAGEMENT RATE ↑</text>
            {PG_D.influencers.map((a,i)=>{
              const cx = xb(a.followers), cy = yb(a.engRate);
              const isJ = a.brand==="joola";
              const r = 6 + a.posts/4;
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={r+4} fill={pgColor(a.brand)} opacity="0.10"/>
                  <circle cx={cx} cy={cy} r={r} fill={pgColor(a.brand)} opacity={isJ?1:0.85} stroke={isJ?"#fff":"rgba(0,0,0,0.4)"} strokeWidth={isJ?2:1}/>
                  <text x={cx} y={cy-r-6} textAnchor="middle" className="scatter-label" style={{fontSize:10,fontWeight:isJ?800:600,fill:isJ?"#22c55e":"#e2e8f0"}}>{a.name}</text>
                </g>
              );
            })}
          </svg>
        </div></div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Full athlete roster · sortable</h2><div className="sub">Ranked by engagement rate — actual value per post.</div></div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>#</th><th>Athlete</th><th>Brand</th>
                <th style={{textAlign:"right"}}>Followers</th>
                <th style={{textAlign:"right"}}>Posts/wk</th>
                <th style={{textAlign:"right"}}>Avg likes</th>
                <th style={{textAlign:"right"}}>Eng. rate</th>
                <th style={{width:160}}>Tier</th>
              </tr></thead>
              <tbody>
                {sorted.map((a,i)=>{
                  const isJ = a.brand==="joola";
                  return (
                    <tr key={i} className={isJ?"joola":""}>
                      <td className="cell-num">{i+1}</td>
                      <td>
                        <div className="athlete-row">
                          <div className="athlete-avatar" style={{background:pgColor(a.brand)+"33",color:pgColor(a.brand),borderColor:pgColor(a.brand)+"44"}}>{a.init}</div>
                          <div>
                            <div style={{fontWeight:700,color:"var(--fg)",fontSize:13}}>{a.name}</div>
                            <div style={{fontSize:10,color:"var(--fg-4)",fontFamily:"JetBrains Mono"}}>@{a.name.toLowerCase().replace(/ /g,"")}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="brand-pill" style={{display:"inline-flex",alignItems:"center",gap:6}}><span className="brand-dot" style={{background:pgColor(a.brand)}}></span>{pgName(a.brand)}</span></td>
                      <td className="cell-num" style={{textAlign:"right"}}>{fmt(a.followers)}</td>
                      <td className="cell-num" style={{textAlign:"right"}}>{(a.posts/4).toFixed(1)}</td>
                      <td className="cell-num" style={{textAlign:"right"}}>{fmt(a.avgLikes)}</td>
                      <td className="cell-num" style={{textAlign:"right",color:a.engRate>8?"#F5E625":"var(--fg)"}}>{a.engRate.toFixed(2)}%</td>
                      <td>
                        <div style={{height:6,background:"rgba(255,255,255,0.04)",borderRadius:99,overflow:"hidden"}}>
                          <div style={{width:(a.engRate/10*100)+"%",height:"100%",background:pgColor(a.brand)}}></div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// ADS PAGE
// ============================================================
function AdsPage() {
  const series = [
    { id:"selkirk", label:"Selkirk", color:pgColor("selkirk"), data:[108,112,118,121,124,127,130,133,135,137,140,142,144] },
    { id:"crbn", label:"CRBN", color:pgColor("crbn"), data:[102,106,110,114,118,122,125,128,131,134,137,139,141] },
    { id:"paddletek", label:"Paddletek", color:pgColor("paddletek"), data:[115,114,112,111,110,108,107,106,105,104,103,102,102] },
    { id:"joola", label:"JOOLA", color:pgColor("joola"), data:[76,78,80,82,83,85,86,87,88,89,90,91,92] },
    { id:"franklin", label:"Franklin", color:pgColor("franklin"), data:[62,64,67,69,71,72,73,74,75,76,77,77,78] },
    { id:"engage", label:"Engage", color:pgColor("engage"), data:[44,45,47,49,51,52,53,54,55,56,57,57,58] },
  ];
  return (
    <>
      <PageHead
        eyebrow="ADS LIBRARY · 735 ACTIVE CREATIVES · 157 META + 574 GOOGLE"
        title="Ads" accent="library"
        sub="Searchable, filterable, sortable. Every active creative across the market. Selkirk leads at 144 active; JOOLA #4 at 92."
        actions={<>
          <input className="select" style={{width:240}} placeholder="🔍 Search ad copy, CTA, athlete…" />
          <select className="select"><option>All brands</option></select>
          <select className="select"><option>Active</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="Active ads (total)" value="735" delta={28} deltaPct={4.0} color="#f59e0b" spark={[665,672,684,691,702,714,721,735]} src="marketing_ads" flavor="warn" />
          <MiniKpi label="JOOLA share of voice" value="12.5%" delta={0.6} color="#22c55e" customVs="92 active · #4 rank" flavor="joola" />
          <MiniKpi label="Most active brand" value="Selkirk" color="#F5E625" customVs="144 · +12 this wk" flavor="warn" />
          <MiniKpi label="Google share" value="78%" color="#818cf8" customVs="574 Google / 157 Meta" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Ad volume over 13 weeks · stacked by brand</h2><div className="sub">Selkirk + CRBN climbing for 13 weeks straight. Paddletek pulling back. JOOLA steady ascent.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          <StackedArea series={series} weeks={13} />
          <div className="legend" style={{marginTop:10}}>
            {series.map(s=>(<span key={s.id} className="item"><span className="swatch" style={{background:s.color,opacity:s.id==="joola"?0.95:0.7}}></span>{s.label}</span>))}
          </div>
        </div></div>
      </section>

      <section>
        <div className="two-col">
          <div>
            <div className="section-head"><div><h2>Total ads · ranked</h2><div className="sub">With weekly delta and platform mix.</div></div></div>
            <div className="card"><div className="card-pad">
              {PG_D.ads.map(d => (
                <div key={d.brand} className={"bar-row " + (d.brand==="joola"?"joola":"")}>
                  <div className="lbl">{pgName(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width:Math.max(2,(d.total/150)*100)+"%",
                      background:`linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.total} · {d.meta}M / {d.google}G</div>
                  </div>
                  <div className="spark-mini">{d.share}%</div>
                  <div className={"delta-mini "+(d.delta>0?"up":d.delta<0?"down":"flat")}>{d.delta>0?"+":""}{d.delta}</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div><h2>Platform mix</h2><div className="sub">Heavy Google bias across the market.</div></div></div>
            <div className="card"><div className="card-pad" style={{display:"flex",gap:18,alignItems:"center"}}>
              <Donut data={[
                {name:"Google Search", value:574, color:"#4ade80"},
                {name:"Meta Feed", value:102, color:"#818cf8"},
                {name:"Meta Reels", value:35, color:"#a855f7"},
                {name:"Meta Stories", value:20, color:"#ec4899"},
                {name:"Other", value:4, color:"#3a4150"},
              ]} size={170} thickness={28} centerLabel="735" centerSub="active" />
              <div className="donut-legend" style={{flex:1}}>
                {[
                  ["Google Search","#4ade80",574],
                  ["Meta Feed","#818cf8",102],
                  ["Meta Reels","#a855f7",35],
                  ["Meta Stories","#ec4899",20],
                  ["Other","#3a4150",4],
                ].map(([n,c,v],i)=>(
                  <div key={i} className="row">
                    <span className="swatch" style={{background:c}}></span>
                    <span className="name">{n}</span>
                    <span className="val">{v}</span>
                  </div>
                ))}
              </div>
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>All active ads · 9 of 735</h2><div className="sub">Filterable table replaces the "NO PREVIEW" image grid. Search any copy, CTA, or athlete reference.</div></div></div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Brand</th><th>Platform</th><th style={{width:"42%"}}>Copy</th>
                <th>CTA</th><th>First seen</th><th>Status</th>
              </tr></thead>
              <tbody>
                {PG_D.adSample.map((a,i)=>(
                  <tr key={i} className={a.brand==="joola"?"joola":""}>
                    <td><span className="brand-pill" style={{display:"inline-flex",alignItems:"center",gap:6}}><span className="brand-dot" style={{background:pgColor(a.brand)}}></span><span style={{fontWeight:700,color:a.brand==="joola"?"#22c55e":"var(--fg)"}}>{pgName(a.brand)}</span></span></td>
                    <td><span className={"pill " + (a.platform==="Meta"?"pill-info":"pill-amber")}>{a.platform}</span></td>
                    <td style={{color:"var(--fg)"}}>{a.copy}</td>
                    <td><span className="pill pill-ghost">{a.cta}</span></td>
                    <td className="cell-num">{a.started}</td>
                    <td><span className="pill pill-green">ACTIVE</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// PROMOTIONS PAGE
// ============================================================
function PromosPage() {
  return (
    <>
      <PageHead
        eyebrow="PROMOTIONS · 27 ACTIVE DISCOUNTS · 5 BRANDS"
        title="Pricing" accent="war room"
        sub="Selkirk + Franklin own 81% of all active discounts. JOOLA has been silent since Feb 14."
        actions={<>
          <select className="select"><option>All promo types</option></select>
          <select className="select"><option>This quarter</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="price-war">
          <div className="icn">{(<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r="1" fill="currentColor"/></svg>)}</div>
          <div>
            <h4>PRICE WAR ALERT — JOOLA IS THE ONLY TOP-3 BRAND WITH ZERO ACTIVE PROMOS</h4>
            <p>Selkirk Sport (13) and Franklin Pickleball (9) together account for <strong style={{color:"var(--fg)"}}>81% of the 27 active discounts in market</strong>. Selkirk has run a promo on 13 of 13 weeks this quarter. JOOLA's last sitewide was Feb 14 — <strong style={{color:"var(--fg)"}}>90 days ago</strong>.</p>
          </div>
          <div className="stat">0<span style={{color:"var(--fg-3)"}}>/13</span><span className="sub">JOOLA WEEKS WITH PROMO · Q2</span></div>
        </div>
      </section>

      <section>
        <div className="kpi-grid">
          <MiniKpi label="Total active promos" value="27" delta={4} deltaPct={17.4} color="#D6182A" spark={[18,19,21,22,23,24,25,27]} src="promotions" flavor="danger" />
          <MiniKpi label="Selkirk's share" value="48.1%" color="#F5E625" customVs="13 promos · #1" flavor="warn" />
          <MiniKpi label="JOOLA promos" value="0" delta={0} color="#ef4444" customVs="last on Feb 14" flavor="danger" />
          <MiniKpi label="Avg discount" value="18%" color="#818cf8" customVs="across all brands" />
        </div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head"><div><h2>Active promotions · by brand</h2><div className="sub">5 of 11 brands discounting right now.</div></div></div>
            <div className="card"><div className="card-pad">
              {PG_D.promos.filter(p=>p.count>0).map(d=>(
                <div key={d.brand} className={"bar-row " + (d.brand==="joola"?"joola":"")}>
                  <div className="lbl">{pgName(d.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width:Math.max(4,(d.count/14)*100)+"%",
                      background:`linear-gradient(90deg, ${pgColor(d.brand)}, ${pgColor(d.brand)}99)`,
                    }}>{d.count}</div>
                  </div>
                  <div className="spark-mini" style={{fontSize:10}}>{d.types.join(", ")}</div>
                  <div className="delta-mini flat">{d.pct.toFixed(1)}%</div>
                </div>
              ))}
              <div className="bar-row joola" style={{marginTop:8,paddingTop:8,borderTop:"1px dashed var(--line)"}}>
                <div className="lbl">JOOLA</div>
                <div className="track"><div className="fill" style={{width:0,background:"transparent"}}>—</div></div>
                <div className="spark-mini" style={{color:"var(--red)",fontWeight:700}}>NO ACTIVE PROMOS</div>
                <div className="delta-mini down">0</div>
              </div>
            </div></div>
          </div>
          <div>
            <div className="section-head"><div><h2>Promo cadence · 13-week heatmap</h2><div className="sub">Selkirk's discount campaign is permanent.</div></div></div>
            <div className="card"><div className="card-pad">
              <div className="heatmap">
                <div></div>
                {Array.from({length:13}).map((_,i)=><div key={i} className="h-head">W{i+1}</div>)}
                {Object.entries(PG_D.calendar).map(([b,row])=>(
                  <React.Fragment key={b}>
                    <div className="h-lbl" style={{color:b==="joola"?"#22c55e":"var(--fg-3)"}}>{pgName(b)}</div>
                    {row.map((v,i)=>(<div key={i} className="h-cell" style={{background:v===0?"rgba(255,255,255,0.025)":`${pgColor(b)}${["00","30","55","85","ff"][Math.min(v,4)]}`}} title={v+" promos"} />))}
                  </React.Fragment>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:14,fontSize:11,color:"var(--fg-4)"}}>
                <span>13 weeks ago</span><span>This week →</span>
              </div>
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>Active promotion details · 9 examples</h2><div className="sub">Pulled live from competitor homepages.</div></div></div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Brand</th><th>Promo</th><th>Type</th>
                <th style={{textAlign:"right"}}>Discount</th><th>Started</th><th>Source</th>
              </tr></thead>
              <tbody>
                {[
                  ["selkirk","20% OFF VANGUARD POWER AIR","Category",20,"May 1","homepage banner"],
                  ["selkirk","BUNDLE: PADDLE + BAG + BALLS","Bundle",15,"Apr 22","cart upsell"],
                  ["selkirk","FREE SHIPPING $99+","Shipping",0,"Apr 1","site-wide"],
                  ["franklin","SITEWIDE 15% OFF","Sitewide",15,"May 10","banner"],
                  ["franklin","FS TOUR PRO LAUNCH 10% OFF","Category",10,"Apr 28","banner"],
                  ["onix","Z5 GRAPHITE CLEARANCE — $69","Clearance",46,"Apr 14","clearance page"],
                  ["onix","CLOSEOUT ALL APPAREL","Clearance",40,"Mar 28","cart upsell"],
                  ["paddletek","BANTAM ESQ-C BUNDLE","Bundle",12,"May 6","banner"],
                  ["engage","FREE SHIPPING ON $79+","Shipping",0,"May 2","header"],
                ].map(([b,p,t,d,s,src],i)=>(
                  <tr key={i}>
                    <td><span className="brand-pill" style={{display:"inline-flex",alignItems:"center",gap:6}}><span className="brand-dot" style={{background:pgColor(b)}}></span><span style={{fontWeight:700,color:"var(--fg)"}}>{pgName(b)}</span></span></td>
                    <td style={{color:"var(--fg)",fontWeight:600}}>{p}</td>
                    <td><span className="pill pill-ghost">{t}</span></td>
                    <td className="cell-num" style={{textAlign:"right",color:"#F5E625"}}>{d>0?d+"%":"—"}</td>
                    <td className="cell-num">{s}</td>
                    <td style={{fontSize:11,color:"var(--fg-4)",fontFamily:"JetBrains Mono"}}>{src}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// PRODUCTS PAGE
// ============================================================
function ProductsPage() {
  const totalProducts = PG_D.products.reduce((s,p)=>s+p.count,0);
  return (
    <>
      <PageHead
        eyebrow="PRODUCT CATALOG · 238 PADDLES · 211 PRICED"
        title="Catalog &" accent="pricing"
        sub="JOOLA has the broadest catalog (56 paddles). CRBN owns premium ($251 avg). Onix is in price-war territory. Strategic position map below."
        actions={<>
          <select className="select"><option>All brands</option></select>
          <select className="select"><option>All categories</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="JOOLA catalog" value="56" delta={2} color="#22c55e" customVs="largest in market" flavor="joola" src="products" />
          <MiniKpi label="JOOLA avg price" value="$168" color="#818cf8" customVs="mid-tier · vs $251 CRBN" />
          <MiniKpi label="Premium leader" value="CRBN" color="#F5E625" customVs="$251 avg · 22 products" flavor="warn" />
          <MiniKpi label="Value leader" value="Onix" color="#ef4444" customVs="$78 avg · clearance" flavor="danger" />
        </div>
      </section>

      <section>
        <div className="section-head">
          <div><h2>Price distribution per brand</h2><div className="sub">Min — median — avg — max per paddle. JOOLA spans $50–$300 — the widest range.</div></div>
        </div>
        <div className="card"><div className="card-pad">
          <BoxPlot data={PG_D.products.map(p=>({...p, name: pgName(p.brand), color: pgColor(p.brand)}))} />
        </div></div>
      </section>

      <section>
        <div className="two-col-even">
          <div>
            <div className="section-head"><div><h2>Catalog size</h2><div className="sub">238 paddles total.</div></div></div>
            <div className="card"><div className="card-pad">
              {PG_D.products.map(p=>(
                <div key={p.brand} className={"bar-row " + (p.brand==="joola"?"joola":"")}>
                  <div className="lbl">{pgName(p.brand)}</div>
                  <div className="track">
                    <div className="fill" style={{
                      width:(p.count/60*100)+"%",
                      background:`linear-gradient(90deg, ${pgColor(p.brand)}, ${pgColor(p.brand)}99)`,
                    }}>{p.count}</div>
                  </div>
                  <div className="spark-mini">${p.avg} avg</div>
                  <div className="delta-mini flat">{((p.count/totalProducts)*100).toFixed(1)}%</div>
                </div>
              ))}
            </div></div>
          </div>
          <div>
            <div className="section-head"><div><h2>Position · price × catalog</h2><div className="sub">JOOLA is wide × mid. CRBN is lean × premium. Quadrants tell strategy.</div></div></div>
            <div className="card"><div className="card-pad">
              <PricePositionScatter />
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>Featured paddles · top 10 by price tier</h2><div className="sub">A cross-section of how each brand stacks tiers.</div></div></div>
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Brand</th><th>Paddle</th><th>Tier</th>
                <th style={{textAlign:"right"}}>Price</th><th>Core</th><th>Stock</th>
              </tr></thead>
              <tbody>
                {[
                  ["joola","Perseus Pro IV","Premium",280,"16mm carbon","In stock"],
                  ["joola","Magnus Pro","Premium",260,"14mm","In stock"],
                  ["joola","Agassi Edition","Premium",250,"16mm","Pre-order"],
                  ["joola","Hyperion CFS 16","Mid",180,"16mm","In stock"],
                  ["joola","Scorpeus II","Mid",160,"14mm","In stock"],
                  ["crbn","CRBN-1X 16mm","Premium",280,"16mm raw","In stock"],
                  ["crbn","CRBN-3","Premium",250,"16mm","In stock"],
                  ["selkirk","VANGUARD POWER AIR","Premium",250,"14mm carbon","In stock"],
                  ["selkirk","SLK Halo","Mid",170,"13mm","In stock"],
                  ["onix","Z5 Graphite","Value",69,"polymer core","CLEARANCE"],
                ].map(([b,name,tier,price,core,stock],i)=>(
                  <tr key={i} className={b==="joola"?"joola":""}>
                    <td><span className="brand-pill" style={{display:"inline-flex",alignItems:"center",gap:6}}><span className="brand-dot" style={{background:pgColor(b)}}></span><span style={{fontWeight:700,color:b==="joola"?"#22c55e":"var(--fg)"}}>{pgName(b)}</span></span></td>
                    <td style={{color:"var(--fg)",fontWeight:600}}>{name}</td>
                    <td><span className={"pill " + (tier==="Premium"?"pill-yellow":tier==="Mid"?"pill-info":"pill-red")}>{tier}</span></td>
                    <td className="cell-num" style={{textAlign:"right"}}>${price}</td>
                    <td className="cell-num">{core}</td>
                    <td><span className={"pill " + (stock==="In stock"?"pill-green":stock==="CLEARANCE"?"pill-red":"pill-amber")}>{stock}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// MARKET INTEL PAGE
// ============================================================
function MarketIntelPage() {
  return (
    <>
      <PageHead
        eyebrow="MARKET INTEL · TRENDS · SIGNALS · INTEL FEED"
        title="Market" accent="intel"
        sub="What the market is talking about, what competitors are doing, and what JOOLA should respond to. Refreshed weekly."
        actions={<>
          <select className="select"><option>All sources</option></select>
          <select className="select"><option>Last 30 days</option></select>
          <button className="btn btn-yellow">Export brief</button>
        </>}
      />

      <section>
        <div className="kpi-grid">
          <MiniKpi label="Signals (wk)" value="42" delta={8} deltaPct={23.5} color="#F5E625" spark={[24,28,30,33,34,36,39,42]} flavor="warn" />
          <MiniKpi label="Crisis flags" value="2" color="#ef4444" customVs="Onix clearance · Selkirk surge" flavor="danger" />
          <MiniKpi label="JOOLA-relevant trends" value="4 of 6" color="#22c55e" customVs="PPA, Ben Johns, 16mm, Hyperion" flavor="joola" />
          <MiniKpi label="MLP gap" value="18 → 0" delta={-18} color="#ef4444" customVs="trending w/o JOOLA tie" flavor="danger" />
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>Trending keywords · r/pickleball + IG</h2><div className="sub">JOOLA owns 4 of 6. MLP (#1) is the live content gap.</div></div></div>
        <div className="card">
          {PG_D.trends.map(t=>(
            <div key={t.rank} className={"trend-row " + (t.joola?"joola":"")}>
              <div className="rank">#{t.rank}</div>
              <div className="kw">{t.kw}</div>
              <div className="mtrack">
                <div className="mfill" style={{width:(t.mentions/18*100)+"%",background:t.joola?"#22c55e":"#F5E625"}}></div>
              </div>
              <div className="mvol">{t.mentions}</div>
              <div>{t.joola?<span className="pill pill-green">JOOLA</span>:<span className="pill pill-ghost">{t.related[0]}</span>}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>Live intel feed · last 72 hours</h2><div className="sub">Every signal captured by the platform — paid, organic, community, product.</div></div></div>
        <div className="card">
          {PG_D.signals.map((s,i)=>(
            <div key={i} className="signal">
              <span className={"sig-tag " + s.type}>{s.type==="ad"?"AD":s.type==="promo"?"PROMO":s.type==="social"?"SOCIAL":s.type==="reddit"?"REDDIT":"PRODUCT"}</span>
              <span className="brand-pill"><span className="brand-dot" style={{background:pgColor(s.brand)}}></span>{pgName(s.brand)}</span>
              <span className="desc">{s.desc}</span>
              <span className="when">{s.when}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head"><div><h2>JOOLA mentions across the web · 30 days</h2><div className="sub">Aggregated from Reddit, IG comments, YT comments, and direct site mentions.</div></div></div>
        <div className="two-col">
          <div className="card"><div className="card-pad">
            <LineChart series={[
              { id:"joola", label:"JOOLA mentions", color:"#22c55e", data:[62,68,72,76,80,84,88,92] },
              { id:"selkirk", label:"Selkirk", color:"#F5E625", data:[88,84,82,80,78,79,77,78] },
              { id:"crbn", label:"CRBN", color:"#818cf8", data:[22,26,28,32,35,38,40,41] },
            ]} />
          </div></div>
          <div className="card">
            <div className="card-head"><h3>Source breakdown</h3><span className="meta">30d total: 92</span></div>
            <div className="card-pad" style={{display:"flex",gap:18,alignItems:"center"}}>
              <Donut data={[
                {name:"r/pickleball", value:54, color:"#06b6d4"},
                {name:"r/pickleballgear", value:18, color:"#818cf8"},
                {name:"IG comments", value:12, color:"#ec4899"},
                {name:"YT comments", value:6, color:"#ef4444"},
                {name:"Other", value:2, color:"#3a4150"},
              ]} size={170} thickness={28} centerLabel="92" centerSub="JOOLA mentions" />
              <div className="donut-legend" style={{flex:1}}>
                {[["r/pickleball","#06b6d4",54],["r/pickleballgear","#818cf8",18],["IG comments","#ec4899",12],["YT comments","#ef4444",6],["Other","#3a4150",2]].map(([n,c,v],i)=>(
                  <div key={i} className="row">
                    <span className="swatch" style={{background:c}}></span>
                    <span className="name">{n}</span>
                    <span className="val">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// Export to window
Object.assign(window, {
  InstagramPage, YouTubePage, RedditPage, CommentsPage,
  InfluencersPage, AdsPage, PromosPage, ProductsPage, MarketIntelPage,
  PageHead, MiniKpi,
});
