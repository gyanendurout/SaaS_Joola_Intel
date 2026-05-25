/**
 * Platform Playbook helpers — rule-based "finding" generators that turn
 * existing scrape data into competitor-move / business-impact /
 * recommended-action rows. All derivers are PURE and return [] when the
 * input data is too thin to support a defensible finding.
 *
 * The shape mirrors the table contract documented in TODO_SESSION.md:
 *   Finding | Competitor | Evidence | JOOLA gap | Recommended action
 *
 * Each generator filters out JOOLA itself from the "Competitor" column
 * because the playbook is intentionally about what RIVALS are doing.
 */

import type {
  V2Brand,
  V2IGRow,
  V2TopIGPost,
  V2YTRow,
  V2TopYTVideo,
  V2YTVideoAnalysis,
  V2TikTokRow,
  V2TikTokVideo,
  V2TikTokCommentStats,
  V2TikTokPaddleMention,
  V2XRow,
  V2XPost,
  V2RedditRow,
  V2RedditMention,
  V2Subreddit,
  V2RedditViral,
  V2IGTheme,
} from '@/lib/v2/data'

export type PlaybookFinding = {
  finding: string
  competitor: string         // brand slug ('—' if cross-brand)
  evidence: string
  joolaGap: string
  action: string
}

const JOOLA = 'joola'

function brandName(slug: string, brands: V2Brand[]): string {
  return brands.find((b) => b.id === slug)?.name || slug
}

function pct(n: number): string {
  if (!isFinite(n)) return '—'
  return (n >= 0 ? '+' : '') + n.toFixed(0) + '%'
}

function isVideoFormat(f: string | undefined): boolean {
  const s = String(f || '').toUpperCase()
  return s === 'VIDEO' || s === 'REEL'
}

function isCarouselFormat(f: string | undefined): boolean {
  const s = String(f || '').toUpperCase()
  return s === 'CAROUSEL' || s === 'SIDECAR'
}

// ─── Instagram ────────────────────────────────────────────────────────
export function instagramPlaybook(
  brands: V2Brand[],
  ig: V2IGRow[],
  posts: V2TopIGPost[],
  themes: V2IGTheme[],
): PlaybookFinding[] {
  const out: PlaybookFinding[] = []

  // 1. Reels vs Carousel engagement
  const reels = posts.filter((p) => isVideoFormat(p.format))
  const carousels = posts.filter((p) => isCarouselFormat(p.format))
  if (reels.length >= 5 && carousels.length >= 5) {
    const avgReel = reels.reduce((s, p) => s + p.likes + p.comments, 0) / reels.length
    const avgCar = carousels.reduce((s, p) => s + p.likes + p.comments, 0) / carousels.length
    if (avgCar > 0) {
      const delta = ((avgReel - avgCar) / avgCar) * 100
      if (Math.abs(delta) >= 10) {
        const winner = delta > 0 ? 'Reels' : 'Carousels'
        out.push({
          finding: `${winner} drive ${pct(Math.abs(delta))} more engagement than ${delta > 0 ? 'Carousels' : 'Reels'}`,
          competitor: '—',
          evidence: `${reels.length} reels avg ${Math.round(avgReel).toLocaleString()} engagements · ${carousels.length} carousels avg ${Math.round(avgCar).toLocaleString()}`,
          joolaGap: 'Format mix audit required — verify JOOLA leans into the winning format',
          action: `Re-allocate IG content budget toward ${winner} in next sprint`,
        })
      }
    }
  }

  // 2. Brand that posts most reels vs JOOLA
  const reelsByBrand: Record<string, number> = {}
  posts.forEach((p) => {
    if (!isVideoFormat(p.format)) return
    reelsByBrand[p.brand] = (reelsByBrand[p.brand] || 0) + 1
  })
  const reelLeader = Object.entries(reelsByBrand)
    .filter(([slug]) => slug !== JOOLA && slug !== 'unknown')
    .sort((a, b) => b[1] - a[1])[0]
  const joolaReels = reelsByBrand[JOOLA] || 0
  if (reelLeader && reelLeader[1] > joolaReels && reelLeader[1] >= 3) {
    const ratio = joolaReels === 0 ? '∞' : (reelLeader[1] / joolaReels).toFixed(1) + '×'
    out.push({
      finding: `${brandName(reelLeader[0], brands)} posts ${ratio} more reels than JOOLA`,
      competitor: reelLeader[0],
      evidence: `${reelLeader[1]} reels in current sample vs JOOLA's ${joolaReels}`,
      joolaGap: 'Under-investing in short-form video on Instagram',
      action: `Match ${brandName(reelLeader[0], brands)}'s reel cadence (target ≥${reelLeader[1]} reels per period)`,
    })
  }

  // 3. Brand with strongest ER vs JOOLA
  const eligibleEr = ig.filter((r) => r.followers >= 50 && r.engRate < 100)
  const erSorted = [...eligibleEr].sort((a, b) => b.engRate - a.engRate)
  const erLeader = erSorted.find((r) => r.brand !== JOOLA)
  const joolaEr = ig.find((r) => r.brand === JOOLA)?.engRate
  if (erLeader && joolaEr != null && erLeader.engRate > joolaEr + 0.5) {
    out.push({
      finding: `${brandName(erLeader.brand, brands)} engagement rate beats JOOLA by ${(erLeader.engRate - joolaEr).toFixed(2)}pp`,
      competitor: erLeader.brand,
      evidence: `${erLeader.engRate.toFixed(2)}% ER on ${erLeader.followers.toLocaleString()} followers · JOOLA ${joolaEr.toFixed(2)}%`,
      joolaGap: 'Engagement per post is below the top-performing brand',
      action: 'Audit captions, CTAs, and posting times of leader to extract repeatable patterns',
    })
  }

  // 4. Dominant content theme by competitor
  themes
    .filter((t) => t.brand !== JOOLA && t.theme)
    .slice(0, 3)
    .forEach((t) => {
      out.push({
        finding: `${brandName(t.brand, brands)} dominant theme: "${t.theme}"`,
        competitor: t.brand,
        evidence: `ig_profiles_weekly · most frequent content theme in last 30 posts`,
        joolaGap: 'Theme overlap unknown — verify JOOLA owns or differentiates this topic',
        action: `Produce 1-2 IG posts addressing "${t.theme}" angle to test resonance`,
      })
    })

  return out
}

