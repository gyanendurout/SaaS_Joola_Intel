import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type {
  SeoAnalysisResult,
  SeoFactor,
  SeoRecommendation,
  HeadingNode,
  SchemaItem,
  SeoSeverity,
} from './types';

function factor(
  name: string,
  score: number,
  severity: SeoSeverity,
  value: string | null,
  details: string
): SeoFactor {
  return { name, score, severity, value, details };
}

function analyzeTitleTag($: cheerio.CheerioAPI): SeoFactor {
  const title = $('title').first().text().trim();

  if (!title) {
    return factor('Title Tag', 0, 'critical', null, 'Page is missing a <title> tag.');
  }

  const len = title.length;
  if (len < 10) {
    return factor('Title Tag', 20, 'critical', title, `Title is too short (${len} chars). Minimum 30 recommended.`);
  }
  if (len < 30) {
    return factor('Title Tag', 45, 'warning', title, `Title is short (${len} chars). Aim for 30-60 characters.`);
  }
  if (len <= 60) {
    return factor('Title Tag', 100, 'good', title, `Title length is optimal (${len} chars).`);
  }
  if (len <= 70) {
    return factor('Title Tag', 75, 'info', title, `Title is slightly long (${len} chars). May be truncated in SERPs.`);
  }
  return factor('Title Tag', 40, 'warning', title, `Title is too long (${len} chars). Keep under 60 characters.`);
}

function analyzeMetaDescription($: cheerio.CheerioAPI): SeoFactor {
  const desc = $('meta[name="description"]').attr('content')?.trim() ?? null;

  if (!desc) {
    return factor('Meta Description', 0, 'critical', null, 'Page is missing a meta description.');
  }

  const len = desc.length;
  if (len < 50) {
    return factor('Meta Description', 30, 'warning', desc, `Meta description is too short (${len} chars). Aim for 120-160.`);
  }
  if (len <= 160) {
    return factor('Meta Description', 100, 'good', desc, `Meta description length is optimal (${len} chars).`);
  }
  return factor('Meta Description', 55, 'warning', desc, `Meta description is too long (${len} chars); will be truncated. Keep under 160.`);
}

function analyzeHeadingStructure($: cheerio.CheerioAPI): { factor: SeoFactor; headings: HeadingNode[] } {
  const headings: HeadingNode[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    headings.push({
      level: parseInt((el as Element).tagName.replace('h', '')),
      text: $(el).text().trim().slice(0, 120),
    });
  });

  const h1s = headings.filter(h => h.level === 1);

  if (h1s.length === 0) {
    return {
      factor: factor('Heading Structure', 0, 'critical', null, 'Page has no H1 tag. Every page needs exactly one H1.'),
      headings,
    };
  }
  if (h1s.length > 1) {
    return {
      factor: factor(
        'Heading Structure',
        40,
        'warning',
        `${h1s.length} H1 tags found`,
        `Multiple H1 tags (${h1s.length}) detected. Use exactly one H1 per page.`
      ),
      headings,
    };
  }

  // Check for skipped heading levels (e.g., H1 → H3 without H2)
  let prevLevel = 1;
  let hasSkip = false;
  for (const h of headings.slice(1)) {
    if (h.level > prevLevel + 1) {
      hasSkip = true;
      break;
    }
    prevLevel = h.level;
  }

  if (hasSkip) {
    return {
      factor: factor('Heading Structure', 65, 'warning', h1s[0].text, 'Heading hierarchy skips levels (e.g., H1 → H3). Maintain sequential order.'),
      headings,
    };
  }

  return {
    factor: factor('Heading Structure', 100, 'good', h1s[0].text, `Good heading structure with 1 H1 and ${headings.length - 1} sub-headings.`),
    headings,
  };
}

