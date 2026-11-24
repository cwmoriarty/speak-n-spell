// Custom static three-state illustrated SVG monkey mascot (zero animations, zero system emojis)
// States: 'listening' (open attentive ears), 'retry' (cupped ear), 'muted' (paws over mouth)

const BASE_HEAD = `
  <!-- Ears -->
  <circle cx="14" cy="31" r="8.5" fill="#7c4d2b" stroke="#1d1a16" stroke-width="2.2"/>
  <circle cx="14" cy="31" r="4.5" fill="#e6c3a5"/>
  <circle cx="50" cy="31" r="8.5" fill="#7c4d2b" stroke="#1d1a16" stroke-width="2.2"/>
  <circle cx="50" cy="31" r="4.5" fill="#e6c3a5"/>
  <!-- Head -->
  <circle cx="32" cy="31" r="19" fill="#7c4d2b" stroke="#1d1a16" stroke-width="2.2"/>
  <!-- Top hair tuft -->
  <path d="M28 12.5 C30 8.5, 34 8.5, 35.5 12.2" fill="none" stroke="#1d1a16" stroke-width="2.2" stroke-linecap="round"/>
  <!-- Face mask -->
  <path d="M18.5 31 C18.5 22.5, 25 20.5, 28.5 23.5 C30.5 25.2, 33.5 25.2, 35.5 23.5 C39 20.5, 45.5 22.5, 45.5 31 C45.5 34.5, 44 37.5, 41.5 39.5 C40 44.5, 36.5 47.5, 32 47.5 C27.5 47.5, 24 44.5, 22.5 39.5 C20 37.5, 18.5 34.5, 18.5 31 Z" fill="#f3dfc1"/>
  <!-- Nose -->
  <ellipse cx="29.5" cy="35.2" rx="1.2" ry="0.9" fill="#5e3a1f"/>
  <ellipse cx="34.5" cy="35.2" rx="1.2" ry="0.9" fill="#5e3a1f"/>
`;

const STATE_DETAILS = {
  listening: `
    ${BASE_HEAD}
    <!-- Attentive eyes -->
    <circle cx="25.5" cy="29.5" r="2.4" fill="#1d1a16"/>
    <circle cx="38.5" cy="29.5" r="2.4" fill="#1d1a16"/>
    <circle cx="26.3" cy="28.7" r="0.8" fill="#ffffff"/>
    <circle cx="39.3" cy="28.7" r="0.8" fill="#ffffff"/>
    <!-- Warm smile -->
    <path d="M26.5 40 C28.5 42.6, 35.5 42.6, 37.5 40" fill="none" stroke="#1d1a16" stroke-width="2.1" stroke-linecap="round"/>
    <!-- Subtle active listening indicator dot -->
    <circle cx="51" cy="14" r="5" fill="#236038" stroke="#faf7f1" stroke-width="2"/>
  `,
  retry: `
    ${BASE_HEAD}
    <!-- Curious eyes & raised brow -->
    <path d="M22.5 25.2 Q25.5 23.5 28.5 25" fill="none" stroke="#1d1a16" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M35.5 25.6 Q38.5 24.8 41.5 26" fill="none" stroke="#1d1a16" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="25.5" cy="29.8" r="2.3" fill="#1d1a16"/>
    <circle cx="38.5" cy="29.8" r="2.3" fill="#1d1a16"/>
    <!-- Puzzled small 'o' / gentle line mouth -->
    <circle cx="32" cy="41.2" r="2.1" fill="none" stroke="#1d1a16" stroke-width="2"/>
    <!-- Paws gently covering/cupping ears -->
    <ellipse cx="13.5" cy="35" rx="5.2" ry="7.2" transform="rotate(-14 13.5 35)" fill="#8c5a35" stroke="#1d1a16" stroke-width="2.1"/>
    <ellipse cx="50.5" cy="35" rx="5.2" ry="7.2" transform="rotate(14 50.5 35)" fill="#8c5a35" stroke="#1d1a16" stroke-width="2.1"/>
  `,
  muted: `
    ${BASE_HEAD}
    <!-- Calm closed/relaxed eyes -->
    <path d="M22.8 30.2 Q25.5 28 28.2 30.2" fill="none" stroke="#1d1a16" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M35.8 30.2 Q38.5 28 41.2 30.2" fill="none" stroke="#1d1a16" stroke-width="2.1" stroke-linecap="round"/>
    <!-- Paws quietly covering mouth -->
    <ellipse cx="26.5" cy="43.5" rx="6.2" ry="4.8" transform="rotate(-18 26.5 43.5)" fill="#8c5a35" stroke="#1d1a16" stroke-width="2.1"/>
    <ellipse cx="37.5" cy="43.5" rx="6.2" ry="4.8" transform="rotate(18 37.5 43.5)" fill="#8c5a35" stroke="#1d1a16" stroke-width="2.1"/>
  `
};

export function renderMascotSvg(state = 'listening') {
  const inner = STATE_DETAILS[state] || STATE_DETAILS.listening;
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" role="img" aria-hidden="true">${inner}</svg>`;
}