// ─── YouTube ──────────────────────────────────────────────────────────
export function youtubePlaybook(
  brands: V2Brand[],
  yt: V2YTRow[],
  videos: V2TopYTVideo[],
  analyses: V2YTVideoAnalysis[],
): PlaybookFinding[] {
  const out: PlaybookFinding[] = []

  // 1. Shorts vs long-form views-per-minute
  const shorts = videos.filter((v) => v.is_short)
  const longs = videos.filter((v) => !v.is_short)
  if (shorts.length >= 3 && longs.length >= 3) {
    const avgShort = shorts.reduce((s, v) => s + v.views, 0) / shorts.length
    const avgLong = longs.reduce((s, v) => s + v.views, 0) / longs.length
    if (avgLong > 0) {
      const ratio = avgShort / avgLong
      if (Math.abs(ratio - 1) > 0.2) {
        const winner = ratio > 1 ? 'Shorts' : 'Long-form'
        out.push({
          finding: `${winner} get ${ratio.toFixed(1)}× the average views of ${ratio > 1 ? 'long-form' : 'shorts'}`,
          competitor: '—',
          evidence: `${shorts.length} shorts avg ${Math.round(avgShort).toLocaleString()} views · ${longs.length} long-form avg ${Math.round(avgLong).toLocaleString()}`,
          joolaGap: `YouTube content mix may not reflect this ${winner.toLowerCase()} advantage`,
          action: `Increase ${winner.toLowerCase()} publishing cadence on JOOLA channel`,
        })
      }
    }
  }

  // 2. Top competitor channel videos vs JOOLA
  const vidsByBrand: Record<string, number> = {}
  videos.forEach((v) => { vidsByBrand[v.brand] = (vidsByBrand[v.brand] || 0) + 1 })
  const vidLeader = Object.entries(vidsByBrand)
    .filter(([slug]) => slug !== JOOLA && slug !== 'unknown')
    .sort((a, b) => b[1] - a[1])[0]
  const joolaVids = vidsByBrand[JOOLA] || 0
  if (vidLeader && vidLeader[1] > joolaVids * 1.5 && vidLeader[1] >= 5) {
    const ratio = joolaVids === 0 ? '∞' : (vidLeader[1] / joolaVids).toFixed(1) + '×'
    out.push({
      finding: `${brandName(vidLeader[0], brands)} ships ${ratio} more videos than JOOLA`,
      competitor: vidLeader[0],
      evidence: `${vidLeader[1]} videos in top-200 vs JOOLA's ${joolaVids}`,
      joolaGap: 'Publishing cadence lagging the top YouTube competitor',
      action: `Set weekly upload target matching ${brandName(vidLeader[0], brands)}'s cadence`,
    })
  }

  // 3. Performance thesis frequency from yt_video_analysis
  const thesisCounts: Record<string, { count: number; views: number; brand: string }> = {}
  analyses.forEach((a) => {
    if (!a.performanceThesis) return
    const key = a.performanceThesis.slice(0, 80)
    if (!thesisCounts[key]) thesisCounts[key] = { count: 0, views: 0, brand: a.brand }
    thesisCounts[key].count++
    thesisCounts[key].views += a.views
  })
  const topThesis = Object.entries(thesisCounts).sort((a, b) => b[1].views - a[1].views)[0]
  if (topThesis && topThesis[1].count >= 2) {
    out.push({
      finding: `Performance thesis "${topThesis[0]}" recurs across top-performing videos`,
      competitor: topThesis[1].brand !== 'unknown' ? topThesis[1].brand : '—',
      evidence: `${topThesis[1].count} videos · ${topThesis[1].views.toLocaleString()} combined views (yt_video_analysis)`,
      joolaGap: 'Pattern not yet codified in JOOLA video brief template',
      action: 'Add this thesis to the JOOLA content brief checklist',
    })
  }

  // 4. Subs leader vs JOOLA
  const subSorted = [...yt].sort((a, b) => b.subs - a.subs)
  const subLeader = subSorted.find((r) => r.brand !== JOOLA && r.subs > 0)
  const joolaSubs = yt.find((r) => r.brand === JOOLA)?.subs || 0
  if (subLeader && subLeader.subs > joolaSubs * 1.2) {
    out.push({
      finding: `${brandName(subLeader.brand, brands)} leads YouTube subscriber count`,
      competitor: subLeader.brand,
      evidence: `${subLeader.subs.toLocaleString()} subs vs JOOLA ${joolaSubs.toLocaleString()}`,
      joolaGap: `Behind by ${(subLeader.subs - joolaSubs).toLocaleString()} subscribers`,
      action: 'Run subscriber-growth-focused video series + collab requests with leader influencers',
    })
  }

  return out
}

