export const CREDIT_PACKS = [
  {
    name: 'Council Explorer',
    credits: 100,
    description: '~15–50 debates depending on models chosen. Great for trying AI Council.',
    unitAmount: 2900,
    expirationDays: 90,
    metadata: { type: 'credit_pack', credits: '100', tier: 'explorer' },
  },
  {
    name: 'Council Strategist',
    credits: 400,
    description: '~55–200 debates depending on models chosen. For regular use.',
    unitAmount: 8900,
    expirationDays: 120,
    metadata: { type: 'credit_pack', credits: '400', tier: 'strategist' },
  },
  {
    name: 'Council Mastermind',
    credits: 1000,
    description: '~130–500 debates depending on models chosen. For power users and teams.',
    unitAmount: 17900,
    expirationDays: 180,
    metadata: { type: 'credit_pack', credits: '1000', tier: 'mastermind' },
  },
];

export function getCreditPackBySize(size: number) {
  return CREDIT_PACKS.find(p => p.credits === size);
}
