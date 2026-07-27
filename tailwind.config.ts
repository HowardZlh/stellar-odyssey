import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'space-dark': '#0a0a14',
        'space-panel': 'rgba(10, 14, 30, 0.85)',
        'space-accent': '#4d9fff',
      },
    },
  },
  plugins: [],
};

export default config;
