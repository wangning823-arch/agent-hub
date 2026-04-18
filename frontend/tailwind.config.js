/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: '#1a1a1a',
        border: '#2a2a2a',
        accent: '#6366f1',
        'accent-hover': '#818cf8',
      }
    },
  },
  plugins: [],
}