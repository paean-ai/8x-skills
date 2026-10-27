import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCommand, execute } from '../claude-code/paean-tutorial/scripts/tutorial.mjs';

test('reading and learning never call remix or purchase', () => {
  for (const args of [['show', 'course'], ['content', 'course', '--preview'], ['learn', 'course'], ['progress', 'course']]) {
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

test('switching versions preserves notes only with explicit authorization and precondition', () => {
  assert.throws(() => planCommand(['learn', 'course', '--latest', '--version', '3']), /--yes/);
  assert.deepEqual(planCommand(['learn', 'course', '--latest', '--version', '3', '--yes']).body, { useLatest: true, expectedVersion: 3 });
});

test('raw HTML and Markdown create documents without curriculum fields', () => {
  for (const ext of ['html', 'md']) {
    const plan = planCommand(['create', 'game', '--file', `/private/process.${ext}`, '--title', 'Agent workflow', '--price', '120'], () => 'Freeform process document');
    assert.equal(plan.body.format, ext === 'html' ? 'html' : 'markdown');
    assert.equal(plan.body.content, 'Freeform process document'); assert.equal(plan.body.priceCredits, 120);
    assert.ok(!('chapters' in plan.body));
  }
});
test('raw file updates preserve existing price, title and preview and reject stale versions', async () => {
  const plan = planCommand(['save', 'course', '--version', '3', '--file', '/private/process.html'], () => '<h1>Agent workflow</h1>');
  const requests = [];
  await execute(plan, { token: 'fixture', fetchImpl: async (_url, opts) => {
    requests.push(opts);
    return { ok: true, json: async () => ({ data: { draftVersion: 3, document: { title: 'Existing title', priceCredits: 120, previewContent: 'Preview', format: 'markdown', content: 'Old' } } }) };
  } });
  assert.equal(requests.length, 2);
  const updated = JSON.parse(requests[1].body).document;
  assert.equal(updated.priceCredits, 120); assert.equal(updated.previewContent, 'Preview'); assert.equal(updated.title, 'Existing title'); assert.equal(updated.format, 'html');
  let calls = 0;
  await assert.rejects(execute(plan, { token: 'fixture', fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: { draftVersion: 4 } }) }; } }), /draft changed/);
  assert.equal(calls, 1);
});
