import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const openai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_KEY })

const BLOG_PROMPT = (title: string, summary: string) => `
You are a content strategist for JOOLA, the #1 pickleball brand. Write an SEO-optimized blog post for joola.com about this topic.

Topic title: ${title}
Context: ${summary}

Requirements:
- Position JOOLA as a thought leader in pickleball
- 800–1000 words
- HTML format with H2 subheadings
- Include a CTA linking to joola.com at the end
- Professional but energetic brand voice

Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "title": "SEO-optimized blog post title",
  "body": "<h2>...</h2><p>...</p>...",
  "meta_description": "Under 160 characters for Google",
  "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}
`

const INSTAGRAM_PROMPT = (title: string, summary: string) => `
You are a social media strategist for JOOLA pickleball. Write an Instagram post about this topic.

Topic title: ${title}
Context: ${summary}

Requirements:
- Caption under 200 characters with a punchy opener
- Professional, energetic, community-focused brand voice
- 12 relevant pickleball hashtags
- Describe the ideal image/graphic for this post
- Suggest best posting time based on pickleball community activity

Return ONLY valid JSON (no markdown fences) in this exact shape:
{
  "caption": "Under 200 char punchy caption",
  "hashtags": ["#tag1", "#tag2", ...],
  "image_prompt": "Description of ideal photo or graphic",
  "best_posting_time": "e.g. Tuesday 7–9 PM EST"
}
`

export async function POST(req: NextRequest) {
  try {
    const { item_id, content_type } = await req.json()

    if (!item_id || !content_type) {
      return NextResponse.json({ error: 'item_id and content_type are required' }, { status: 400 })
    }

    // Fetch the source item
    const { data: item, error: fetchError } = await supabase
      .from('market_intel_items')
      .select('id, title, summary')
      .eq('id', item_id)
      .single()

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const title = item.title || 'Pickleball Industry Update'
    const summary = item.summary || ''

    const prompt = content_type === 'blog_post'
      ? BLOG_PROMPT(title, summary)
      : INSTAGRAM_PROMPT(title, summary)

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    })

    const raw = completion.choices[0].message.content || '{}'
    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw }, { status: 500 })
    }

    // Build record for Supabase
    const record: Record<string, any> = {
      source_item_id: item_id,
      content_type,
      status: 'draft',
    }

    if (content_type === 'blog_post') {
      record.title = parsed.title
      record.body = parsed.body
      record.meta_description = parsed.meta_description
      record.seo_keywords = parsed.seo_keywords
    } else {
      record.body = parsed.caption
      record.hashtags = parsed.hashtags
      record.image_prompt = parsed.image_prompt
      record.best_posting_time = parsed.best_posting_time
    }

    const { data: saved, error: saveError } = await supabase
      .from('generated_content')
      .insert(record)
      .select()
      .single()

    if (saveError) {
      // Return generated content even if save fails (table may not exist yet)
      return NextResponse.json({ content: parsed, saved: false, saveError: saveError.message })
    }

    return NextResponse.json({ content: parsed, saved: true, id: saved.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
