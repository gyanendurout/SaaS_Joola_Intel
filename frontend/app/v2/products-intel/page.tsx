import { redirect } from 'next/navigation'

export default function LegacyProductsIntelRedirect() {
  redirect('/v2/product-intel')
}
