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
      },
      fontFamily: {
        // системный набор: Inter с CDN не грузится из-за политики безопасности,
        // а локальной копии в проекте нет
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 6px 24px -10px rgba(6, 26, 46, 0.2)',
      },
      backgroundImage: {
        'navy-gradient':
          'linear-gradient(140deg, #0078c9 0%, #0063a8 60%, #014e85 100%)',
      },
    },
  },
  plugins: [],
};
