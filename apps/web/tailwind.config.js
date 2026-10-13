/** @type {import('tailwindcss').Config} */

// Design tokens - see docs/ui-style-guide.md. Every ramp runs 50-900; text
// pairs used by the UI (700 on 50/100, white on 600+) meet WCAG AA.
const ultramarine = {
  50: "#EEF0FF",
  100: "#DFE3FF",
  200: "#C3CAFE",
  300: "#9DA8FB",
  400: "#6F7EF3",
  500: "#4A5CE8",
  600: "#2B3FD9",
  700: "#2232B8",
  800: "#1B2A9B",
  900: "#182372",
};
const midnight = {
  50: "#F1F2F9",
  100: "#E1E3F1",
  200: "#C3C7E2",
  300: "#9BA1CB",
  400: "#6D74AB",
  500: "#4B5289",
  600: "#363C6C",
  700: "#272C56",
  800: "#1C2148",
  900: "#14193F",
};
const teal = {
  50: "#EBFAFB",
  100: "#CDF2F4",
  200: "#9FE4E9",
  300: "#62CFD8",
  400: "#2CB5C1",
  500: "#0E9AA7",
  600: "#0B7D8A",
  700: "#0D6470",
  800: "#0E505A",
  900: "#0C3C44",
};
const marigold = {
  50: "#FFF8EB",
  100: "#FFEDC7",
  200: "#FFDB8A",
  300: "#FFC64D",
  400: "#FFB020",
  500: "#F59607",
  600: "#A85A03",
  700: "#9A4105",
  800: "#7C340A",
  900: "#642C0C",
};
const emerald = {
  50: "#EBFAF3",
  100: "#CFF3E2",
  200: "#A1E6C8",
  300: "#67D2A8",
  400: "#31B985",
  500: "#12A36B",
  600: "#0B8557",
  700: "#0A6A47",
  800: "#0B543A",
  900: "#0A4531",
};
const vermilion = {
  50: "#FFF0F0",
  100: "#FFDEDF",
  200: "#FFC2C4",
  300: "#FB9A9D",
  400: "#F2696D",
  500: "#E5484D",
  600: "#CC2E34",
  700: "#AB2228",
  800: "#8D2025",
  900: "#752125",
};
const magenta = {
  50: "#FCF1F8",
  100: "#F9E3F1",
  200: "#F3C7E3",
  300: "#E99BCB",
  400: "#D966AB",
  500: "#C13584",
  600: "#A82A71",
  700: "#8C215C",
  800: "#741E4E",
  900: "#621D44",
};
// "Being prepared" status only.
const violet = {
  50: "#F4F2FF",
  100: "#EBE6FF",
  200: "#D8CFFF",
  300: "#BBAAFE",
  400: "#9A7CFA",
  500: "#7C52F3",
  600: "#6A35E6",
  700: "#5927C9",
  800: "#4A22A3",
  900: "#3E1F84",
};
// Neutral, tinted slightly cool. 400 and up pass AA as text on white and Paper.
const slate = {
  50: "#F6F7FB",
  100: "#EEF0F6",
  200: "#E1E4EE",
  300: "#C9CEDD",
  400: "#666F8C",
  500: "#545C7A",
  600: "#424A66",
  700: "#333A54",
  800: "#222840",
  900: "#14182B",
};

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: ultramarine,
        ultramarine,
        midnight,
        teal,
        marigold,
        emerald,
        vermilion,
        magenta,
        violet,
        slate,
        // Older screens use Tailwind's default hues directly; alias them onto
        // the token ramps so they follow the palette without class churn.
        red: vermilion,
        rose: vermilion,
        green: emerald,
        amber: marigold,
        yellow: marigold,
        blue: ultramarine,
        sky: ultramarine,
        indigo: violet,
        purple: violet,
        gray: slate,
        paper: "#F6F7FF",
        // Semantic aliases.
        primary: ultramarine,
        success: emerald,
        danger: vermilion,
        warning: marigold,
        info: ultramarine,
        vendor: magenta,
        ink: "#14182B",
        role: {
          sidebar: "var(--role-sidebar)",
          "sidebar-hover": "var(--role-sidebar-hover)",
          "sidebar-active": "var(--role-sidebar-active)",
          "sidebar-muted": "var(--role-sidebar-muted)",
        },
      },
      fontFamily: {
        sans: ['"Public Sans Variable"', "Public Sans", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Bricolage Grotesque Variable"', "Bricolage Grotesque", '"Public Sans Variable"', "system-ui", "sans-serif"],
      },
      // Radius by importance: inputs/buttons 10px, cards 14px, dialogs 20px,
      // chips full.
      borderRadius: {
        lg: "10px",
        input: "10px",
        xl: "14px",
        "2xl": "14px",
        card: "14px",
        "3xl": "20px",
        dialog: "20px",
      },
      // Flat surfaces: cards get no shadow; only overlays (menus, dialogs,
      // drawers, toasts) are lifted.
      boxShadow: {
        sm: "none",
        DEFAULT: "none",
        md: "0 4px 12px -2px rgb(20 25 63 / 0.10), 0 2px 4px -2px rgb(20 25 63 / 0.06)",
        lg: "0 12px 24px -6px rgb(20 25 63 / 0.14), 0 4px 8px -4px rgb(20 25 63 / 0.08)",
        xl: "0 20px 40px -8px rgb(20 25 63 / 0.18), 0 8px 16px -8px rgb(20 25 63 / 0.10)",
        "2xl": "0 28px 56px -12px rgb(20 25 63 / 0.24)",
        overlay: "0 20px 40px -8px rgb(20 25 63 / 0.18), 0 8px 16px -8px rgb(20 25 63 / 0.10)",
      },
      maxWidth: {
        content: "1280px",
      },
    },
  },
  plugins: [],
};
