#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A conservative gate over actual-render summaries, never inferred display FPS. */
export function analyzeRuntime(input, metadata = {}) {
  const events = Array.isArray(input) ? input : input.events;
  if (!Array.isArray(events)) throw new Error('Expected exported PaeanGameDiagnostic events');
  const groups = new Map();
  let activeKey = '', continuous = 0, lastTime = null;
  for (const event of events) {
    if (event.event !== 'frames') {
      if (['paused', 'process-terminated', 'navigation-failed', 'ready-timeout', 'document-ready'].includes(event.event)) {
        continuous = 0; lastTime = null;
      }
      continue;
    }
    const v = event.values || {}, target = v.targetFPS;
    if (![30, 60].includes(target) || event.mode !== 'play') continue;
    const key = [event.contentKey, event.version, event.appBuild, event.systemVersion, target].join('|');
    if (!groups.has(key)) groups.set(key, { contentKey: event.contentKey, version: event.version,
      appBuild: event.appBuild, systemVersion: event.systemVersion, targetFPS: target, samples: 0,
      frames: 0, longFrames: 0, maxWindowP95: 0, activeSeconds: 0, longestContinuousSeconds: 0,
      maxThermal: 0, lowPowerSamples: 0, missingMetrics: false });
    const group = groups.get(key);
    const elapsed = Number(v.elapsed) / 1000;
    const time = typeof event.timestamp === 'number' ? event.timestamp : Date.parse(event.timestamp) / 1000;
    const longFrames = target === 60 ? v.longFrames : v.veryLongFrames;
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 10 || !Number.isFinite(time) ||
        !Number.isFinite(v.p95) || !Number.isInteger(v.frames) || v.frames < 5 ||
        !Number.isInteger(longFrames) || longFrames < 0 || longFrames > v.frames) {
      group.missingMetrics = true; continuous = 0; lastTime = null; continue;
    }
    if (activeKey !== key || lastTime === null || time - lastTime > elapsed + 2 || time <= lastTime) continuous = 0;
    activeKey = key; lastTime = time; continuous += elapsed;
    group.samples++; group.frames += v.frames; group.longFrames += longFrames;
    group.maxWindowP95 = Math.max(group.maxWindowP95, v.p95);
    group.activeSeconds += elapsed;
    group.longestContinuousSeconds = Math.max(group.longestContinuousSeconds, continuous);
    group.maxThermal = Math.max(group.maxThermal, v.thermal || 0);
    group.lowPowerSamples += v.lowPower === 1 ? 1 : 0;
  }
  const environment = { ...(Array.isArray(input) ? {} : input.metadata), ...metadata };
  return { environment, note: 'p95 is the maximum per-window p95, not a reconstructed global percentile or screen-present FPS.',
    profiles: [...groups.values()].map(g => {
      const blockers = [], actions = [];
      if (environment.kind !== 'physical-device' || !environment.device) blockers.push('Missing identified physical-device evidence');
      if (!/^[a-f0-9]{64}$/.test(g.version || '')) blockers.push('Not a published immutable content version');
      if (g.missingMetrics) blockers.push('Incomplete frame/elapsed metrics');
      if (g.longestContinuousSeconds < 900) blockers.push('Less than 15 continuous minutes in this content/FPS profile');
      const longFrameRatio = g.frames ? g.longFrames / g.frames : null;
      if (longFrameRatio !== null && (g.maxWindowP95 > (g.targetFPS === 60 ? 20 : 38) || longFrameRatio >= .01)) {
        blockers.push('Frame stability exceeds the selected profile budget');
        actions.push('Profile the real renderer: separate JS/physics/GC time from draw calls, shader and fill-rate cost; lower the relevant cost and repeat the same scene.');
      }
      if (g.maxThermal >= 2) actions.push('Serious thermal pressure observed: compare energy and preview contention on the same device.');
      if (g.lowPowerSamples) actions.push('Low Power Mode occurred: report this separately from the normal-power baseline.');
      if (g.missingMetrics || g.longestContinuousSeconds < 900) actions.push('Repeat an uninterrupted foreground replay with the current helper; keep pauses, loads and quality transitions outside the stable profile.');
      return { ...g, longFrameRatio, frameGate: blockers.length ? 'not-passed' : 'passed', blockers, actions };
    }),
    incidents: events.filter(e => ['process-terminated', 'navigation-failed', 'ready-timeout'].includes(e.event)).map(e => ({ event: e.event, contentKey: e.contentKey, version: e.version, timestamp: e.timestamp })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node analyze-runtime.mjs diagnostics.json [metadata.json]');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const metadata = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : {};
  console.log(JSON.stringify(analyzeRuntime(input, metadata), null, 2));
}
