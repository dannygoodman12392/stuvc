/** @type {import('tailwindcss').Config} */

// ══════════════════════════════════════════════════════════════════════════
// The Stu design system.
//
// Verified against the shipped CSS of Linear, Attio, Granola, and Permute
// (measured 2026-07-15 in Danny's own Permute workspace: 32px control rows,
// #fafafa ground, hairlines at rgb(217,220,227), a 1,139-token variable system).
//
// Five rules, and every token below exists to serve one of them:
//
//   1. ONE PRIMARY INK PER ROW. The company name is `ink`. Everything else is
//      ink-2/3/4. If two things in a row compete for the eye, the row failed.
//   2. SOLID GREYS, NEVER OPACITY, for text. Linear does not fade text — it
//      ships a discrete ramp. Alpha is only for hover fills and hairlines.
//      (The "text at 60% opacity" folklore is wrong; the CSS says otherwise.)
//   3. HAIRLINES + A BACKGROUND LADDER, NEVER SHADOWS. Linear ships zero drop
//      shadows. Border hierarchy does the work spacing was failing to do.
//   4. COLOR MEANS STATE, NEVER DECORATION. One accent. Red only for
//      destructive. Urgency is a PROMOTION UP THE INK RAMP, not a new hue.
//      Conviction bands are typographic — a band is never a colored pill.
//   5. AI RECEDES. Machine text sits at ink-3, Danny's text at ink. No badge,
//      no italics, no sparkle. (NN/G tested ✨ on 107 people; zero said "AI".)
//      For an investor tool the AI is the substrate, not a feature.
//
// Density: 32px rows, 8px cell padding, 1px separators, FULL BLEED. ~24 rows on
// a 900px screen. Never center content in a wide frame — whitespace at the edges
// reads as absence; whitespace between dense elements reads as calm.
// ══════════════════════════════════════════════════════════════════════════

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        // Numerals that align in a column. Any figure the eye scans down a table
        // (scores, dates, counts) uses this, or the column reads as ragged.
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // The type scale. Five sizes, and the negative tracking is not decoration —
      // it is the optical correction that stops 13px from looking like a default.
      fontSize: {
        micro: ['11px', { lineHeight: '16px', letterSpacing: '0.04em' }], // UPPERCASE section labels only
        mini: ['12px', { lineHeight: '16px', letterSpacing: '-0.01em' }], // metadata, timestamps
        small: ['13px', { lineHeight: '20px', letterSpacing: '-0.013em' }], // row titles — the workhorse
        regular: ['15px', { lineHeight: '24px', letterSpacing: '-0.011em' }], // prose, Danny's own writing
        large: ['18px', { lineHeight: '28px', letterSpacing: '-0.015em' }], // page titles
        display: ['28px', { lineHeight: '34px', letterSpacing: '-0.02em' }], // the one number on a page
        '2xs': ['0.6875rem', '1rem'], // retained: 35 existing usages
      },

      // Linear's real weights. Variable-font optical corrections, and a large part
      // of why their UI doesn't read as a Tailwind default. 500 -> 510, 600 -> 590.
      fontWeight: { normal: '400', medium: '510', semibold: '590', bold: '680' },

      colors: {
        // ── The ink ramp. FOUR SOLID GREYS. Never an opacity. ──
        // Promoting a row's text from ink-3 to ink is how urgency is expressed.
        ink: {
          DEFAULT: '#16181d', // primary   — the company name. One per row.
          2: '#4a4f57', // secondary — supporting values that earn a read
          3: '#7c828c', // tertiary  — metadata, and ALL machine-authored text
          4: '#a8adb5', // quaternary— labels, placeholders, disabled
        },

        // ── The background ladder. Elevation via ground, not shadow. ──
        ground: {
          DEFAULT: '#ffffff', // rows, cards
          2: '#fafafa', // page ground (Permute's, measured)
          3: '#f4f5f7', // hover fill, table header
          4: '#eceef1', // pressed, selected
        },

        // ── Hairlines. Three weights, per Attio. ──
        line: {
          DEFAULT: '#e6e8eb', // row separators — the default
          2: '#d9dce3', // section edges (Permute's, measured)
          3: '#c4c9d1', // emphasis, focus
        },

        // ── The one accent. Interactive / selected / the single primary action. ──
        // Not #3b82f6. That blue is the uniform of unfinished software.
        accent: {
          DEFAULT: '#5e6ad2',
          hover: '#4c57bd',
          soft: '#f0f1fb',
          line: '#c9cdee',
        },

        // ── Red is DESTRUCTIVE ONLY. Not "bad score". Not "pass". ──
        // A pass is a respectable outcome and must never render as an error.
        danger: { DEFAULT: '#c8372d', hover: '#a92c24', soft: '#fdf2f1' },

        // ── The single non-accent state hue: something needs Danny. ──
        // Used ONLY by the attention engine, and only when a check is not clean.
        attention: { DEFAULT: '#9a6700', soft: '#fff8e6', line: '#f0dca8' },
      },

      spacing: { px: '1px', 0.5: '2px', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px' },

      // Never 16px in dense UI — it reads as a consumer app.
      borderRadius: { sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px' },

      // Speed is a visual. Hover-in is 0ms (see .row in index.css); only the
      // fade-OUT is animated. Superhuman targets <50ms; the way to win is to
      // precompute and never spin.
      transitionDuration: { fast: '100ms', DEFAULT: '150ms', slow: '250ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(.2,0,0,1)' },

      height: { row: '32px' },
      minHeight: { row: '32px' },
    },
  },
  plugins: [],
};
