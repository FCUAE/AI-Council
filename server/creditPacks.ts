export const CREDIT_PACKS = [
  {
    name: 'Council Explorer',
    credits: 100,
    description: 'Around 20-50 debates depending on models chosen. Great for trying AI Council.',
    unitAmount: 1500,
    metadata: { type: 'credit_pack', credits: '100' },
  },
  {
    name: 'Council Strategist',
    credits: 325,
    description: 'Around 65-160 debates depending on models chosen. For regular use.',
    unitAmount: 3900,
    metadata: { type: 'credit_pack', credits: '325' },
  },
  {
    name: 'Council Visionary',
    credits: 900,
    description: 'Around 180-450 debates depending on models chosen. For power users and teams.',
    unitAmount: 8900,
    metadata: { type: 'credit_pack', credits: '900' },
  },
];

export function getCreditPackBySize(size: number) {
  return CREDIT_PACKS.find(p => p.credits === size);
}
