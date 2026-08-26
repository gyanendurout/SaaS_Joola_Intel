/**
 * Paddle family keys — the join currency for Product Intel.
 *
 * Three tables name the same paddle three different ways and share no foreign
 * key: `paddle_reviews.canonical_name`, `products.name`, and
 * `products_catalog.display_name`/`aliases`. `paddle_specs.family_key` is the
 * fourth, and it is computed in PYTHON by
 * `backend/scraping/sources/products/spec_normalize.py`.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IS A MIRROR. It must agree with spec_normalize.family_key   │
 * │ exactly, or the join to paddle_specs silently returns nothing and     │
 * │ the technology comparison renders empty for every paddle.             │
 * │                                                                       │
 * │ Parity is enforced, not assumed: backend/tests/test_family_parity.py  │
 * │ compiles this file and runs both implementations over the same 100+   │
 * │ real product names, asserting identical output. Change one side and   │
 * │ that test fails.                                                      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Why keys and not names: JOOLA ships its Perseus Pro IV as 7 SKUs across two
 * thicknesses and several colourways, and retailers add or drop the endorsing
 * athlete's name at will. Ranked on raw names, one paddle takes 7 of JOOLA's
 * 10 top-10 slots and none of them shows its true review count.
 */

/** Sub-brand and product-line words that sit between the brand and the model. */
const SUBBRAND = ['sport', 'labs', 'lab', 'by']

/**
 * Tokens that vary between SKUs of one paddle and must not split a family.
 * Mirrors `_VARIANT_NOISE`.
 */
const VARIANT_NOISE =
  /\b(?:\d+(?:\.\d+)?\s*mm|pickleball|paddle|paddles|graphite|raw\s+carbon|carbon\s+fiber|elongated|widebody|wide\s+body|hybrid)\b/gi

/**
 * NFKC, lowercase, strip the Unicode replacement character.
 *
 * U+FFFD appears in CRBN names where the registered mark was mangled upstream,
 * and NFKC is what folds `CRBN²` to `crbn2` — both must behave identically to
 * the Python side or CRBN's keys diverge between the two implementations.
 */
