// JOOLA INTEL — Mock data derived from audit figures + database snapshot.
// All numbers anchored to the audit values (114.2K JOOLA followers, etc.)

window.JOOLA_DATA = (function() {
  const BRANDS = [
    { id: "joola",      name: "JOOLA",            color: "#22c55e", joola: true },
    { id: "selkirk",    name: "Selkirk Sport",    color: "#F5E625" },
    { id: "crbn",       name: "CRBN",             color: "#818cf8" },
    { id: "franklin",   name: "Franklin",         color: "#ec4899" },
    { id: "engage",     name: "Engage",           color: "#06b6d4" },
    { id: "paddletek",  name: "Paddletek",        color: "#f59e0b" },
    { id: "six-zero",   name: "Six Zero",         color: "#a855f7" },
    { id: "onix",       name: "Onix Sports",      color: "#ef4444" },
    { id: "wilson",     name: "Wilson",           color: "#14b8a6" },
    { id: "gamma",      name: "Gamma",            color: "#60a5fa" },
    { id: "prokennex",  name: "ProKennex",        color: "#fb923c" },
  ];

  // Sparkline data: 8 weeks
  const spark = (vals) => vals;

  // Instagram followers (current + 8-week trend)
  const ig = [
    { brand: "joola",     followers: 114200, delta: +1240, deltaPct: +1.1, engRate: 0.55, trend: spark([110100,110900,111400,112000,112500,113100,113800,114200]) },
    { brand: "selkirk",   followers: 109800, delta: +860,  deltaPct: +0.8, engRate: 0.82, trend: spark([106700,107300,107900,108300,108700,109100,109400,109800]) },
    { brand: "paddletek", followers:  78200, delta: +2410, deltaPct: +3.1, engRate: 0.91, trend: spark([72900,73800,74700,75500,76200,76900,77600,78200]) },
    { brand: "crbn",      followers:  54300, delta: +3120, deltaPct: +6.1, engRate: 0.74, trend: spark([47800,48900,50100,51300,52200,53000,53700,54300]) },
    { brand: "six-zero",  followers:  36400, delta: +1980, deltaPct: +5.7, engRate: 1.12, trend: spark([31500,32300,33100,33900,34600,35300,35900,36400]) },
    { brand: "engage",    followers:  27900, delta: +540,  deltaPct: +2.0, engRate: 1.62, trend: spark([26100,26400,26700,27000,27300,27500,27700,27900]) },
    { brand: "franklin",  followers:  24800, delta: +210,  deltaPct: +0.9, engRate: 1.80, trend: spark([24200,24300,24400,24500,24600,24700,24750,24800]) },
    { brand: "onix",      followers:  14100, delta: -180,  deltaPct: -1.3, engRate: 0.06, trend: spark([14820,14750,14600,14500,14400,14300,14200,14100]) },
    { brand: "wilson",    followers:   8420, delta: +85,   deltaPct: +1.0, engRate: 2.06, trend: spark([8160,8210,8260,8290,8330,8360,8395,8420]) },
    { brand: "gamma",     followers:   6730, delta: -42,   deltaPct: -0.6, engRate: 0.41, trend: spark([6840,6820,6800,6790,6780,6770,6750,6730]) },
    { brand: "prokennex", followers:   4210, delta: +12,   deltaPct: +0.3, engRate: 0.38, trend: spark([4180,4185,4190,4195,4200,4203,4208,4210]) },
  ];

  // Marketing ads — Meta + Google
  const ads = [
    { brand: "selkirk",   total: 144, meta: 38, google: 106, active: 144, delta: +12, share: 19.6 },
    { brand: "crbn",      total: 141, meta: 34, google: 107, active: 138, delta: +5,  share: 19.2 },
    { brand: "paddletek", total: 102, meta: 28, google:  74, active:  95, delta: -3,  share: 13.9 },
    { brand: "joola",     total:  92, meta: 21, google:  71, active:  88, delta: +6,  share: 12.5 },
    { brand: "franklin",  total:  78, meta: 16, google:  62, active:  74, delta: +4,  share: 10.6 },
    { brand: "engage",    total:  58, meta:  9, google:  49, active:  52, delta: +2,  share: 7.9 },
    { brand: "six-zero",  total:  42, meta:  6, google:  36, active:  41, delta: +8,  share: 5.7 },
    { brand: "wilson",    total:  31, meta:  3, google:  28, active:  28, delta: -1,  share: 4.2 },
    { brand: "onix",      total:  24, meta:  1, google:  23, active:  18, delta: -6,  share: 3.3 },
    { brand: "gamma",     total:  15, meta:  0, google:  15, active:  12, delta:  0,  share: 2.0 },
    { brand: "prokennex", total:   8, meta:  1, google:   7, active:   5, delta: -2,  share: 1.1 },
  ];

  // Promotions
  const promos = [
    { brand: "selkirk",   count: 13, types: ["Bundle","Sitewide","Shipping"], pct: 48.1 },
    { brand: "franklin",  count:  9, types: ["Sitewide","Category"], pct: 33.3 },
    { brand: "onix",      count:  3, types: ["Clearance"], pct: 11.1 },
    { brand: "paddletek", count:  1, types: ["Bundle"], pct: 3.7 },
    { brand: "engage",    count:  1, types: ["Shipping"], pct: 3.7 },
    { brand: "joola",     count:  0, types: [], pct: 0 },
    { brand: "crbn",      count:  0, types: [], pct: 0 },
    { brand: "six-zero",  count:  0, types: [], pct: 0 },
    { brand: "wilson",    count:  0, types: [], pct: 0 },
    { brand: "gamma",     count:  0, types: [], pct: 0 },
    { brand: "prokennex", count:  0, types: [], pct: 0 },
  ];

  // Products (price distribution)
  const products = [
    { brand: "joola",     count: 56, avg: 168, min: 50,  med: 165, max: 300 },
    { brand: "selkirk",   count: 41, avg: 219, min: 110, med: 215, max: 295 },
    { brand: "paddletek", count: 28, avg: 189, min: 89,  med: 185, max: 269 },
    { brand: "franklin",  count: 26, avg: 142, min: 60,  med: 135, max: 250 },
    { brand: "crbn",      count: 22, avg: 251, min: 170, med: 250, max: 280 },
    { brand: "engage",    count: 19, avg: 175, min: 89,  med: 170, max: 249 },
    { brand: "six-zero",  count: 16, avg: 198, min: 89,  med: 195, max: 250 },
    { brand: "onix",      count: 13, avg:  78, min: 39,  med:  69, max: 159 },
    { brand: "wilson",    count: 10, avg: 124, min: 49,  med: 115, max: 219 },
    { brand: "gamma",     count:  5, avg: 102, min: 59,  med:  99, max: 169 },
    { brand: "prokennex", count:  2, avg: 145, min: 119, med: 145, max: 169 },
  ];

  // YouTube subs
  const yt = [
    { brand: "selkirk",   subs: 84200, videos: 142, views: 18200000, delta: +1840 },
    { brand: "joola",     subs: 38400, videos:  68, views:  5800000, delta: +210 },
    { brand: "engage",    subs: 28600, videos:  51, views:  3100000, delta: +680 },
    { brand: "crbn",      subs: 22100, videos:  47, views:  2400000, delta: +920 },
    { brand: "paddletek", subs: 18900, videos:  39, views:  1900000, delta: +110 },
    { brand: "six-zero",  subs: 14700, videos:  24, views:  1200000, delta: +320 },
    { brand: "franklin",  subs:  9200, videos:  12, views:   460000, delta: -10 },
    { brand: "onix",      subs:  6840, videos:   5, views:   180000, delta: -90 },
    { brand: "wilson",    subs:  4120, videos:   2, views:    52000, delta: +18 },
    { brand: "gamma",     subs:  2890, videos:   0, views:    21000, delta: 0 },
    { brand: "prokennex", subs:  1240, videos:   1, views:     9800, delta: -4 },
  ];

  // Reddit mentions (sentiment-split)
  const reddit = [
    { brand: "joola",     mentions: 92, positive: 41, neutral: 35, negative: 16, delta: +14 },
    { brand: "selkirk",   mentions: 78, positive: 28, neutral: 38, negative: 12, delta: +6 },
    { brand: "paddletek", mentions: 54, positive: 22, neutral: 24, negative:  8, delta: -2 },
    { brand: "crbn",      mentions: 41, positive: 19, neutral: 18, negative:  4, delta: +9 },
    { brand: "engage",    mentions: 32, positive: 15, neutral: 13, negative:  4, delta: +1 },
    { brand: "six-zero",  mentions: 28, positive: 14, neutral: 12, negative:  2, delta: +7 },
    { brand: "franklin",  mentions: 18, positive:  7, neutral:  9, negative:  2, delta: 0 },
    { brand: "onix",      mentions: 12, positive:  1, neutral:  4, negative:  7, delta: -1 },
    { brand: "wilson",    mentions:  7, positive:  3, neutral:  3, negative:  1, delta: 0 },
  ];

  // Trending keywords (Market Intel)
  const trends = [
    { rank: 1, kw: "MLP",                mentions: 18, joola: false, related: ["Selkirk","CRBN"] },
    { rank: 2, kw: "PPA Tour",           mentions: 14, joola: true,  related: ["Ben Johns","Anna Bright"] },
    { rank: 3, kw: "Ben Johns",          mentions: 12, joola: true,  related: ["Perseus","JOOLA"] },
    { rank: 4, kw: "Carbon fiber face",  mentions:  9, joola: true,  related: ["CRBN","Six Zero","Hyperion"] },
    { rank: 5, kw: "Tournament refund",  mentions:  7, joola: false, related: ["Selkirk","Franklin"] },
    { rank: 6, kw: "16mm core",          mentions:  6, joola: true,  related: ["Magnus","Perseus"] },
  ];

  // Top influencers
  const influencers = [
    { name: "Ben Johns",       brand: "joola",     followers: 284000, posts: 28, avgLikes: 18400, engRate: 6.48, init: "BJ" },
    { name: "Tyson McGuffin",  brand: "joola",     followers: 178000, posts: 22, avgLikes: 14200, engRate: 7.98, init: "TM" },
    { name: "Anna Bright",     brand: "joola",     followers: 142000, posts: 31, avgLikes:  9800, engRate: 6.90, init: "AB" },
    { name: "Andre Agassi",    brand: "joola",     followers: 410000, posts:  6, avgLikes: 24600, engRate: 6.00, init: "AA" },
    { name: "Riley Newman",    brand: "paddletek", followers:  98000, posts: 24, avgLikes:  8400, engRate: 8.57, init: "RN" },
    { name: "Zane Navratil",   brand: "paddletek", followers:  72000, posts: 19, avgLikes:  6100, engRate: 8.47, init: "ZN" },
    { name: "Catherine Parenteau", brand: "selkirk", followers: 89000, posts: 26, avgLikes: 7200, engRate: 8.09, init: "CP" },
    { name: "Jack Sock",       brand: "selkirk",   followers: 215000, posts:  8, avgLikes: 11400, engRate: 5.30, init: "JS" },
    { name: "Christian Alshon",brand: "crbn",      followers:  68000, posts: 18, avgLikes:  5900, engRate: 8.68, init: "CA" },
    { name: "Hayden Patriquin",brand: "engage",    followers:  41000, posts: 22, avgLikes:  4100, engRate: 10.00, init: "HP" },
  ];

  // Ad library sample
  const adSample = [
    { brand: "selkirk",  platform: "Google", copy: "VANGUARD POWER AIR — Hyper-light power. Free shipping over $99.", cta: "Shop Now", started: "May 9", active: true },
    { brand: "selkirk",  platform: "Meta",   copy: "The paddle Catherine Parenteau won the US Open with.", cta: "Learn More", started: "May 7", active: true },
    { brand: "crbn",     platform: "Google", copy: "Pro-grade carbon. Hand-built in San Diego.", cta: "Build Yours", started: "May 11", active: true },
    { brand: "joola",    platform: "Meta",   copy: "Ben Johns Perseus Pro IV. The world #1's paddle, refined.", cta: "Shop Perseus", started: "May 12", active: true },
    { brand: "paddletek",platform: "Google", copy: "Bantam ESQ-C — Tournament-tested control. From $189.", cta: "Compare Specs", started: "May 4", active: true },
    { brand: "franklin", platform: "Meta",   copy: "FS Tour Pro — Used by Tyler Loong & Anna Leigh Waters.", cta: "Shop FS Tour", started: "May 6", active: true },
    { brand: "engage",   platform: "Meta",   copy: "Pursuit MX — Comment GEAR for spec sheet via DM.", cta: "Learn More", started: "May 10", active: true },
    { brand: "six-zero", platform: "Google", copy: "Double Black Diamond — Premium control, premium price.", cta: "Shop Now", started: "May 8", active: true },
    { brand: "onix",     platform: "Google", copy: "Z5 Graphite — Clearance pricing while supplies last.", cta: "Shop Sale", started: "Apr 28", active: true },
  ];

  // Signal feed
  const signals = [
    { type: "ad",     brand: "selkirk",  desc: "Launched 12 new Google ads this week — outpacing JOOLA by 6.", when: "2h ago" },
    { type: "promo",  brand: "franklin", desc: "Sitewide 15% off — first promo since March.", when: "5h ago" },
    { type: "social", brand: "crbn",     desc: "Crossed 54K IG followers — closed gap to JOOLA by 1.2K this week.", when: "1d ago" },
    { type: "reddit", brand: "joola",    desc: "Reddit mentions +14% vs. last quarter — Perseus IV launch effect.", when: "1d ago" },
    { type: "product",brand: "onix",     desc: "Z5 Graphite re-listed at $69 (was $129) — inventory distress signal.", when: "2d ago" },
    { type: "ad",     brand: "paddletek",desc: "Cut 3 active campaigns — total spend pulling back.", when: "2d ago" },
    { type: "social", brand: "engage",   desc: "Pursuit MX Reel hit 184K views — 'comment GEAR' DM trigger working.", when: "3d ago" },
    { type: "ad",     brand: "crbn",     desc: "Bumped daily Meta budget on 'CRBN-1' line — +5 active ads.", when: "3d ago" },
  ];

  // Promotion calendar — 13 weeks x brand
  const calendar = (() => {
    const weeks = 13;
    const data = {};
    [
      ["selkirk", [0,1,1,2,2,3,2,3,4,3,3,4,4]],
      ["franklin",[0,0,1,1,2,2,1,2,3,2,3,3,2]],
      ["onix",    [1,1,2,1,1,1,1,1,1,1,1,1,1]],
      ["paddletek",[0,0,0,1,0,0,1,0,0,0,0,1,0]],
      ["engage",  [0,0,0,0,1,0,0,1,0,0,0,0,1]],
      ["joola",   [0,0,0,0,0,0,0,0,0,0,0,0,0]],
    ].forEach(([b,row]) => data[b] = row);
    return data;
  })();

  // -------------- Top IG posts --------------
  const topIGPosts = [
    { brand: "joola",     handle: "@joolausa",          caption: "Ben Johns unveils the Perseus Pro IV — the paddle behind 7 consecutive PPA wins.", likes: 28400, comments: 1240, views: 184000, format: "Reel", days: 2, engRate: 6.21 },
    { brand: "engage",    handle: "@engagepickleball",  caption: "Pursuit MX deep-dive — comment GEAR for the full spec sheet via DM.", likes: 5200, comments: 864, views: 184000, format: "Reel", days: 4, engRate: 3.27 },
    { brand: "selkirk",   handle: "@selkirksport",      caption: "Catherine Parenteau's US Open winning kit — VANGUARD POWER AIR series.", likes: 18600, comments: 412, views: 96000, format: "Reel", days: 3, engRate: 2.45 },
    { brand: "crbn",      handle: "@crbnpickleball",    caption: "Hand-built in San Diego. 16mm raw carbon. CRBN-1X drops Friday.", likes: 4800, comments: 318, views: 71000, format: "Carousel", days: 5, engRate: 1.42 },
    { brand: "joola",     handle: "@joolausa",          caption: "Anna Bright's training week — 6 days, 1 paddle, 0 excuses.", likes: 19200, comments: 642, views: 142000, format: "Reel", days: 1, engRate: 4.81 },
    { brand: "franklin",  handle: "@franklinpickleball",caption: "Tyler Loong shoutout — FS Tour Pro on tour this weekend.", likes: 1820, comments: 124, views: 24000, format: "Image", days: 6, engRate: 1.92 },
    { brand: "six-zero",  handle: "@sixzeropickleball", caption: "Double Black Diamond — for the player who wants every shot earned.", likes: 1640, comments: 88, views: 19000, format: "Image", days: 4, engRate: 1.62 },
    { brand: "paddletek", handle: "@paddletek",         caption: "Bantam ESQ-C — Riley Newman's tournament setup.", likes: 3640, comments: 142, views: 31000, format: "Reel", days: 5, engRate: 1.84 },
    { brand: "joola",     handle: "@joolausa",          caption: "JOOLA × Andre Agassi — limited drop, May 28.", likes: 24800, comments: 1820, views: 218000, format: "Reel", days: 0, engRate: 7.62 },
  ];

  // -------------- Top YT videos --------------
  const topYTVideos = [
    { brand: "selkirk",   title: "How Tyson McGuffin actually trains (2026 edition)", views: 1240000, likes: 38400, comments: 1820, duration: "14:22", days: 12 },
    { brand: "selkirk",   title: "Catherine Parenteau breaks down US Open final", views: 842000, likes: 24600, comments: 942, duration: "11:08", days: 8 },
    { brand: "joola",     title: "Ben Johns — Perseus Pro IV first look + spec walkthrough", views: 624000, likes: 18900, comments: 1140, duration: "08:42", days: 6 },
    { brand: "engage",    title: "Pursuit MX — every angle, every spec", views: 412000, likes: 9200, comments: 384, duration: "06:18", days: 14 },
    { brand: "crbn",      title: "Why pros are switching to raw carbon", views: 318000, likes: 8400, comments: 312, duration: "12:44", days: 9 },
    { brand: "joola",     title: "Anna Bright at home — gear, prep, mindset", views: 286000, likes: 7800, comments: 462, duration: "09:24", days: 4 },
    { brand: "paddletek", title: "Riley Newman's first 90 days with Bantam", views: 184000, likes: 4200, comments: 218, duration: "15:02", days: 16 },
    { brand: "six-zero",  title: "Double Black Diamond review — control king?", views: 142000, likes: 3800, comments: 184, duration: "10:38", days: 11 },
  ];

  // -------------- Top comments --------------
  const topComments = [
    { user: "@dinkmaster_42", text: "Just switched from Selkirk to JOOLA Perseus IV — never going back. The pop is unreal.", platform: "ig", brand: "joola", likes: 184, sentiment: "positive", days: 1 },
    { user: "@pblifer", text: "@engagepickleball comment GEAR — I want the full spec sheet please 🙏", platform: "ig", brand: "engage", likes: 142, sentiment: "neutral", days: 2 },
    { user: "@5.0plyr", text: "Anna Bright is the best pickleball content creator on the platform. End of discussion.", platform: "ig", brand: "joola", likes: 218, sentiment: "positive", days: 1 },
    { user: "@onixfanboy", text: "Z5 went on clearance again. That's the third time this year. Y'all OK?", platform: "ig", brand: "onix", likes: 96, sentiment: "negative", days: 3 },
    { user: "@picklenerd", text: "$300 for a paddle is wild. CRBN's positioning is interesting tho.", platform: "yt", brand: "crbn", likes: 412, sentiment: "neutral", days: 5 },
    { user: "@drillpartner", text: "Ben Johns could swing a frying pan and still win. Paddle doesn't matter at that level.", platform: "yt", brand: "joola", likes: 624, sentiment: "neutral", days: 6 },
    { user: "@dink_or_drink", text: "Selkirk's marketing is so much better than their paddles right now. Fight me.", platform: "ig", brand: "selkirk", likes: 184, sentiment: "negative", days: 2 },
    { user: "@4.5_climbing", text: "Paddletek signing Riley was a huge get. Hyperion fans should be nervous.", platform: "yt", brand: "paddletek", likes: 142, sentiment: "positive", days: 7 },
  ];

  // -------------- Subreddit breakdown --------------
  const subreddits = [
    { name: "r/pickleball", mentions: 218, joolaShare: 28 },
    { name: "r/pickleballgear", mentions: 84, joolaShare: 32 },
    { name: "r/pickleballcirclejerk", mentions: 32, joolaShare: 12 },
    { name: "r/pickleballcoaching", mentions: 18, joolaShare: 22 },
    { name: "r/sandbaggers", mentions: 10, joolaShare: 18 },
  ];

  // -------------- Reddit weekly trend --------------
  const redditTrend = {
    joola:     [62, 68, 72, 76, 80, 84, 88, 92],
    selkirk:   [88, 84, 82, 80, 78, 79, 77, 78],
    paddletek: [58, 60, 58, 56, 55, 54, 56, 54],
    crbn:      [22, 26, 28, 32, 35, 38, 40, 41],
    onix:      [22, 20, 18, 16, 14, 13, 12, 12],
  };

  // -------------- YT subs trend --------------
  const ytTrend = {
    selkirk:   [78400, 79200, 80100, 80900, 81700, 82500, 83400, 84200],
    joola:     [36800, 37100, 37400, 37700, 37900, 38100, 38300, 38400],
    engage:    [25400, 26000, 26500, 27000, 27500, 27900, 28300, 28600],
    crbn:      [18400, 19200, 19900, 20500, 21000, 21400, 21800, 22100],
    paddletek: [18400, 18500, 18600, 18700, 18750, 18800, 18850, 18900],
  };

  // -------------- IG post frequency heatmap (posts/day, 4 wks x 7 days) --------------
  const postFrequency = {
    joola:      [[2,1,2,3,4,1,0],[1,2,1,4,3,2,0],[2,2,3,3,4,1,1],[1,2,2,3,4,2,0]],
    selkirk:    [[3,2,3,4,4,2,1],[2,3,3,4,3,2,1],[2,2,3,4,4,2,1],[3,3,4,4,4,2,1]],
    crbn:       [[1,1,2,2,3,1,0],[1,2,1,2,3,1,0],[2,2,2,3,3,1,0],[2,2,3,3,4,1,0]],
    engage:     [[1,1,1,2,2,1,0],[1,1,2,2,2,1,0],[1,2,2,2,3,1,0],[1,2,2,3,3,1,0]],
    paddletek:  [[1,0,1,1,2,0,0],[0,1,1,2,1,0,0],[1,1,1,2,2,1,0],[0,1,1,2,2,0,0]],
  };

  return { BRANDS, ig, ads, promos, products, yt, reddit, trends, influencers, adSample, signals, calendar,
           topIGPosts, topYTVideos, topComments, subreddits, redditTrend, ytTrend, postFrequency };
})();
