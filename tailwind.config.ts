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
      // M1-2 safe-area 四向 spacing（刘海屏/Home Indicator 避让，
      // viewportFit: 'cover' 配套）：pb-safe-b / pt-safe-t / pl-safe-l /
      // pr-safe-r 等简写，等价 pb-[env(safe-area-inset-bottom)]
      spacing: {
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
};

export default config;
