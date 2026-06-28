'use client'
import { MiniKpi, SectionInfo, pgColor, pgName } from '@/components/v2/PageShell'
import type { V2Brand } from '@/lib/v2/data'
import type { RawCatalogProduct } from '@/lib/v2/productIntel'

interface Props {
  product: RawCatalogProduct
  brands: V2Brand[]
  norm: (v: number) => number
}

export function ProductHero({ product, brands, norm }: Props) {
  const brandColor = pgColor(product.brand_id)
  const price = product.price_usd != null ? norm(Number(product.price_usd)) : null
  const salePrice = product.sale_price_usd != null ? norm(Number(product.sale_price_usd)) : null
  const tier = price == null ? '—' : price >= 200 ? 'Premium' : price >= 100 ? 'Mid' : 'Value'
  const tierColor = tier === 'Premium' ? '#F5E625' : tier === 'Mid' ? '#60a5fa' : '#22c55e'

  return (
    <section style={{ marginBottom: 0 }}>
      <div className="kpi-grid">
        <MiniKpi
          label="Category"
          value={product.category || '—'}
          color="#a78bfa"
          tip="Product category as scraped from the brand storefront."
          src="products_catalog.category"
        />
        <MiniKpi
          label="Price"
          value={price ? `$${price.toFixed(0)}` : '—'}
          color="#60a5fa"
          customVs={salePrice && salePrice < (price ?? 0) ? `Sale: $${salePrice.toFixed(0)}` : undefined}
          tip="Retail price in USD. Sale price shown if a promotion was detected."
          src="products_catalog.price_usd"
        />
        <MiniKpi
          label="Price tier"
          value={tier}
          color={tierColor}
          tip="Value = under $100 · Mid = $100–$199 · Premium = $200+"
          src="products_catalog.price_usd"
        />
        <MiniKpi
          label="In stock"
          value={product.in_stock !== false ? 'Yes' : 'No'}
          color={product.in_stock !== false ? '#22c55e' : '#ef4444'}
          tip="Whether this product is currently available on the brand website. Updated weekly by the scraper."
          src="products_catalog.in_stock"
        />
        {product.avg_rating != null && (
          <MiniKpi
            label="Avg rating"
            value={`${product.avg_rating.toFixed(1)} ★`}
            color="#F5E625"
            customVs={product.review_count != null ? `${product.review_count} reviews` : undefined}
            tip="Average customer star rating and total review count as scraped from the product page."
            src="products_catalog.avg_rating"
          />
        )}
        {product.discount_pct != null && product.discount_pct > 0 && (
          <MiniKpi
            label="Discount"
            value={`${product.discount_pct.toFixed(0)}%`}
            color="#ef4444"
            tip="Discount percentage detected — difference between regular price and current sale price."
            src="products_catalog.discount_pct"
          />
        )}
      </div>
      {product.url && (
        <div style={{ marginTop: 10 }}>
          <a href={product.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12 }}>
            View product page ↗
          </a>
        </div>
      )}
    </section>
  )
}