// ─── TikTok ───────────────────────────────────────────────────────────
export function tiktokPlaybook(
  brands: V2Brand[],
  tt: V2TikTokRow[],
  videos: V2TikTokVideo[],
  commentStats: V2TikTokCommentStats[],
  paddleMentions: V2TikTokPaddleMention[],
): PlaybookFinding[] {
  const out: PlaybookFinding[] = []

  // 1. Avg comments per video leader
  const cmtPerVid: { brand: string; ratio: number; videos: number; comments: number }[] = []
  videos.forEach((v) => { /* aggregated below */ })
  const cmtAgg: Record<string, { comments: number; videos: number }> = {}
  videos.forEach((v) => {
    if (!cmtAgg[v.brand]) cmtAgg[v.brand] = { comments: 0, videos: 0 }
    cmtAgg[v.brand].comments += v.comments
    cmtAgg[v.brand].videos++
  })
  Object.entries(cmtAgg).forEach(([brand, x]) => {
    if (x.videos > 0) cmtPerVid.push({ brand, ratio: x.comments / x.videos, videos: x.videos, comments: x.comments })
  })
  const cmtSorted = cmtPerVid.sort((a, b) => b.ratio - a.ratio)
  const cmtLeader = cmtSorted.find((r) => r.brand !== JOOLA && r.brand !== 'unknown')
  const joolaCmt = cmtPerVid.find((r) => r.brand === JOOLA)
  if (cmtLeader && (!joolaCmt || cmtLeader.ratio > joolaCmt.ratio * 1.3)) {
    out.push({
      finding: `${brandName(cmtLeader.brand, brands)} averages ${Math.round(cmtLeader.ratio)} comments per TikTok`,
      competitor: cmtLeader.brand,
      evidence: `${cmtLeader.comments.toLocaleString()} comments across ${cmtLeader.videos} videos · JOOLA avg ${joolaCmt ? Math.round(joolaCmt.ratio) : 0}`,
      joolaGap: 'Lower comment density signals weaker TikTok hook discipline',
      action: 'Audit competitor hook-frames + CTAs; replicate the top 3 patterns',
    })
  }

  // 2. Sentiment leader
  const sentSorted = [...commentStats]
    .filter((s) => s.total >= 20)
    .map((s) => ({
      ...s,
      score: (s.positive - s.negative) / s.total,
    }))
    .sort((a, b) => b.score - a.score)
  const sentLeader = sentSorted.find((r) => r.brand !== JOOLA)
  if (sentLeader && sentLeader.score > 0.1) {
    out.push({
      finding: `${brandName(sentLeader.brand, brands)} TikTok comments skew positive (net ${(sentLeader.score * 100).toFixed(0)}%)`,
      competitor: sentLeader.brand,
      evidence: `${sentLeader.positive} positive / ${sentLeader.negative} negative across ${sentLeader.total} comments`,
      joolaGap: 'Competitor audience is more engaged + on-side',
      action: 'Study comment threads for product-feature framing that resonates',
    })
  }

  // 3. Top paddle mention (competitor)
  const compMention = paddleMentions.find((p) => p.brand !== JOOLA)
  if (compMention) {
    out.push({
      finding: `Most-mentioned competitor paddle on TikTok: "${compMention.paddle}"`,
      competitor: compMention.brand,
      evidence: `${compMention.mentions} TikTok comment mentions (${brandName(compMention.brand, brands)})`,
      joolaGap: 'Competitor paddle owns share-of-voice in TikTok commentary',
      action: `Brief sponsored athletes to feature JOOLA paddle in side-by-side comparison content`,
    })
  }

  // 4. Total hearts leader
  const heartLeader = [...tt].filter((r) => r.brand !== JOOLA && r.totalHearts > 0).sort((a, b) => b.totalHearts - a.totalHearts)[0]
  const joolaHearts = tt.find((r) => r.brand === JOOLA)?.totalHearts || 0
  if (heartLeader && heartLeader.totalHearts > joolaHearts * 1.5) {
    out.push({
      finding: `${brandName(heartLeader.brand, brands)} leads TikTok hearts (likes) total`,
      competitor: heartLeader.brand,
      evidence: `${heartLeader.totalHearts.toLocaleString()} hearts vs JOOLA ${joolaHearts.toLocaleString()}`,
      joolaGap: 'Cumulative TikTok virality below leader',
      action: 'Identify leader\'s top 5 videos and reverse-engineer the hook/edit format',
    })
  }

  return out
}

