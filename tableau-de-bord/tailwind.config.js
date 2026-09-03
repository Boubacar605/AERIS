/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    fontFamily: {
      titre: ['"Space Grotesk"', "system-ui", "sans-serif"],
      corps: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
      mono: ['"JetBrains Mono"', "monospace"],
    },
    extend: {
      colors: {
        aeris: {
          profond: "#0F2B46",
          "profond-clair": "#163A5C",
          accent: "#3CBBB1",
          "accent-pale": "#E6F7F5",
          fond: "#F1F3F6",
          surface: "#FFFFFF",
          texte: "#1A1A2E",
          "texte-secondaire": "#5A6275",
          succes: "#4A7C59",
          alerte: "#A63D40",
          edge: "#D4A84B",
          "edge-pale": "#FDF6E9",
          cloud: "#5B9BD5",
          "cloud-pale": "#EBF3FB",
          bordure: "#DDE1E8",
        },
      },
      spacing: {
        18: "4.5rem",
        88: "22rem",
      },
    },
  },
  plugins: [],
};
