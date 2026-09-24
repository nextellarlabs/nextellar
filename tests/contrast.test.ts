const COLORS = {
  white: '#ffffff',
  pageDark: '#0a0a0a',
  gray600: '#4b5563',
  gray300: '#d1d5db',
  red700: '#b91c1c',
  green700: '#15803d',
  blue700: '#1d4ed8',
  orange700: '#c2410c',
  indigo800: '#3730a3',
};

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => parseInt(channel, 16) / 255);
  if (!channels) throw new Error(`Invalid color: ${hex}`);

  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('template contrast palette', () => {
  it('keeps normal muted text at WCAG AA contrast in both themes', () => {
    expect(contrastRatio(COLORS.gray600, COLORS.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLORS.gray300, COLORS.pageDark)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['red', COLORS.red700],
    ['green', COLORS.green700],
    ['blue', COLORS.blue700],
    ['orange', COLORS.orange700],
  ])('keeps white CounterDemo text readable on %s actions', (_name, background) => {
    expect(contrastRatio(COLORS.white, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the CounterDemo display readable across its gradient endpoints', () => {
    expect(contrastRatio(COLORS.white, COLORS.blue700)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLORS.white, COLORS.indigo800)).toBeGreaterThanOrEqual(4.5);
  });
});