// ─── X / Twitter ──────────────────────────────────────────────────────
export function twitterPlaybook(
  brands: V2Brand[],
  x: V2XRow[],
  posts: V2XPost[],
): PlaybookFinding[] {
  const out: PlaybookFinding[] = []

  // 1. Reply-to-OP ratio per brand (engagement quality proxy)
  const ratioByBrand: { brand: string; ratio: number; replies: number; n: number }[] = []
  const grp: Record<string, { replies: number; n: number }> = {}
  posts.forEach((p) => {
    if (!grp[p.brand]) grp[p.brand] = { replies: 0, n: 0 }
    grp[p.brand].replies += p.replies
    grp[p.brand].n++
  })
  Object.entries(grp).forEach(([brand, g]) => {
    if (g.n >= 3) ratioByBrand.push({ brand, ratio: g.replies / g.n, replies: g.replies, n: g.n })
  })
  const replySorted = ratioByBrand.sort((a, b) => b.ratio - a.ratio)
  const replyLeader = replySorted.find((r) => r.brand !== JOOLA && r.brand !== 'unknown')
  const joolaReply = ratioByBrand.find((r) => r.brand === JOOLA)
  if (replyLeader && (!joolaReply || replyLeader.ratio > joolaReply.ratio * 1.3)) {
    out.push({
      finding: `${brandName(replyLeader.brand, brands)} averages ${replyLeader.ratio.toFixed(1)} replies per tweet`,
      competitor: replyLeader.brand,
      evidence: `${replyLeader.replies} replies across ${replyLeader.n} tweets · JOOLA avg ${joolaReply ? joolaReply.ratio.toFixed(1) : '0'}`,
      joolaGap: 'Lower reply density = weaker conversation generation',
      action: 'Switch from broadcast tweets to question-based + reply-bait formats',
    })
  }

  // 2. Tweet frequency vs followers
  const tweetSorted = [...x].sort((a, b) => b.tweets - a.tweets)
  const tweetLeader = tweetSorted.find((r) => r.brand !== JOOLA && r.tweets > 0)
  const joolaTweets = x.find((r) => r.brand === JOOLA)?.tweets || 0
  if (tweetLeader && tweetLeader.tweets > joolaTweets * 1.5) {
    out.push({
      finding: `${brandName(tweetLeader.brand, brands)} posts the most tweets in the sample`,
      competitor: tweetLeader.brand,
      evidence: `${tweetLeader.tweets} tweets vs JOOLA ${joolaTweets}`,
      joolaGap: 'Tweet cadence below top competitor',
      action: 'Lift JOOLA weekly tweet cadence to within 1.2× of leader',
    })
  }

  // 3. ER leader
  const erSorted = [...x].filter((r) => r.followers > 0).sort((a, b) => b.engRate - a.engRate)
  const erLeader = erSorted.find((r) => r.brand !== JOOLA && r.engRate > 0)
  if (erLeader) {
    out.push({
      finding: `${brandName(erLeader.brand, brands)} averages ${erLeader.engRate.toFixed(1)} engagements per tweet`,
      competitor: erLeader.brand,
      evidence: `${erLeader.followers.toLocaleString()} followers · ${erLeader.tweets} tweets sampled`,
      joolaGap: 'Audience resonance per tweet trails competitor',
      action: 'Study leader\'s top-engagement tweets for media + format patterns',
    })
  }

  return out
}

