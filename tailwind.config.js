/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /*
       * Деловой минимализм: графитовая шкала для текста, рамок и фонов,
       * синий #0078C9 — только на действиях. Прежняя палитра была целиком
       * голубой: фон, подписи, рамки и кнопки одного цвета, и сайт читался
       * как рекламный баннер, а не как страница компании.
       *
       * Имя navy оставлено: на него завязаны сотни классов в разметке.
       */
      colors: {
        navy: {
          50: '#f6f7f9',
          100: '#eaecf0',
          200: '#d6d9e0',
          300: '#b2b8c4',
          400: '#858d9d',
          500: '#5c6474',
          600: '#454c59',
          700: '#343a45',
          800: '#242932',
          900: '#171b21',
          950: '#0d1015',
        },
        brand: {
          50: '#eef6fc',
          100: '#d6e9f7',
          200: '#addaf2',
          300: '#6ebde6',
          400: '#2f9bd6',
          500: '#0078c9', // ← точный цвет логотипа
          600: '#0064a9',
          700: '#01528a',
          800: '#053f68',
          900: '#0a2c48',
        },
        accent: {
          DEFAULT: '#0078c9',
          light: '#2f9bd6',
        },
      },
      /* Скругления мелкие: круглые кнопки-«таблетки» — примета рекламной вёрстки */
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '4px',
        xl: '5px',
        '2xl': '6px',
        '3xl': '8px',
        full: '9999px',
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
      /* Тени почти нет: блок держит рамка 1 px */
      boxShadow: {
        glow: 'none',
        card: '0 1px 2px 0 rgba(23, 27, 33, 0.06)',
      },
      backgroundImage: {
        // ровная тёмная заливка вместо голубого градиента
        // фирменная заливка первого экрана
        'navy-gradient': 'linear-gradient(180deg, #0078c9 0%, #0064a9 100%)',
        'hero-radial': 'none',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(0)' },
        },
      },
      animation: {
        float: 'none',
        'float-slow': 'none',
      },
    },
  },
  plugins: [],
}
