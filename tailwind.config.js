/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /*
       * Nordic Fresh Service
       * ────────────────────
       * Референсы: GuestPrep (hotel-clean photo), Sparkly (воздух + teal),
       * Herb'n Living (спокойные тона), The Maids (процесс + hierarchy).
       * Без glass / liquid glass / blur-карточек. Solid surfaces only.
       * brand #0078C9 — цвет логотипа, только на CTA и акцентах.
       */
      colors: {
        snow: '#FFFFFF',
        mist: {
          DEFAULT: '#F3F6F9',
          deep: '#E8EEF4',
        },
        navy: {
          50: '#f5f7fa',
          100: '#e8ecf1',
          200: '#d4dbe5',
          300: '#b0bbcb',
          400: '#8492a8',
          500: '#64748b',
          600: '#4b5568',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        brand: {
          50: '#eef7fc',
          100: '#d6ebf7',
          200: '#add7ef',
          300: '#6eb8e0',
          400: '#2f96cf',
          500: '#0078c9',
          600: '#0064a9',
          700: '#01528a',
          800: '#053f68',
          900: '#0a2c48',
        },
        accent: {
          DEFAULT: '#0078c9',
          light: '#2f96cf',
        },
        ink: {
          DEFAULT: '#0f172a',
          soft: '#1e293b',
        },
        fresh: {
          DEFAULT: '#0d9488',
          soft: '#ccfbf1',
        },
      },
      /*
       * Единая шкала скруглений:
       * sm 6 · md 10 · lg 12 · xl 16 · 2xl 20
       * Карточки/медиа — xl/2xl; кнопки pill — full.
       */
      borderRadius: {
        none: '0',
        sm: '6px',
        DEFAULT: '10px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '20px',
        full: '9999px',
      },
      fontFamily: {
        /* Системный стек: чётко на Windows/Mac/Android, без внешних CDN */
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      letterSpacing: {
        tighter: '-0.03em',
        tight: '-0.02em',
      },
      boxShadow: {
        glow: 'none',
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.05)',
        card: '0 2px 8px -2px rgba(15, 23, 42, 0.06), 0 8px 24px -8px rgba(15, 23, 42, 0.08)',
        lift: '0 8px 20px -6px rgba(15, 23, 42, 0.10), 0 16px 40px -12px rgba(15, 23, 42, 0.12)',
        pop: '0 12px 28px -8px rgba(15, 23, 42, 0.12), 0 24px 48px -16px rgba(15, 23, 42, 0.14)',
        modal:
          '0 16px 40px -12px rgba(15, 23, 42, 0.16), 0 32px 64px -20px rgba(15, 23, 42, 0.18)',
      },
      transitionDuration: {
        120: '120ms',
        160: '160ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      backgroundImage: {
        'navy-gradient': 'none',
        'hero-radial': 'none',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        float: 'none',
        'float-slow': 'none',
        'fade-in': 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop-in': 'pop-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
