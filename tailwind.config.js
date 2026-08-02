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
      /*
       * Тени = ВЫСОТА, а не украшение. Шкала та же, что в CRM, — сайт и
       * система должны выглядеть одной вещью.
       *
       *   card  — карточка лежит на странице
       *   lift  — приподнялась под курсором, её можно нажать
       *   pop   — выпадашка оторвана от страницы
       *   modal — перекрывает всё
       *
       * Цвет нейтральный (графит): цветная тень вернула бы «нарядность»,
       * от которой ушли в редизайне. glow оставлен пустым — на него ещё
       * ссылается разметка, но свечения в деловом оформлении нет.
       */
      boxShadow: {
        glow: 'none',
        card: '0 1px 2px -1px rgba(23, 27, 33, 0.08), 0 1px 3px 0 rgba(23, 27, 33, 0.05)',
        lift: '0 2px 4px -2px rgba(23, 27, 33, 0.10), 0 8px 16px -6px rgba(23, 27, 33, 0.12)',
        pop: '0 4px 10px -4px rgba(23, 27, 33, 0.12), 0 12px 32px -12px rgba(23, 27, 33, 0.30)',
        modal:
          '0 6px 16px -8px rgba(23, 27, 33, 0.16), 0 28px 64px -24px rgba(23, 27, 33, 0.38)',
      },
      transitionDuration: {
        120: '120ms',
        160: '160ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      backgroundImage: {
        // ровная тёмная заливка вместо голубого градиента
        // фирменная заливка первого экрана
        'navy-gradient': 'linear-gradient(180deg, #0078c9 0%, #0064a9 100%)',
        'hero-radial': 'none',
      },
      keyframes: {
        // float остался пустым: «плавающие пузырьки» убраны в редизайне,
        // но имя ещё встречается в разметке
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        float: 'none',
        'float-slow': 'none',
        'fade-in': 'fade-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop-in': 'pop-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
