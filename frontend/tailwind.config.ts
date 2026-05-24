import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:      '#06090f',
        surface: '#0b1018',
        card:    '#0a0f19',
        border:  'rgba(255,255,255,0.07)',
        accent:  '#22c55e',
        indigo:  '#818cf8',
        amber:   '#f59e0b',
        muted:   '#94a3b8',
        subtle:  '#475569',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '4px',
      },
      boxShadow: {
        'glow-green':  '0 0 24px rgba(34,197,94,0.18), 0 0 48px rgba(34,197,94,0.08)',
        'glow-indigo': '0 0 24px rgba(129,140,248,0.18), 0 0 48px rgba(129,140,248,0.08)',
        'glow-amber':  '0 0 24px rgba(245,158,11,0.18), 0 0 48px rgba(245,158,11,0.08)',
        'card':        '0 4px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05) inset',
        'card-hover':  '0 12px 40px rgba(0,0,0,0.5)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.5', transform: 'scale(0.85)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { transform: 'translateX(-100%)' },
          to:   { transform: 'translateX(200%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'fade-up':   'fade-up 0.4s ease-out both',
        shimmer:     'shimmer 2s infinite',
      },
    },
  },
  plugins: [],
}

export default config
