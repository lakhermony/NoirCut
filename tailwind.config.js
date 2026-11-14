/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: 'var(--bg-app)',
        anthracite: 'var(--bg-panel)',
        moss: 'var(--accent)',
        'moss-bright': 'var(--accent-hover)',
        steel: 'var(--text-muted)',
        tungsten: 'var(--text-muted)',
        crimson: 'var(--accent)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace']
      },
      borderRadius: {
        panel: '8px'
      }
    }
  },
  plugins: []
}
