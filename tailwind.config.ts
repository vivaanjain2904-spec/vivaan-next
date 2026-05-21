import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      "#0a0a0b",
        bg2:     "#101012",
        card:    "#141417",
        card2:   "#1b1b1f",
        border1: "#262629",
        border2: "#3a3a3f",
        ink:     "#fafafa",
        ink2:    "#a1a1aa",
        muted:   "#71717a",
        mint:    "#34d399",
        mintd:   "#10b981",
        vaelor:  "#1f7a52",
        vaelord: "#185f40",
        red:     "#f87171",
        redd:    "#ef4444",
        amber:   "#fbbf24",
        accent:  "#06b6d4",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
} satisfies Config;
