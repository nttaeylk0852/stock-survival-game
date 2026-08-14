/**
 * End-to-end smoke test against a running server (npm run dev:server).
 * Usage: node ../../node_modules/tsx/dist/cli.mjs src/test/smoke-api.ts
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(`${method} ${path} failed: ${json.error}`);
  return json.data as T;
}

async function main(): Promise<void> {
  console.log(`Smoke testing ${BASE}\n`);

  const health = await call<{ status: string; tick: number }>('GET', '/health');
  console.log(`  health: ${health.status} (tick ${health.tick})`);

  const username = `smoke-${Date.now()}`;
  const user = await call<{ userId: string }>('POST', '/api/users', { username });
  console.log(`  user created: ${user.userId}`);

  const created = await call<{ character: { id: string }; balance: number }>(
    'POST',
    '/api/characters',
    { userId: user.userId, name: 'SmokeRunner' }
  );
  const characterId = created.character.id;
  console.log(`  character created: ${characterId} (balance ${created.balance})`);

  const companies = await call<{ id: string; name: string; currentPrice: number }[]>(
    'GET',
    '/api/companies'
  );
  const company = companies[0];
  console.log(`  company: ${company.name} @ ${company.currentPrice.toFixed(2)}`);

  const trade = await call<{ method: string; total: number; shares: number; balance: number }>(
    'POST',
    '/api/trade',
    { characterId, companyId: company.id, side: 'buy', quantity: 5 }
  );
  console.log(
    `  bought 5 via ${trade.method} for ${trade.total.toFixed(2)} -> shares ${trade.shares}, balance ${trade.balance.toFixed(2)}`
  );

  const portfolio = await call<{
    balance: number;
    stockValue: number;
    netWorth: number;
    entries: unknown[];
  }>('GET', `/api/characters/${characterId}/portfolio`);
  console.log(
    `  portfolio: ${portfolio.entries.length} holding(s), cash ${portfolio.balance.toFixed(2)} + stock ${portfolio.stockValue.toFixed(2)} = net worth ${portfolio.netWorth.toFixed(2)}`
  );

  const meal = await call<{ cost: number; health: number }>('POST', '/api/survival/eat', {
    characterId,
  });
  console.log(`  ate for ${meal.cost.toFixed(2)} -> health ${meal.health}`);

  const agendas = await call<unknown[]>('GET', '/api/agendas');
  console.log(`  open agendas: ${agendas.length}`);

  const intel = await call<unknown[]>('GET', `/api/intel?characterId=${characterId}`);
  console.log(`  available intel: ${intel.length}`);

  const world = await call<{ tickCount: number }>('GET', '/api/world');
  console.log(`  world tick: ${world.tickCount}`);

  console.log('\nAll smoke checks passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
