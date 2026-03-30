export const CREDIT_PACKS = [
  {
    name: 'Council Explorer',
    credits: 100,
    description: '100 credits · Up to 50 debates · Unlock all AI models',
    unitAmount: 2900,
    expirationDays: 90,
    metadata: { type: 'credit_pack', credits: '100', tier: 'explorer' },
  },
  {
    name: 'Council Strategist',
    credits: 400,
    description: '400 credits · Up to 200 debates · Unlock all AI models',
    unitAmount: 8900,
    expirationDays: 120,
    metadata: { type: 'credit_pack', credits: '400', tier: 'strategist' },
  },
  {
    name: 'Council Mastermind',
    credits: 1000,
    description: '1,000 credits · Up to 500 debates · Unlock all AI models',
    unitAmount: 17900,
    expirationDays: 180,
    metadata: { type: 'credit_pack', credits: '1000', tier: 'mastermind' },
  },
];

export function getCreditPackBySize(size: number) {
  return CREDIT_PACKS.find(p => p.credits === size);
}
