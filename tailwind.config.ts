import type { Config } from 'tailwindcss'

// Aesthetic = Korean-minimal / French-airy.
// Champagne-neutral palette, generous whitespace, refined serif display.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f1c1a',
        cream: '#faf7f1',
        champagne: '#e8dccb',
        accent: '#a08254',
      },
      fontFamily: {
        serif: ['"Noto Serif TC"', 'Cormorant Garamond', 'serif'],
        sans: ['"Noto Sans TC"', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