function analyzeKeywordDensity($: cheerio.CheerioAPI): { factor: SeoFactor; wordCount: number } {
  const bodyText = $('body').clone()
    .find('script, style, nav, header, footer').remove().end()
    .text()
    .replace(/\s+/g, ' ')
    .trim();

  const words = bodyText.split(/\s+/).filter(w => w.length > 2);
  const wordCount = words.length;

  if (wordCount < 100) {
    return {
      factor: factor('Keyword Density', 20, 'critical', `${wordCount} words`, 'Very thin content. Pages with under 300 words rarely rank well.'),
      wordCount,
    };
  }
  if (wordCount < 300) {
    return {
      factor: factor('Keyword Density', 45, 'warning', `${wordCount} words`, `Thin content (${wordCount} words). Aim for at least 300 words for indexable pages.`),
      wordCount,
    };
  }

  // Calculate top-term frequency for keyword stuffing detection
  const freq: Record<string, number> = {};
  const stopWords = new Set(['the','and','for','are','but','not','you','all','any','can','had','her','was','one','our','out','day','get','has','him','his','how','its','now','did','let','old','put','too','use','way','who','boy','did','man','new','old','see','two','way','who','with','this','that','from','they','know','want','been','good','much','some','time','very','when','your','come','could','here','just','like','long','make','many','more','only','over','such','take','than','them','then','there','these','think','time','will','even','find','give','going','have','into','look','made','most','move','need','only','part','same','show','than','well','were']);

  for (const w of words) {
    const normalized = w.toLowerCase().replace(/[^a-z]/g, '');
    if (normalized.length > 3 && !stopWords.has(normalized)) {
      freq[normalized] = (freq[normalized] ?? 0) + 1;
    }
  }

  const topTermDensity = Math.max(...Object.values(freq)) / wordCount;
  if (topTermDensity > 0.05) {
    return {
      factor: factor('Keyword Density', 50, 'warning', `${wordCount} words`, `Potential keyword stuffing detected (top term density ${(topTermDensity * 100).toFixed(1)}%). Keep single-term density under 3-4%.`),
      wordCount,
    };
  }

  return {
    factor: factor('Keyword Density', 100, 'good', `${wordCount} words`, `Good content length (${wordCount} words) with natural keyword distribution.`),
    wordCount,
  };
}

function analyzeImageAltText($: cheerio.CheerioAPI): { factor: SeoFactor; imageCount: number; imagesWithAlt: number } {
  const images = $('img');
  const imageCount = images.length;
  let imagesWithAlt = 0;
  let imagesWithEmptyAlt = 0;

  images.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt !== undefined) {
      if (alt.trim().length > 0) {
        imagesWithAlt++;
      } else {
        imagesWithEmptyAlt++;
      }
    }
  });

  if (imageCount === 0) {
    return {
      factor: factor('Image Alt Text', 80, 'info', '0 images', 'No images found. Consider adding relevant images with descriptive alt text.'),
      imageCount: 0,
      imagesWithAlt: 0,
    };
  }

  const missingAlt = imageCount - imagesWithAlt - imagesWithEmptyAlt;
  const coverage = imagesWithAlt / imageCount;

  if (missingAlt > 0) {
    const score = Math.round(coverage * 70);
    return {
      factor: factor('Image Alt Text', score, missingAlt > imageCount / 2 ? 'critical' : 'warning',
        `${imagesWithAlt}/${imageCount} have alt text`,
        `${missingAlt} image(s) are missing alt attributes entirely. Add descriptive alt text for accessibility and SEO.`),
      imageCount,
      imagesWithAlt,
    };
  }

  if (imagesWithEmptyAlt === imageCount) {
    return {
      factor: factor('Image Alt Text', 30, 'warning', `All ${imageCount} have empty alt=""`, 'All images have empty alt text. Decorative images should have alt="" but content images need descriptive text.'),
      imageCount,
      imagesWithAlt,
    };
  }

  if (coverage >= 0.9) {
    return {
      factor: factor('Image Alt Text', 100, 'good', `${imagesWithAlt}/${imageCount} have alt text`, 'Images are well-optimized with descriptive alt text.'),
      imageCount,
      imagesWithAlt,
    };
  }

  return {
    factor: factor('Image Alt Text', Math.round(coverage * 100), 'warning',
      `${imagesWithAlt}/${imageCount} have alt text`,
      `${Math.round((1 - coverage) * 100)}% of images lack meaningful alt text.`),
    imageCount,
    imagesWithAlt,
  };
}

function analyzeInternalLinks($: cheerio.CheerioAPI, pageUrl: string): { factor: SeoFactor; internalLinkCount: number; externalLinkCount: number } {
  const parsedUrl = new URL(pageUrl);
  const host = parsedUrl.hostname;

  let internalLinkCount = 0;
  let externalLinkCount = 0;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.hostname === host) {
        internalLinkCount++;
      } else {
        externalLinkCount++;
      }
    } catch {
      // Relative links without full URL (e.g., #anchor) — count as internal
      if (href.startsWith('#') || href.startsWith('/') || !href.includes('://')) {
        internalLinkCount++;
      }
    }
  });

  if (internalLinkCount === 0) {
    return {
      factor: factor('Internal Links', 10, 'critical', '0 internal links', 'No internal links found. Internal links distribute PageRank and improve crawlability.'),
      internalLinkCount,
      externalLinkCount,
    };
  }
  if (internalLinkCount < 3) {
    return {
      factor: factor('Internal Links', 50, 'warning', `${internalLinkCount} internal link(s)`, 'Very few internal links. Add relevant internal links to improve site structure.'),
      internalLinkCount,
      externalLinkCount,
    };
  }

  return {
    factor: factor('Internal Links', 100, 'good', `${internalLinkCount} internal links`, `Good internal link count (${internalLinkCount}). Links distribute authority through the site.`),
    internalLinkCount,
    externalLinkCount,
  };
}