// ─── Reddit ───────────────────────────────────────────────────────────
export function redditPlaybook(
  brands: V2Brand[],
  reddit: V2RedditRow[],
  subreddits: V2Subreddit[],
  mentions: V2RedditMention[],
  viral: V2RedditViral[],
): PlaybookFinding[] {
  const out: PlaybookFinding[] = []

  // 1. Subreddit-concentration finding
  if (subreddits.length > 0) {
    const total = subreddits.reduce((s, r) => s + r.mentions, 0) || 1
    const top = subreddits[0]
    const share = (top.mentions / total) * 100
    if (share >= 30) {
      out.push({
        finding: `${top.name} drives ${share.toFixed(0)}% of Reddit mentions`,
        competitor: '—',
        evidence: `${top.mentions.toLocaleString()} of ${total.toLocaleString()} total mentions`,
        joolaGap: 'High concentration — single subreddit shift could spike or sink JOOLA presence',
        action: `Assign analyst to monitor ${top.name} weekly for sentiment shifts`,
      })
    }
  }

  // 2. Most-mentioned competitor
  const compSorted = [...reddit].filter((r) => r.brand !== JOOLA && r.mentions > 0).sort((a, b) => b.mentions - a.mentions)
  const compLeader = compSorted[0]
  const joolaR = reddit.find((r) => r.brand === JOOLA)
  if (compLeader && joolaR && compLeader.mentions > joolaR.mentions) {
    const delta = compLeader.mentions - joolaR.mentions
    out.push({
      finding: `${brandName(compLeader.brand, brands)} mentioned ${delta} more times than JOOLA on Reddit`,
      competitor: compLeader.brand,
      evidence: `${compLeader.mentions} mentions vs JOOLA's ${joolaR.mentions} (last 30d window)`,
      joolaGap: 'Share-of-voice trailing top competitor',
      action: 'Plant 2-3 user-style threads asking JOOLA-paddle questions in r/pickleball',
    })
  }

  // 3. Viral velocity spike
  const v = viral.find((r) => r.brand !== JOOLA && r.velocity > 0)
  if (v) {
    out.push({
      finding: `${brandName(v.brand, brands)} thread "${v.title.slice(0, 60)}" velocity ${v.velocity.toFixed(1)} upvotes/hr`,
      competitor: v.brand,
      evidence: `r/${v.subreddit} · current score ${v.score} · ${v.days}d old`,
      joolaGap: 'No JOOLA response detected on viral competitor thread',
      action: 'Surface to comms team within 24h; consider a polite branded reply',
    })
  }

  // 4. Negative-sentiment competitor
  const negSorted = [...reddit]
    .filter((r) => r.brand !== JOOLA && r.mentions >= 5)
    .map((r) => ({ ...r, negPct: r.negative / Math.max(1, r.mentions) }))
    .sort((a, b) => b.negPct - a.negPct)
  if (negSorted[0] && negSorted[0].negPct >= 0.2) {
    const r = negSorted[0]
    out.push({
      finding: `${brandName(r.brand, brands)} carries ${(r.negPct * 100).toFixed(0)}% negative sentiment on Reddit`,
      competitor: r.brand,
      evidence: `${r.negative} negative / ${r.mentions} total mentions`,
      joolaGap: 'Opportunity — competitor sentiment is weak in community channels',
      action: 'Create comparison content that highlights JOOLA strengths against weak signals',
    })
  }

  return out
}
