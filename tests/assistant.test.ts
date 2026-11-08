import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Assistant } from '../src/components/assistant';

test('assistant initially renders only its accessible floating launcher',()=>{
 const html=renderToStaticMarkup(createElement(Assistant,{aiAvailable:false,onResult:()=>{}}));
 assert.match(html,/Start live voice conversation/);assert.match(html,/Talk to GiftGuard/);
 assert.doesNotMatch(html,/What would you like to do/);assert.doesNotMatch(html,/Message GiftGuard/);
 assert.doesNotMatch(html,/role="dialog"/);
});
