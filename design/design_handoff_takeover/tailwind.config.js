/** Every token maps to a CSS variable in tokens.css, so dark/light switching is attribute-only (data-theme). Accent set 1b. */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surf: 'var(--surf)', line: 'var(--line)', ink: 'var(--ink)', mute: 'var(--mute)',
        track: 'var(--track)', warn: 'var(--warn)', err: 'var(--err)',
        acc: 'var(--acc)', 'on-acc': 'var(--on-acc)', 'acc-text': 'var(--acc-text)', 'acc-line': 'var(--acc-line)', 'acc-soft': 'var(--acc-soft)',
        paper: 'var(--paper)', 'paper-ink': 'var(--paper-ink)', 'paper-mute': 'var(--paper-mute)', 'paper-line': 'var(--paper-line)',
        n: { 100: '#f3f5fe', 200: '#e4e7f5', 300: '#cfd3e5', 400: '#b2b6ca', 500: '#9397ab', 600: '#75798c', 700: '#595d6c', 800: '#3f424d', 900: '#292b31' }
      },
      fontFamily: { display: 'var(--font-display)', body: 'var(--font-body)', mono: 'var(--font-mono)' },
      fontSize: { label: ['10.5px', '1.5'], chip: ['12px', '1.5'], body: ['14px', '1.5'], score: ['64px', '0.8'] },
      spacing: { s1: '2.8px', s2: '5.6px', s3: '8.4px', s4: '11.2px', s6: '16.8px', s8: '22.4px', panel: '22px', section: '18px' },
      borderRadius: { badge: '4px', btn: '6px', md: '8px', lg: '14px', pill: '99px' },
      keyframes: {
        skel: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
        dot: { '0%,100%': { opacity: '1', transform: 'scale(1)' }, '50%': { opacity: '.35', transform: 'scale(.7)' } }
      },
      animation: { skel: 'skel 1.8s ease-in-out infinite', dot: 'dot 1s ease-in-out infinite' }
    }
  }
};
