-- SEO Reporting Dashboard: agent pipeline output tables
-- Written by keyword research, crawl, and content brief agents.
-- Next.js dashboard reads these via Supabase anon key (SELECT only).

-- Keyword rank tracking over time (one row per keyword per brand per run)
CREATE TABLE IF NOT EXISTS keyword_rankings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid REFERENCES brands(id),
  keyword       text NOT NULL,
  position      int,           -- SERP rank 1-100+, NULL = not ranking
  url           text,          -- URL that is ranking
  search_volume int,           -- monthly search volume estimate
  difficulty    int,           -- 0-100 keyword difficulty score
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kw_brand_date    ON keyword_rankings(brand_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_kw_keyword       ON keyword_rankings(keyword);

-- Page crawl results (one row per page per crawl run)
CREATE TABLE IF NOT EXISTS crawl_pages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid REFERENCES brands(id),
  url               text NOT NULL,
  http_status       int,           -- 200, 301, 404, 500 …
  on_page_score     int,           -- 0-100 composite score
  word_count        int,
  has_title         boolean DEFAULT true,
  has_meta_desc     boolean DEFAULT true,
  has_h1            boolean DEFAULT true,
  issues            jsonb,         -- string[] of issue labels
  crawl_date        date NOT NULL DEFAULT CURRENT_DATE,
  crawled_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crawl_brand_date ON crawl_pages(brand_id, crawl_date DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_url        ON crawl_pages(url);

-- Content brief pipeline (one row per brief, status updated by agents)
CREATE TABLE IF NOT EXISTS content_briefs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid REFERENCES brands(id),
  keyword      text NOT NULL,
  target_url   text,
  status       text NOT NULL DEFAULT 'pending', -- pending | drafted | published | cancelled
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_brief_brand_status ON content_briefs(brand_id, status);
