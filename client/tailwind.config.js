/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', '1rem'],
      },
      // Stu design system — TWO colors only. Accent (blue) = interactive / selected / the
      // one primary action per screen. Danger (red) = pass / reject / divergence. Everything
      // else is gray. Tiers and scores are NEVER colored — they are typographic.
      colors: {
        accent: { DEFAULT: '#2563eb', hover: '#1d4ed8', soft: '#eff6ff' }, // blue-600/700/50
        danger: { DEFAULT: '#dc2626', soft: '#fef2f2' },                    // red-600/50
        ink: '#111827',                                                     // gray-900
      },
    },
  },
  plugins: [],
};
