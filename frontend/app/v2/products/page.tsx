import { redirect } from 'next/navigation'

export default function LegacyProductsRedirect() {
  redirect('/v2/product-intel')
}
