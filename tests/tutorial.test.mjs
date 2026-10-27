import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCommand, execute } from '../claude-code/paean-tutorial/scripts/tutorial.mjs';

test('reading and learning never call remix or purchase', () => {
  for (const args of [['show', 'course'], ['chapter', 'course', '--chapter', 'jump'], ['learn', 'course'], ['progress', 'course']]) {
    const p = planCommand(args); assert.ok(!p.endpoint.includes('remix')); assert.ok(!p.endpoint.includes('purchase'));
  }
});
test('buy requires authorization, exact quote and supports a stable retry key', () => {
  assert.throws(() => planCommand(['buy', 'course', '--price', '100', '--version', '1']), /--yes/);
  assert.throws(() => planCommand(['buy', 'course', '--price', '-1', '--version', '1', '--yes']), /--price/);
  const p = planCommand(['buy', 'course', '--price', '100', '--version', '1', '--request-key', 'stable-purchase-1234', '--yes']);
  assert.deepEqual(p.body, { requestKey: 'stable-purchase-1234', expectedPriceCredits: 100, expectedVersion: 1 });
});
test('dry run makes no request and never prints credentials', async () => {
  const p = planCommand(['buy', 'course', '--price', '100', '--version', '1', '--dry-run']);
  const r = await execute(p, { token: 'secret-fixture', fetchImpl: () => assert.fail('network called') });
  assert.equal(JSON.stringify(r).includes('secret-fixture'), false);
});
test('save uses optimistic version and an external draft', () => {
  const p = planCommand(['save', 'course', '--version', '2', '--file', '/private/draft.json'], () => '{"title":"A lesson"}');
  assert.equal(p.method, 'PATCH'); assert.equal(p.body.expectedVersion, 2); assert.equal(p.body.document.title, 'A lesson');
});
test('API forwards the authenticated identity and purchase is not automatically retried', async () => {
  const p = planCommand(['buy', 'course', '--price', '100', '--version', '1', '--yes']); let calls = 0;
  await assert.rejects(execute(p, { token: 'fixture', fetchImpl: async (url, opts) => { calls++; assert.equal(opts.headers.Authorization, 'Bearer fixture'); assert.equal(opts.redirect, 'error'); return { ok: false, status: 409, json: async () => ({ code: 'TUTORIAL_PRICE_CHANGED', error: 'Review new quote' }) }; } }), /TUTORIAL_PRICE_CHANGED/);
  assert.equal(calls, 1);
});

test('switching versions resets progress only with explicit authorization and precondition', () => {
  assert.throws(() => planCommand(['learn', 'course', '--restart-latest', '--version', '3']), /--yes/);
  assert.deepEqual(planCommand(['learn', 'course', '--restart-latest', '--version', '3', '--yes']).body, { restartLatest: true, expectedVersion: 3 });
});
