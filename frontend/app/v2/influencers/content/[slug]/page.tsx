'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InfluencerContentRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/v2/influencers') }, [router])
  return null
}
