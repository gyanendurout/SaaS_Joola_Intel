export type SeoSeverity = 'critical' | 'warning' | 'info' | 'good';

export interface SeoFactor {
  name: string;
  score: number; // 0-100
  severity: SeoSeverity;
  value: string | null;
  details: string;
}

export interface SeoRecommendation {
  priority: number; // 1 = highest
  severity: SeoSeverity;
  factor: string;
  issue: string;
  recommendation: string;
  impact: string;
}

export interface HeadingNode {
  level: number;
  text: string;
}

export interface SchemaItem {
  type: string;
  raw: string;
}

export interface SeoAnalysisResult {
  url: string;
  analyzedAt: string;
  overallScore: number; // 0-100
  factors: {
    titleTag: SeoFactor;
    metaDescription: SeoFactor;
    headingStructure: SeoFactor;
    keywordDensity: SeoFactor;
    imageAltText: SeoFactor;
    internalLinks: SeoFactor;
    pageSpeedSignals: SeoFactor;
    schemaMarkup: SeoFactor;
  };
  headings: HeadingNode[];
  schemaTypes: SchemaItem[];
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesWithAlt: number;
  wordCount: number;
  recommendations: SeoRecommendation[];
}
