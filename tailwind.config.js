/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Брендовая палитра «Archidea Cleaning» — вокруг цвета логотипа #0078C9
        navy: {
          50: '#e6f3fb',
          100: '#c9e6f8',
          200: '#95cdf0',
          300: '#5fb1e8',
          400: '#2a93da',
          500: '#0078c9', // ← точный цвет логотипа
          600: '#0063a8',
          700: '#014e85',
          800: '#053a63',
          900: '#0a2a48',
          950: '#061a2e',
        },
        accent: {
          DEFAULT: '#0078c9',
          light: '#5fb1e8',
        },
      },
      fontFamily: {
        // системный набор: Montserrat с CDN не грузится из-за политики
        // безопасности, а локальной копии в проекте нет
        sans: [
          'Montserrat',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(0, 120, 201, 0.5)',
        card: '0 12px 40px -14px rgba(6, 26, 46, 0.22)',
      },
      backgroundImage: {
        'navy-gradient':
          'linear-gradient(140deg, #0078c9 0%, #0063a8 60%, #014e85 100%)',
        'hero-radial':
          'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.12), transparent 55%)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float 9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
