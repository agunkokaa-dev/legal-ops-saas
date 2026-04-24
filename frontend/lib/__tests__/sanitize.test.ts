import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeLlmText, stripHtml } from '../sanitize.ts';

test('stripHtml removes HTML tags', () => {
    assert.equal(stripHtml('<b>bold</b> text'), 'bold text');
});

test('stripHtml handles null and undefined', () => {
    assert.equal(stripHtml(null), '');
    assert.equal(stripHtml(undefined), '');
});

test('stripHtml strips script tags and content', () => {
    const result = stripHtml('<script>alert(1)</script>text');
    assert.doesNotMatch(result, /script/i);
    assert.doesNotMatch(result, /alert/i);
    assert.match(result, /text/);
});

test('assertSafeLlmText passes clean text through', () => {
    const text = 'Normal legal analysis text.';
    assert.equal(assertSafeLlmText(text), text);
});

test('assertSafeLlmText strips script tags and content', () => {
    const result = assertSafeLlmText('<script>xss()</script>content');
    assert.doesNotMatch(result, /script/i);
    assert.doesNotMatch(result, /xss/i);
    assert.match(result, /content/);
});

test('assertSafeLlmText removes javascript protocol text', () => {
    const result = assertSafeLlmText('Click javascript:void(0)');
    assert.doesNotMatch(result, /javascript:/i);
});

test('assertSafeLlmText returns empty string for null', () => {
    assert.equal(assertSafeLlmText(null), '');
});
