import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:    "#000402",
        bg2:   "#040a06",
        card:  "#0a120d",
        card2: "#0e1810",
        border1: "#162317",
        border2: "#243a26",
        mint:  "#3ff5a0",
        mintd: "#22c46e",
        red:   "#ff4d6d",
        amber: "#f0a034",
        ink:   "#f0f6f1",
        ink2:  "#b8cfc0",
        muted: "#4a6654",
      },
      fontFamily: {
        sans: ["'Space Grotesk'", "sans-serif"],
        mono: ["'DM Mono'", "monospace"],
      },
      boxShadow: {
        glow:  "0 0 28px rgba(63,245,160,0.35)",
        glow2: "0 8px 32px -10px rgba(63,245,160,0.2)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
        blink: "blink 2s ease-in-out infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(63,245,160,0.25)" },
          "50%":     { boxShadow: "0 0 0 22px rgba(63,245,160,0)" },
        },
        blink: {
          "0%,100%": { opacity: "1" },
          "50%":     { opacity: "0.3" },
        },
      },
    },
  },
} satisfies Config;
