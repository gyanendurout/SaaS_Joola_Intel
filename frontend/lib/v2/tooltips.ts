/**
 * Shared layman explanations for table column headers.
 *
 * Why this exists: the same column ("Likes", "ER", "Posted", "Δ Mentions")
 * appears on a dozen pages. Writing the explanation inline each time guarantees
 * they drift apart and half of them get skipped — the 2026-08-24 audit found
 * 170 column headers with no tooltip at all.
 *
 * House style for these strings:
 *   - Explain what the number MEANS to a non-analyst, not where it came from.
 *     Source attribution belongs in <SectionInfo source=…>, not here.
 *   - No schema words: no table names, column names, joins, nulls, or SQL.
 *   - Say what a HIGH or LOW value implies when that is not obvious.
 *   - One or two sentences. These render as a native browser tooltip.
 *
 * Usage:
 *   import { tipFor } from '@/lib/v2/tooltips'
 *   <th title={tipFor('Likes')}>Likes</th>
 *   <SortTh col="er" label="ER" title={tipFor('ER')} … />
 */

const TIPS: Record<string, string> = {
  // ── identity / dimensions
  'brand': 'Which pickleball brand this row is about. JOOLA is highlighted in green so you can spot it quickly.',
  'brand · handle': 'The brand, and the social media account name it posts under.',
  'product': 'The paddle this row is about.',
  'products': 'How many different paddles this brand has in the tracked catalogue.',
  'player': 'The professional player or content creator this row is about.',
  'athlete': 'The professional player this mention or sponsorship refers to.',
  'players': 'How many sponsored players this brand has on its roster.',
  'category': 'The type of product — for example paddle, ball, bag or apparel.',
  'channel': 'Which platform this came from — Instagram, YouTube, Reddit, TikTok or X.',
  'platform': 'Which website or app the ad or post ran on.',
  'subreddit': 'The Reddit community the post was published in.',
  'type': 'What kind of promotion this is — for example a percentage discount, free shipping, or a bundle.',
  'format': 'The kind of post — a single image, a carousel of images, a Reel, or a video.',
  'source': 'Where this piece of information was collected from.',
  'method': 'How this number was worked out.',
  'driver': 'The activity being tested as a possible cause — for example ad spend or promotions.',
  'title': 'The headline of the post or video.',
  'caption': 'The text the brand wrote alongside the post.',
  'post': 'The text of the post.',
  'copy': 'The wording used in the ad.',
  'cta': 'The "call to action" — the button or phrase telling you what to do next, like "Shop now".',
  'promo text': 'The exact wording of the offer as shown to shoppers.',
  'summary': 'A short plain-language recap of what was said.',

  // ── audience / reach
  'followers': 'How many people follow this account. A bigger audience is not automatically better — check the engagement rate too.',
  'ig followers': 'How many people follow this brand on Instagram.',
  'subscribers': 'How many people subscribe to this YouTube channel.',
  'subs': 'How many people subscribe to this YouTube channel.',
  'reach': 'Roughly how many people could have seen this content.',
  'active': 'How many are currently active rather than dormant.',

  // ── volume
  'posts': 'How many posts were published in this period.',
  'videos': 'How many videos were published in this period.',
  'yt videos': 'How many YouTube videos this brand published.',
  'tweets': 'How many posts this account published on X (formerly Twitter).',
  'mentions': 'How many times this was talked about across the tracked platforms.',
  '7d mentions': 'How many times this was talked about in the last 7 days.',
  '30d mentions': 'How many times this was talked about in the last 30 days.',
  'total': 'The combined count across everything shown in this table.',
  'total views': 'Every view this channel has accumulated, across all its videos.',
  'total hearts': 'Every like this account has accumulated, across all its videos.',

  // ── engagement
  'likes': 'How many people tapped like. The simplest signal that a post landed well.',
  'comments': 'How many people wrote a reply. Comments take more effort than a like, so they signal stronger interest.',
  'shares': 'How many people shared this with someone else — usually the strongest sign that content resonated.',
  'rts': 'Reposts — how many people shared this to their own followers.',
  'replies': 'How many people wrote a response.',
  'views': 'How many times this was watched or seen.',
  'engagement': 'Likes, comments and shares added together.',
  'eng.': 'Likes, comments and shares added together.',
  'er': 'Engagement rate — engagement divided by followers, as a percentage. It lets you fairly compare a small account against a large one.',
  'eng rate': 'Engagement rate — engagement divided by followers, as a percentage. It lets you fairly compare a small account against a large one.',
  'eng. rate': 'Engagement rate — engagement divided by followers, as a percentage. It lets you fairly compare a small account against a large one.',
  'avg er': 'The typical engagement rate across this group.',
  'avg likes': 'The typical number of likes per post.',
  'avg comments': 'The typical number of comments per post.',
  'avg views': 'The typical number of views per post.',
  'avg eng': 'The typical engagement per post.',
  'score': 'The post’s net upvotes on Reddit — upvotes minus downvotes.',

  // ── sentiment
  'sentiment': 'Whether people are speaking positively, neutrally or negatively.',
  'sentiment 7d': 'Whether people spoke positively or negatively over the last 7 days.',
  'negative %': 'The share of comments that were negative. A rising figure is an early warning sign.',
  'pos%': 'The share of comments that were positive.',
  'neg%': 'The share of comments that were negative. A rising figure is an early warning sign.',
  'crisis': 'Comments flagged as a potential problem — safety, breakage, or a complaint likely to escalate.',
  'severity': 'How serious the issue looks, so you can triage the worst first.',

  // ── money / stock
  'price': 'The current selling price.',
  'avg price': 'The typical price across the paddles in this group.',
  'discount': 'How much has been knocked off the usual price.',
  'avg discount': 'The typical discount being offered across this brand’s range.',
  'stock': 'Whether the item is available to buy right now.',
  'status': 'The current state of this item.',
  'stock status': 'Whether shoppers can buy this right now, or it has sold out.',
  'in stock': 'How many paddles are available to buy right now.',
  'out of stock': 'How many paddles have sold out. A competitor selling out is an opening for JOOLA.',
  'stockout opps': 'Sold-out competitor paddles — shoppers wanting these need an alternative, which is an opportunity for JOOLA.',
  'revenue': 'Estimated money taken.',
  'revenue signal': 'An estimate of sales direction, based on reviews and stock movement rather than reported figures. Treat it as a trend, not an exact number.',
  'est. units sold': 'An estimate of how many were sold. Inferred from public signals, so use it for comparison rather than as an exact figure.',
  'demand 30d': 'How much interest this brand attracted over the last 30 days.',
  'sales likelihood': 'How likely this paddle is to be selling well, based on how much attention it is getting and whether it is in stock.',
  'prev qty': 'The quantity recorded at the previous check.',
  'curr qty': 'The quantity recorded at the most recent check.',
  'delta': 'The change between the two checks. Negative means stock went down, which usually means sales.',

  // ── ads / promos
  'active ads': 'How many adverts this brand is currently running.',
  'active promos': 'How many offers or discounts this brand currently has live.',
  'ad share %': 'This brand’s share of all the advertising being run by the brands you are viewing.',
  'promo share %': 'This brand’s share of all the discounting being run by the brands you are viewing.',
  'pressure score': 'How aggressively this brand is pushing ads and offers compared with the others.',
  'product attention': 'How much of the online conversation this brand’s products are capturing.',
  '30d mentions ': 'How many times this was talked about in the last 30 days.',

  // ── time
  'posted': 'When this was originally published.',
  'date': 'The date this happened.',
  'detected': 'When we first spotted this.',
  'first seen': 'The first time this appeared in our tracking.',
  'last seen': 'The most recent time this appeared in our tracking.',
  'age': 'How long this has been running.',
  'time': 'When this happened.',
  'duration': 'How long the video runs.',
  'posted at': 'When this was originally published.',
  'last snapshot': 'The last time we checked this item.',

  // ── statistics
  'best lag': 'The delay that gave the strongest match — for example, ads showing an effect 7 days later.',
  '|r|': 'How strongly two things move together, from 0 (no relationship) to 1 (they move in lockstep). It does not prove one causes the other.',
  'r (signed)': 'How strongly two things move together. Positive means they rise together; negative means one rises as the other falls.',
  'p': 'How likely this pattern could have appeared by chance. Below 0.05 is the usual bar for taking it seriously.',
  'n': 'How many data points the finding is based on. Small numbers are easy to mislead yourself with.',
  'confidence': 'How much trust to place in this figure.',
  'verification': 'Whether this account has been confirmed as genuine by the platform.',

  // ── per-channel mention counts (columns in cross-channel tables)
  'ig': 'How many of these mentions came from Instagram.',
  'yt': 'How many of these mentions came from YouTube.',
  'reddit': 'How many of these mentions came from Reddit.',
  'tiktok': 'How many of these mentions came from TikTok.',
  'x': 'How many of these mentions came from X (formerly Twitter).',

  // ── rolling time-window columns
  '7d': 'The figure for the last 7 days.',
  '30d': 'The figure for the last 30 days.',
  '90d': 'The figure for the last 90 days.',
  'all': 'The figure across all time we have data for.',

  // ── remaining one-offs
  'avg views/vid': 'The typical number of views each video gets. More useful than total views, which just rewards posting a lot.',
  'sub': 'The change in how many people subscribe to this channel since the last check.',
  'flw': 'The change in how many people follow this account since the last check.',
  'event': 'What happened — for example a restock, a sell-out, or a price change.',
  'signal': 'What this reading suggests is happening.',

  // -- analysis / recommendation columns
  'trend': 'Which way this number has been moving recently.',
  'action': 'The suggested next step based on what this row shows.',
  'recommended action': 'The suggested next step based on what this row shows.',
  'recommended response': 'How we suggest JOOLA reacts to this.',
  'recommended investigation': 'What to look into next to work out why this happened.',
  'possible cause': 'The most likely explanation, based on what else changed at the same time.',
  'signal changed': 'The measurement that shifted noticeably.',
  'what it means': 'A plain-language read of what this finding implies.',
  'business meaning': 'Why this matters commercially, in plain language.',
  'finding': 'What the analysis turned up.',
  'evidence': 'The facts this conclusion rests on.',
  'reason': 'Why this happened, or why it was flagged.',
  'recommendation': 'What we suggest doing about it.',
  'opportunity': 'An opening JOOLA could act on.',
  'joola opportunity': 'An opening for JOOLA created by what a competitor is doing.',
  'joola comparable': 'The closest equivalent JOOLA paddle, for a like-for-like comparison.',
  'closest joola paddle': 'The JOOLA paddle most similar to this one, for a fair comparison.',
  'joola gap': 'How far ahead or behind JOOLA is here.',
  'gap': 'The difference between JOOLA and the brand being compared.',
  'joola rank': 'Where JOOLA places against the other tracked brands.',
  'winner': 'The brand currently leading in this area.',
  'competitor': 'The rival brand this row compares against.',
  'competitor product': 'The rival paddle this row is about.',
  'biggest threat': 'The competitor posing the greatest challenge here.',
  'threat level': 'How serious the competitive risk looks.',
  'impact score': 'How much difference this is likely to make, on a relative scale.',
  'likely owner': 'The brand this mention most probably refers to.',

  // -- counts / shares
  'count': 'How many times this occurred.',
  'occurrences': 'How many times this came up.',
  'rank': 'Position in the list, best first.',
  'ads': 'How many adverts were running.',
  'share': 'This brand’s slice of the total, as a percentage.',
  'signals': 'How many separate pieces of evidence point to this.',
  'positive': 'How many were positive.',
  'negative': 'How many were negative.',
  'positive %': 'The share that were positive.',
  'growth': 'How much this grew over the period.',
  'growth %': 'How much this grew over the period, as a percentage.',
  'product mentions': 'How many times a specific paddle was named.',
  'product mentioned': 'The paddle that was named.',
  'paddle': 'The paddle this row is about.',
  'related paddle': 'The paddle this content is about.',
  '# products': 'How many different paddles this covers.',
  'number of products': 'How many different paddles this covers.',
  'attention': 'How much of the online conversation this is capturing.',
  'platforms': 'Which social platforms this account posts on.',
  'top platform': 'The platform where this performs best.',
  'top channel': 'The platform driving the most of this.',
  'main channel': 'The platform where most of this conversation happens.',
  'channels seen': 'The platforms this came up on.',
  'brands talking': 'How many different brands were mentioned in the conversation.',
  'top content': 'The best performing piece of content.',
  'top complaint topic': 'The problem people raise most often.',
  'theme': 'The recurring subject running through this content.',
  'class': 'The group this has been sorted into.',
  'tier': 'The size band this account falls into - for example nano, micro or macro.',
  'video': 'The video this row is about.',
  'performance thesis': 'A short explanation of why this content did well or badly.',
  'mention text': 'The exact words used in the mention.',
  'example': 'A representative example.',
  'examples': 'A few representative examples.',

  // -- influencer / reply columns
  'sponsored posts': 'Posts the brand paid for.',
  'organic posts': 'Posts published without payment.',
  'sponsored er': 'Engagement rate on paid posts.',
  'organic er': 'Engagement rate on unpaid posts.',
  'joola response': 'Whether JOOLA replied, and what it said.',
  'avg response': 'How long the brand typically takes to reply.',
  'complaints replied': 'How many complaints the brand answered.',
  'complaints ignored': 'How many complaints the brand left unanswered.',

  // -- competitive switching
  'from': 'The brand the person was using before.',
  'to': 'The brand the person moved to.',

  // -- promos / pricing detail
  'promo type': 'What kind of offer this is.',
  'discount depth': 'How big the discount is.',
  'discount %': 'How big the discount is, as a percentage.',
  '% discounted': 'The share of this range currently on offer.',
  'frequency': 'How often this happens.',
  'last detected': 'The most recent time we saw this.',
  'product affected': 'The paddle this applies to.',
  'current price': 'What it costs today.',
  'price range': 'The cheapest and most expensive in this group.',
  'avg full price': 'The typical price before any discount.',
  'avg rating': 'The typical customer star rating out of 5.',
  '90d index': 'Today’s price compared with the last 90 days. Above 100 means pricier than usual.',
  'launch date': 'When this paddle first went on sale.',
  'pre (14d)': 'The figure for the 14 days before the event.',
  'post (14d)': 'The figure for the 14 days after the event.',

  // -- stock detail
  'stock health': 'A quick read on whether this brand is keeping paddles in stock.',
  'restock pattern': 'How regularly this paddle comes back into stock.',
  'pattern': 'The regular behaviour we have observed.',
  'last in stock': 'The last time this was available to buy.',
  'most recent restock': 'The last time stock was replenished.',
  'avg days between restocks': 'The typical wait between restocks.',
  'demand': 'How much interest this attracted in the period shown.',
  'demand (30d)': 'How much interest this attracted in the last 30 days.',
  'demand (30d mentions)': 'How many times this was talked about in the last 30 days.',
  'qty': 'The quantity recorded.',

  // -- stats detail
  'sig.': 'Whether the result is strong enough to take seriously rather than being chance.',
  'leading signal': 'The activity that appears to move first.',
  'outcome': 'The result being explained.',
  'lag (days)': 'How many days pass before the effect shows up.',

  // -- data health / QA
  'area': 'Which part of the system this covers.',
  'table': 'The dataset being checked.',
  'last refresh': 'When this data was last updated.',
  'coverage': 'How complete this data is.',
  'issue': 'The problem detected.',
  'feedback': 'Whether the answer was marked helpful or unhelpful.',
  'question': 'The question that was asked.',
  'visuals': 'How many charts or tables the answer included.',
  'latency': 'How long the answer took to produce.',
  'when': 'When this happened.',
  'original purpose': 'What this section was originally built to show.',
  'data source': 'Where this section gets its numbers from.',

  // ── misc
  'short?': 'Whether this is a short vertical video rather than a standard one.',
  'top video': 'This channel’s best performing video in the period.',
  'top post': 'This account’s best performing post in the period.',
  'profile': 'The account this row describes.',
  'content type': 'What kind of content this is — for example a review, a tutorial, or a highlight.',
}