function analyzePageSpeedSignals($: cheerio.CheerioAPI, htmlSize: number): SeoFactor {
  const issues: string[] = [];
  let score = 100;

  // HTML size
  if (htmlSize > 500_000) {
    issues.push(`Large HTML document (${Math.round(htmlSize / 1024)}KB). Aim for under 100KB.`);
    score -= 30;
  } else if (htmlSize > 100_000) {
    issues.push(`HTML document is large (${Math.round(htmlSize / 1024)}KB). Consider reducing.`);
    score -= 15;
  }

  // Render-blocking scripts in <head>
  const blockingScripts = $('head script[src]:not([defer]):not([async])').length;
  if (blockingScripts > 2) {
    issues.push(`${blockingScripts} render-blocking scripts in <head>. Add defer or async attributes.`);
    score -= 20;
  } else if (blockingScripts > 0) {
    issues.push(`${blockingScripts} render-blocking script(s) in <head>. Prefer defer/async.`);
    score -= 10;
  }

  // Render-blocking CSS
  const blockingCSS = $('head link[rel="stylesheet"]').length;
  if (blockingCSS > 4) {
    issues.push(`${blockingCSS} render-blocking stylesheets. Consider inlining critical CSS.`);
    score -= 10;
  }

  // Inline styles (not a blocker but indicates unmaintained code)
  const inlineStyles = $('[style]').length;
  if (inlineStyles > 20) {
    issues.push(`${inlineStyles} elements with inline styles. Extract to CSS for better caching.`);
    score -= 5;
  }

  // Unoptimized images (no width/height = layout shift signal)
  const imagesWithoutDimensions = $('img:not([width]):not([height])').length;
  if (imagesWithoutDimensions > 3) {
    issues.push(`${imagesWithoutDimensions} images lack width/height attributes. Causes cumulative layout shift (CLS).`);
    score -= 15;
  }

  score = Math.max(0, score);
  const severity: SeoSeverity = score >= 80 ? 'good' : score >= 60 ? 'info' : score >= 40 ? 'warning' : 'critical';
  const summary = issues.length === 0 ? 'No major page speed issues detected.' : issues.join(' ');

  return factor('Page Speed Signals', score, severity, `${Math.round(htmlSize / 1024)}KB HTML`, summary);
}

function analyzeSchemaMarkup($: cheerio.CheerioAPI): { factor: SeoFactor; schemaTypes: SchemaItem[] } {
  const schemaTypes: SchemaItem[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() ?? '';
      const parsed = JSON.parse(raw);
      const types = Array.isArray(parsed) ? parsed.map((p: { '@type'?: string }) => p['@type'] ?? 'Unknown') : [parsed['@type'] ?? 'Unknown'];
      for (const t of types) {
        schemaTypes.push({ type: String(t), raw: raw.slice(0, 200) });
      }
    } catch {
      // malformed JSON-LD — skip
    }
  });

  // Check for microdata
  const microdataItems = $('[itemscope]').length;
  if (microdataItems > 0 && schemaTypes.length === 0) {
    schemaTypes.push({ type: 'Microdata', raw: `${microdataItems} itemscope element(s)` });
  }

  if (schemaTypes.length === 0) {
    return {
      factor: factor('Schema Markup', 20, 'warning', 'None detected', 'No structured data (JSON-LD or microdata) found. Schema markup enables rich results in SERPs.'),
      schemaTypes,
    };
  }

  const typeList = schemaTypes.map(s => s.type).join(', ');
  return {
    factor: factor('Schema Markup', 100, 'good', typeList, `Found schema types: ${typeList}. Structured data helps search engines understand page content.`),
    schemaTypes,
  };
}

function buildRecommendations(factors: SeoAnalysisResult['factors']): SeoRecommendation[] {
  const recs: SeoRecommendation[] = [];
  let priority = 1;

  const impactMap: Record<string, string> = {
    'Title Tag': 'Directly affects SERP click-through rates and ranking signals.',
    'Meta Description': 'Controls the SERP snippet; improves click-through rate.',
    'Heading Structure': 'Helps search engines understand content hierarchy and main topic.',
    'Keyword Density': 'Ensures content relevance signals without over-optimization penalties.',
    'Image Alt Text': 'Improves accessibility, image search rankings, and crawlability.',
    'Internal Links': 'Distributes PageRank and improves crawl depth for all pages.',
    'Page Speed Signals': 'Core Web Vitals directly influence Google rankings.',
    'Schema Markup': 'Enables rich results (stars, FAQ, breadcrumbs) in SERPs.',
  };

  const orderedFactors = Object.values(factors).sort((a, b) => a.score - b.score);

  for (const f of orderedFactors) {
    if (f.severity === 'good') continue;

    recs.push({
      priority: priority++,
      severity: f.severity,
      factor: f.name,
      issue: f.details,
      recommendation: buildRecommendationText(f.name, f.score),
      impact: impactMap[f.name] ?? '',
    });
  }

  return recs;
}

