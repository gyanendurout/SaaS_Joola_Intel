import { NextRequest, NextResponse } from 'next/server';
import { analyzePage } from '@/lib/shared/seo-analyzer/analyzer';

export async function POST(req: NextRequest) {
  let url: string;

  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return NextResponse.json({ error: 'URL must use http or https protocol' }, { status: 400 });
  }

  try {
    const result = await analyzePage(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('HTTP 4') ? 400 : message.includes('HTTP 5') ? 502 : 500;
    return NextResponse.json({ error: `Failed to analyze page: ${message}` }, { status });
  }
}
