/**
 * CalcMate Design System — Education-focused palette
 *
 * Primary: Deep Teal (#1B5E5A) — trust, calm, intelligence
 * Accent:  Turmeric Gold (#C8860A) — warmth, attention, South-Asian context
 * Surface: Warm Parchment (#FAF7F2) — offline-first, paper-like feel
 * Danger:  Terracotta Red (#B94040) — alerts without harshness
 */

const semantic = {
  background:    '#FAF7F2',
  surface:       '#FFFFFF',
  text:          '#1A2320',
  textMuted:     '#5A6B67',
  primary:       '#1B5E5A',
  primarySurface:'#E6F0EF',
  border:        '#D8D2C8',
  attention:     '#C8860A',
  attentionSurface: '#FDF3DC',
  danger:        '#B94040',
  success:       '#1B5E5A',
} as const;

export const colors = {
  ...semantic,

  // Backgrounds
  ivory:         '#FAF7F2',
  paper:         '#FFFFFF',
  paperWarm:     '#FBF8F3',

  // Brand greens
  forest:        '#1B5E5A',
  forestSoft:    '#2A7A75',
  forestMid:     '#3D9E97',
  sage:          '#A8C5C2',
  sageLight:     '#E6F0EF',
  sagePale:      '#F2F8F7',

  // Accent golds
  gold:          '#C8860A',
  goldLight:     '#FDF3DC',
  goldPale:      '#FFFAED',

  // Neutrals
  charcoal:      '#1A2320',
  charcoalMid:   '#2E3D3A',
  charcoalMuted: '#5A6B67',
  charcoalLight: '#8FA09C',
  line:          '#E2DBD0',
  lineLight:     '#EDE8E0',

  // Semantic
  danger:        '#B94040',
  dangerLight:   '#F9E8E8',
  warning:       '#C8860A',
  warningLight:  '#FDF3DC',
  check:         '#1B5E5A',
  checkLight:    '#E6F0EF',

  // State colours for mastery
  masteryHigh:   '#1B5E5A',   // ≥ 70%  — likely ready
  masteryMid:    '#C8860A',   // 60-70% — developing
  masteryLow:    '#B94040',   // < 60%  — needs support
  masteryNone:   '#C4BAB0',   // unknown

  white:         '#FFFFFF',
  black:         '#000000',
} as const;