/** Column headers whose meaning is self-evident; deliberately left untipped. */
const NO_TIP_NEEDED = new Set(['#', '', '-', 'detail', 'expand', 'link', 'view', 'actions'])

/**
 * Normalise a header label so display variants collapse onto one entry:
 * strips delta symbols, trailing units, footnote markers and casing.
 */
function normalise(label: string): string {
  return label
    .toLowerCase()
    .replace(/[Δδ]/g, '')
    .replace(/\((wk|week|30d|7d|90d)\)/g, '')
    .replace(/[*†‡]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Layman explanation for a column header, or undefined when none applies.
 *
 * Returning undefined (rather than a placeholder) is deliberate: React omits a
 * `title` attribute set to undefined, so an unmapped header renders cleanly
 * instead of showing an empty tooltip box.
 */
export function tipFor(label: string): string | undefined {
  const key = normalise(label)
  if (NO_TIP_NEEDED.has(key)) return undefined
  if (TIPS[key]) return TIPS[key]

  // "Sub Δ" / "Flw Δ (wk)" style change columns: describe the change of the
  // underlying metric rather than failing to match.
  const base = key.replace(/^(sub|subs|flw|follower|mention)s?\b.*/, '$1')
  if (base !== key && TIPS[base]) {
    return `The change in ${TIPS[base].charAt(0).toLowerCase()}${TIPS[base].slice(1)}`
  }
  return undefined
}

/** Exposed for the coverage test in qa/. */
export const TOOLTIP_KEYS = Object.keys(TIPS)
