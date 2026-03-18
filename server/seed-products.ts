import { getUncachableStripeClient } from './stripeClient';
import { CREDIT_PACKS } from './creditPacks';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  for (const pack of CREDIT_PACKS) {
    const existing = await stripe.products.search({ query: `name:'${pack.name}'` });
    if (existing.data.length > 0) {
      console.log(`${pack.name} already exists:`, existing.data[0].id);
      const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
      console.log('  Prices:', prices.data.map(p => `${p.id}: $${(p.unit_amount || 0) / 100}`));
      continue;
    }

    const product = await stripe.products.create({
      name: pack.name,
      description: pack.description,
      metadata: pack.metadata,
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: pack.unitAmount,
      currency: 'usd',
    });

    console.log(`Created ${pack.name}: product=${product.id}, price=${price.id} ($${pack.unitAmount / 100})`);
  }
}

createProducts()
  .then(() => {
    console.log('Seed complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