function buildRecommendationText(factorName: string, score: number): string {
  const templates: Record<string, Record<string, string>> = {
    'Title Tag': {
      critical: 'Add a unique, descriptive <title> tag between 30-60 characters including your primary keyword near the start.',
      warning: 'Optimize your title tag length to 30-60 characters and include the primary keyword.',
      info: 'Trim the title to under 60 characters to prevent SERP truncation.',
    },
    'Meta Description': {
      critical: 'Add a compelling meta description (120-160 chars) that summarizes the page and includes a call-to-action.',
      warning: 'Rewrite the meta description to fall between 120-160 characters for optimal display.',
      info: 'Trim the meta description to under 160 characters.',
    },
    'Heading Structure': {
      critical: 'Add a single, descriptive H1 tag that includes your primary keyword.',
      warning: 'Use exactly one H1 tag and maintain proper heading hierarchy (H1 → H2 → H3).',
      info: 'Fix heading level skips to maintain sequential hierarchy.',
    },
    'Keyword Density': {
      critical: 'Expand content to at least 300 words. Thin pages rarely rank — provide genuine value.',
      warning: 'Add more substantive content or reduce keyword repetition to avoid over-optimization.',
    },
    'Image Alt Text': {
      critical: 'Add descriptive alt attributes to all content images. Format: alt="[what the image shows] [context]".',
      warning: 'Add meaningful alt text to remaining images. Skip decorative images with alt="".',
    },
    'Internal Links': {
      critical: 'Add 3-10 internal links to related pages. Use descriptive anchor text that reflects the target page topic.',
      warning: 'Increase internal linking to 3+ relevant pages with descriptive anchor text.',
    },
    'Page Speed Signals': {
      critical: 'Add defer/async to non-critical scripts, set explicit image dimensions, and reduce HTML payload.',
      warning: 'Add defer attribute to scripts in <head>, set image width/height attributes.',
      info: 'Minor speed improvements: add image dimensions and consider async loading.',
    },
    'Schema Markup': {
      warning: 'Add JSON-LD structured data. Start with Organization or WebPage schema, or use Article/Product/FAQ schema as appropriate.',
      info: 'Consider expanding schema coverage to include more specific types relevant to your content.',
    },
  };

  const severityKey = score < 30 ? 'critical' : score < 65 ? 'warning' : 'info';
  return templates[factorName]?.[severityKey] ?? templates[factorName]?.['warning'] ?? `Improve ${factorName} to boost SEO performance.`;
}

export async function analyzePage(url: string): Promise<SeoAnalysisResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'JoolaIntelSEOBot/1.0 (+https://joola.com/seo-bot)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new Error(`URL does not return HTML (Content-Type: ${contentType})`);
  }

  const html = await response.text();
  const htmlSize = Buffer.byteLength(html, 'utf8');
  const $ = cheerio.load(html);

  const titleResult = analyzeTitleTag($);
  const metaResult = analyzeMetaDescription($);
  const { factor: headingResult, headings } = analyzeHeadingStructure($);
  const { factor: keywordResult, wordCount } = analyzeKeywordDensity($);
  const { factor: imageResult, imageCount, imagesWithAlt } = analyzeImageAltText($);
  const { factor: linksResult, internalLinkCount, externalLinkCount } = analyzeInternalLinks($, url);
  const speedResult = analyzePageSpeedSignals($, htmlSize);
  const { factor: schemaResult, schemaTypes } = analyzeSchemaMarkup($);

  const factors = {
    titleTag: titleResult,
    metaDescription: metaResult,
    headingStructure: headingResult,
    keywordDensity: keywordResult,
    imageAltText: imageResult,
    internalLinks: linksResult,
    pageSpeedSignals: speedResult,
    schemaMarkup: schemaResult,
  };

  const overallScore = Math.round(
    Object.values(factors).reduce((sum, f) => sum + f.score, 0) / Object.values(factors).length
  );

  const recommendations = buildRecommendations(factors);

  return {
    url,
    analyzedAt: new Date().toISOString(),
    overallScore,
    factors,
    headings,
    schemaTypes,
    internalLinkCount,
    externalLinkCount,
    imageCount,
    imagesWithAlt,
    wordCount,
    recommendations,
  };
}
