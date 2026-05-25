'use client'

/**
 * Sponsored-player roster (business-provided mapping).
 *
 * Single source of truth for "which player is sponsored by which brand?" —
 * the Influencer Intel page (and any other surface that needs sponsorship
 * context) reads from here rather than guessing.
 *
 * STATUSES
 *  - 'business-mapping'      : provided by the JOOLA business team (assumed correct)
 *  - 'confirmed-from-data'   : roster matches scraped influencer name + brand
 *  - 'needs-verification'    : player appears on multiple brands' rosters
 *                              (cross-sponsorship is possible but rare — flag for review)
 *  - 'roster-not-confirmed'  : brand has no rostered players yet (e.g. Wilson)
 *
 * Multi-brand players (Parris Todd, Riley Newman, Steve Deakin) intentionally
 * appear once per brand with status 'needs-verification' so the table can show
 * the ambiguity rather than silently picking one brand.
 */

export type PlayerSponsorshipStatus =
  | 'business-mapping'
  | 'confirmed-from-data'
  | 'needs-verification'
  | 'roster-not-confirmed'

export interface PlayerSponsorship {
  player: string
  brandSlug: string
  status: PlayerSponsorshipStatus
}

export const SPONSORED_PLAYER_ROSTER: PlayerSponsorship[] = [
  // Selkirk
  { player: 'Morgan Evans',         brandSlug: 'selkirk',   status: 'business-mapping' },
  { player: 'Tonja Major',          brandSlug: 'selkirk',   status: 'business-mapping' },
  { player: 'Catherine Parenteau',  brandSlug: 'selkirk',   status: 'business-mapping' },
  { player: 'Parris Todd',          brandSlug: 'selkirk',   status: 'needs-verification' }, // also Franklin
  { player: 'Mary Braasch',         brandSlug: 'selkirk',   status: 'business-mapping' },
  // JOOLA
  { player: 'Ben Johns',            brandSlug: 'joola',     status: 'business-mapping' },
  { player: 'Collin Johns',         brandSlug: 'joola',     status: 'business-mapping' },
  { player: 'Tyson McGuffin',       brandSlug: 'joola',     status: 'business-mapping' },
  { player: 'Lea Jansen',           brandSlug: 'joola',     status: 'business-mapping' },
  { player: 'Federico Staksrud',    brandSlug: 'joola',     status: 'business-mapping' },
  { player: 'Anna Bright',          brandSlug: 'joola',     status: 'business-mapping' },
  // Paddletek
  { player: 'Christian Alshon',     brandSlug: 'paddletek', status: 'business-mapping' },
  { player: 'Zane Navratil',        brandSlug: 'paddletek', status: 'business-mapping' },
  { player: 'Riley Newman',         brandSlug: 'paddletek', status: 'needs-verification' }, // also Gamma
  { player: 'Andrea Koop',          brandSlug: 'paddletek', status: 'business-mapping' },
  { player: 'Irina Tereschenko',    brandSlug: 'paddletek', status: 'business-mapping' },
  // Onix
  { player: 'Steve Deakin',         brandSlug: 'onix',      status: 'needs-verification' }, // also Head
  { player: 'Byron Freso',          brandSlug: 'onix',      status: 'business-mapping' },
  { player: 'Altaf Merchant',       brandSlug: 'onix',      status: 'business-mapping' },
  { player: 'Erica Gonzalez',       brandSlug: 'onix',      status: 'business-mapping' },
  { player: 'Carter Turner',        brandSlug: 'onix',      status: 'business-mapping' },
  // Gamma
  { player: 'Riley Newman',         brandSlug: 'gamma',     status: 'needs-verification' },
  { player: 'Lindsey Newman',       brandSlug: 'gamma',     status: 'business-mapping' },
  { player: 'Spencer Smith',        brandSlug: 'gamma',     status: 'business-mapping' },
  // Six Zero
  { player: 'Jay Devilliers',       brandSlug: 'six-zero',  status: 'business-mapping' },
  { player: 'Gabe Joseph',          brandSlug: 'six-zero',  status: 'business-mapping' },
  { player: 'Blaine Hovenier',      brandSlug: 'six-zero',  status: 'business-mapping' },
  { player: 'Kelsey Grambeau',      brandSlug: 'six-zero',  status: 'business-mapping' },
  { player: 'Bruno Faletto',        brandSlug: 'six-zero',  status: 'business-mapping' },
  // Franklin
  { player: 'Anna Leigh Waters',    brandSlug: 'franklin',  status: 'business-mapping' },
  { player: 'Megan Fudge',          brandSlug: 'franklin',  status: 'business-mapping' },
  { player: 'Leigh Waters',         brandSlug: 'franklin',  status: 'business-mapping' },
  { player: 'Parris Todd',          brandSlug: 'franklin',  status: 'needs-verification' },
  { player: 'Hayden Patriquin',     brandSlug: 'franklin',  status: 'business-mapping' },
  // Head
  { player: 'Sarah Ansboury',       brandSlug: 'head',      status: 'business-mapping' },
  { player: 'Steve Deakin',         brandSlug: 'head',      status: 'needs-verification' },
  { player: 'Regina Franco',        brandSlug: 'head',      status: 'business-mapping' },
  // CRBN
  { player: 'Alex Walker',          brandSlug: 'crbn',      status: 'business-mapping' },
  { player: 'Angie Walker',         brandSlug: 'crbn',      status: 'business-mapping' },
  { player: 'Andrei Daescu',        brandSlug: 'crbn',      status: 'business-mapping' },
  // Engage
  { player: 'Jessie Irvine',        brandSlug: 'engage',    status: 'business-mapping' },
  { player: 'Eric Oncins',          brandSlug: 'engage',    status: 'business-mapping' },
  { player: 'Richard Livornese Jr.', brandSlug: 'engage',   status: 'business-mapping' },
  { player: 'Jaime Oncins',         brandSlug: 'engage',    status: 'business-mapping' },
  { player: 'Youssef Bouzidi',      brandSlug: 'engage',    status: 'business-mapping' },
  // Wilson — roster not confirmed
]

/**
 * Brands that intentionally have no entries above. Surfaced on the page as
 * "Roster not confirmed" so a missing brand is never silently invisible.
 */
export const BRANDS_WITHOUT_ROSTER: string[] = ['wilson']

export function rosterForBrand(slug: string): PlayerSponsorship[] {
  return SPONSORED_PLAYER_ROSTER.filter(r => r.brandSlug === slug)
}

export function brandsForPlayer(playerName: string): string[] {
  const target = playerName.trim().toLowerCase()
  return Array.from(
    new Set(
      SPONSORED_PLAYER_ROSTER
        .filter(r => r.player.toLowerCase() === target)
        .map(r => r.brandSlug),
    ),
  )
}

export function allSponsoredPlayers(): string[] {
  return Array.from(new Set(SPONSORED_PLAYER_ROSTER.map(r => r.player)))
}

export function rosterBrands(): string[] {
  return Array.from(new Set(SPONSORED_PLAYER_ROSTER.map(r => r.brandSlug)))
}