function clean(value: string | null | undefined): string {
  if (!value) return ''
  return String(value)
    .normalize('NFKC')
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Collapse the many spellings of one paddle to a single stable key.
 *
 * Conservative by design: model qualifiers (`Pro`) and generation markers
 * (`IV` vs `V`) are preserved, because merging two real products is a worse
 * error than listing one twice.
 *
 * @param endorsers the brand's athlete roster from `influencers.name`. Signature
 *   editions are listed both with and without the athlete — "JOOLA Ben Johns
 *   Perseus Pro IV" and "JOOLA Perseus Pro IV" are one paddle. Left unstripped
 *   that split JOOLA's best seller into 176 and 140 reviews.
 */
export function familyKey(
  productName: string | null | undefined,
  brandSlug: string,
  endorsers: readonly string[] = [],
): string {
  const raw = clean(productName)
  if (!raw) return ''

  // Colourways and editions follow a SPACED dash: "... Paddle - Tropical Red".
  // Split before normalisation, which would destroy the dash.
  const head = raw.split(/\s[-–—]\s/)[0]

  let text = head
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  // Strip the brand, then any sub-brand words now exposed at the front.
  for (const token of clean(brandSlug).toLowerCase().replace(/-/g, ' ').split(' ')) {
    if (!token) continue
    const escaped = escapeRegExp(token)
    // CRBN ships models as `CRBN²`, which NFKC folds to the single token
    // `crbn2`. With no word boundary between `crbn` and `2` the strip below
    // misses it, leaving `CRBN² X Series` and `CRBN-2 X-Series` with different
    // keys — one paddle split in two, neither matching the catalog alias.
    text = text.replace(new RegExp(`^${escaped}(?=\\d)`), `${token} `)
    text = text.replace(new RegExp(`^${escaped}\\b`), '').trim()
  }

  let changed = true
  while (changed) {
    changed = false
    for (const token of SUBBRAND) {
      const stripped = text.replace(new RegExp(`^${token}\\b`), '').trim()
      if (stripped !== text) {
        text = stripped
        changed = true
      }
    }
  }

  // Endorser badge, prefix only. Longest roster name first so "Collin Johns"
  // is not partially consumed by a shorter overlapping entry.
  let withoutEndorser = text
  const roster = [...endorsers].sort((a, b) => b.length - a.length)
  for (const endorser of roster) {
    const folded = String(endorser)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (!folded) continue
    const stripped = text.replace(new RegExp(`^${escapeRegExp(folded)}\\b`), '').trim()
    if (stripped !== text) {
      withoutEndorser = stripped
      break
    }
  }

  // Emptiness is judged on the FINISHED key, not the intermediate text:
  // "JOOLA Ben Johns Pickleball Paddle" survives the endorser strip as
  // "pickleball paddle", and only VARIANT_NOISE reduces that to "". An empty
  // key is the worst outcome available — every unkeyable row shares it, so they
  // would all merge into one phantom product.
  const finished = withoutEndorser.replace(VARIANT_NOISE, ' ').replace(/\s+/g, ' ').trim()
  if (finished) return finished
  return text.replace(VARIANT_NOISE, ' ').replace(/\s+/g, ' ').trim()
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Words that mean "this is not a paddle". Mirrors `_NOT_PADDLE` in
 * `scrape_specs.py`, including the reason it is word-bounded: an earlier
 * substring version contained "ball", which matches inside "pickleball" and
 * rejected every genuine paddle while admitting a luggage tag.
 *
 * This matters more on the review corpus than on the catalog. `paddle_reviews`
 * holds 3,905 reviews of cases, shoes and hats — 14.6% of the table — and
 * Selkirk's "Project Boomstik Soft Case" has 651 of them, enough to outrank
 * most real paddles in that brand's top 10.
 */
const NOT_PADDLE = new Set([
  'cover', 'covers', 'case', 'cases', 'bag', 'bags', 'tote', 'backpack', 'sling',
  'grip', 'grips', 'overgrip', 'tape', 'towel', 'hat', 'cap', 'hats', 'shirt',
  'tee', 'sleeve', 'sleeves', 'sock', 'socks', 'ball', 'balls', 'net', 'nets',
  'eraser', 'cleaner', 'luggage', 'tag', 'tags', 'stand', 'rack', 'machine',
  'shoe', 'shoes', 'visor', 'glove', 'gloves', 'wristband', 'headband',
  'keychain', 'apparel', 'short', 'shorts', 'skirt', 'dress', 'jacket',
  'hoodie', 'tank', 'bottle', 'duffel', 'sunglasses', 'sunglass', 'crewneck',
  'joggers', 'legging', 'leggings', 'polo', 'pant', 'pants',
  // commerce artefacts
  'bundle', 'sample', 'kit',
])

/** Multi-word exclusions, checked as adjacent-token phrases. */
const NOT_PADDLE_PHRASES = [
  'gift card', 'ping pong', 'table tennis', 'key chain', 'paddle set',
  'collectors case', 'hard case', 'soft case',
]

const WORD = /[a-z0-9]+/g

/**
 * True when a product name denotes an actual pickleball paddle.
 *
 * Requires the word "paddle" AND the absence of every accessory word. Note the
 * asymmetry with the catalog scraper: a review's `canonical_name` sometimes
 * omits "paddle" entirely ("Ruby", "Quartz"), so callers with a trustworthy
 * source can use {@link isNotPaddle} instead and only reject the negatives.
 */
export function isPaddleName(name: string | null | undefined): boolean {
  const tokens: string[] = String(name ?? '').toLowerCase().match(WORD) ?? []
  if (!tokens.includes('paddle') && !tokens.includes('paddles')) return false
  return !isNotPaddle(name)
}

/**
 * True when a name is definitely NOT a paddle.
 *
 * The safer test for the review corpus, where a paddle may be listed under a
 * bare model name with no category word at all. Rejecting the known negatives
 * keeps "Ruby" while dropping "Project Boomstik Soft Case".
 */
export function isNotPaddle(name: string | null | undefined): boolean {
  const lowered = String(name ?? '').toLowerCase()
  const tokens: string[] = lowered.match(WORD) ?? []
  const haystack = ` ${tokens.join(' ')} `
  for (const phrase of NOT_PADDLE_PHRASES) {
    if (haystack.includes(` ${phrase} `)) return true
  }
  return tokens.some((token) => NOT_PADDLE.has(token))
}
