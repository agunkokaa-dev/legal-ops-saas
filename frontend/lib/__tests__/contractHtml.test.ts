import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeContractHtml } from '../contractHtml.ts';

test('sanitizeContractHtml preserves mark tags', () => {
    const html = '<p>text <mark>highlighted</mark> text</p>';
    const result = sanitizeContractHtml(html);
    assert.match(result, /<mark>highlighted<\/mark>/);
});

test('sanitizeContractHtml strips script tags and content', () => {
    const html = '<p>safe</p><script>alert(1)</script>';
    const result = sanitizeContractHtml(html);
    assert.doesNotMatch(result, /script/i);
    assert.doesNotMatch(result, /alert/i);
    assert.match(result, /<p>safe<\/p>/);
});

test('sanitizeContractHtml strips onerror event handlers', () => {
    const html = '<img src=x onerror="steal()">';
    const result = sanitizeContractHtml(html);
    assert.doesNotMatch(result, /onerror/i);
});

test('sanitizeContractHtml strips javascript hrefs', () => {
    const html = '<a href="javascript:void(0)">click</a>';
    const result = sanitizeContractHtml(html);
    assert.doesNotMatch(result, /javascript:/i);
    assert.equal(result, 'click');
});

test('sanitizeContractHtml strips iframe content', () => {
    const html = '<p>text</p><iframe src="evil.com"></iframe>';
    const result = sanitizeContractHtml(html);
    assert.doesNotMatch(result, /iframe/i);
    assert.match(result, /<p>text<\/p>/);
});

test('sanitizeContractHtml handles null and undefined', () => {
    assert.equal(sanitizeContractHtml(null), '');
    assert.equal(sanitizeContractHtml(undefined), '');
});

test('sanitizeContractHtml preserves structural tags', () => {
    const html = '<h1>Title</h1><p>Para</p><ul><li>item</li></ul>';
    const result = sanitizeContractHtml(html);
    assert.match(result, /<h1>Title<\/h1>/);
    assert.match(result, /<p>Para<\/p>/);
    assert.match(result, /<ul><li>item<\/li><\/ul>/);
});
