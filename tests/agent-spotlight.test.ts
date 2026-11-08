import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentSpotlight, spotlightGeometry } from '../src/components/agent-spotlight';

const viewport = { left: 0, top: 0, width: 1440, height: 900 };

test('spotlight ignores missing, offscreen, invisible fragments and invalid geometry', () => {
  for (const target of [
    { left: 1500, top: 30, width: 200, height: 100 },
    { left: 50, top: -90, width: 200, height: 95 },
    { left: 50, top: 50, width: 0, height: 100 },
    { left: Number.NaN, top: 50, width: 100, height: 100 },
  ]) assert.equal(spotlightGeometry(target, viewport), null);
});

test('partially visible record gets an outline only around its visible area', () => {
  const placement = spotlightGeometry({ left: -60, top: 30, width: 200, height: 950 }, viewport);
  assert.ok(placement);
  assert.deepEqual(placement.outline, { left: 10, top: 30, width: 130, height: 860 });
  assert.ok(placement.cursor.left >= placement.outline.left);
  assert.ok(placement.cursor.top >= placement.outline.top);
});

test('cursor and label remain inside small, offset and edge-positioned viewports', () => {
  for (const frame of [viewport, { left: 0, top: 0, width: 320, height: 480 }, { left: 40, top: 100, width: 240, height: 180 }]) {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const target = { left: frame.left + (corner.endsWith('right') ? frame.width - 40 : 0), top: frame.top + (corner.startsWith('bottom') ? frame.height - 40 : 0), width: 40, height: 40 };
      const placement = spotlightGeometry(target, frame);
      assert.ok(placement);
      assert.ok(placement.label);
      for (const box of [placement.outline, placement.label, { ...placement.cursor, width: 20, height: 20 }]) {
        assert.ok(box.left >= frame.left + 10);
        assert.ok(box.top >= frame.top + 10);
        assert.ok(box.left + box.width <= frame.left + frame.width - 10);
        assert.ok(box.top + box.height <= frame.top + frame.height - 10);
      }
    }
  }
});

test('server rendering never invents a target or touches the browser', () => {
  const activity = { id: 'actual-tool', phase: 'working' as const, label: 'Finding donor records', targets: ['donor-list'] };
  assert.equal(renderToStaticMarkup(createElement(AgentSpotlight, { activity, enabled: true })), '');
  assert.equal(renderToStaticMarkup(createElement(AgentSpotlight, { activity, enabled: false })), '');
  assert.equal(renderToStaticMarkup(createElement(AgentSpotlight, { activity: null, enabled: true })), '');
});

const overlaps = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

test('review label uses available right, left, above or below space without covering facts', () => {
  for (const target of [
    { left: 300, top: 200, width: 400, height: 400 },
    { left: 1100, top: 200, width: 300, height: 400 },
    { left: 20, top: 200, width: 1400, height: 680 },
    { left: 20, top: 20, width: 1400, height: 680 },
  ]) {
    const placement = spotlightGeometry(target, viewport, true);
    assert.ok(placement?.label);
    assert.equal(overlaps(placement.outline, placement.label), false);
  }
});

test('full-height mobile approval preserves only the outline when no label space exists', () => {
  const placement = spotlightGeometry({ left: 10, top: 12, width: 355, height: 788 }, { left: 0, top: 0, width: 375, height: 812 }, true);
  assert.ok(placement);
  assert.equal(placement.label, null);
  assert.deepEqual(placement.outline, { left: 10, top: 12, width: 355, height: 788 });
});
