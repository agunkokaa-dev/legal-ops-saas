'use client'

import React, { useMemo } from 'react';
import DiffMatchPatch from 'diff-match-patch';

interface WordDiffProps {
    oldText: string;
    newText: string;
    className?: string;
}

/**
 * Converts text into word-level tokens by mapping each word to a unique
 * Unicode character. This lets diff-match-patch diff "words" instead of
 * individual characters, producing true inline word-level diffs.
 *
 * This is the documented "line mode" technique from diff-match-patch,
 * adapted for word boundaries instead of newline boundaries.
 */
function tokenizeToWords(text1: string, text2: string): {
    chars1: string;
    chars2: string;
    wordArray: string[];
} {
    const wordMap: Map<string, number> = new Map();
    const wordArray: string[] = [];

    function encodeWords(text: string): string {
        let encoded = '';
        // Split on word boundaries, preserving whitespace and punctuation as tokens
        const tokens = text.match(/\S+|\s+/g) || [];

        for (const token of tokens) {
            if (wordMap.has(token)) {
                encoded += String.fromCharCode(wordMap.get(token)!);
            } else {
                const idx = wordArray.length;
                wordArray.push(token);
                wordMap.set(token, idx);
                encoded += String.fromCharCode(idx);
            }
        }
        return encoded;
    }

    const chars1 = encodeWords(text1);
    const chars2 = encodeWords(text2);

    return { chars1, chars2, wordArray };
}

/**
 * Converts the character-encoded diff back to human-readable word-level diff.
 * Each "character" in the diff maps to a word token from wordArray.
 */
function decodeDiffs(
    diffs: [number, string][],
    wordArray: string[]
): [number, string][] {
    return diffs.map(([op, chars]) => {
        let decoded = '';
        for (let i = 0; i < chars.length; i++) {
            const idx = chars.charCodeAt(i);
            decoded += wordArray[idx] ?? chars[i];
        }
        return [op, decoded] as [number, string];
    });
}

/**
 * Calculates the percentage of text that was changed (deleted + inserted)
 * relative to the total text volume.
 */
function calculateChangeRatio(diffs: [number, string][]): number {
    let changedChars = 0;
    let totalChars = 0;

    for (const [op, text] of diffs) {
        const len = text.length;
        totalChars += len;
        if (op !== 0) {
            changedChars += len;
        }
    }

    return totalChars > 0 ? changedChars / totalChars : 0;
}

/**
 * WordDiff — True inline word-level diff visualization.
 *
 * Uses the word-tokenization trick with Google's diff-match-patch
 * to produce interleaved red/green diffs at word boundaries:
 *   - Deleted words:  red text with strikethrough
 *   - Added words:    green text with background highlight
 *   - Unchanged text: normal rendering
 *
 * If >80% of the text was rewritten, shows a [ HEAVILY REWRITTEN ] badge.
 */
export default function WordDiff({ oldText, newText, className = '' }: WordDiffProps) {
    const { diffs, isHeavyRewrite } = useMemo(() => {
        if (!oldText && !newText) return { diffs: [], isHeavyRewrite: false };

        const dmp = new DiffMatchPatch();

        // Step 1: Tokenize both texts into word-level tokens
        const { chars1, chars2, wordArray } = tokenizeToWords(
            oldText || '',
            newText || ''
        );

        // Step 2: Diff the encoded (word-per-character) strings
        const encodedDiffs = dmp.diff_main(chars1, chars2);

        // Step 3: Semantic cleanup — groups diffs into readable logical chunks
        dmp.diff_cleanupSemantic(encodedDiffs);

        // Step 4: Decode back to human-readable words
        const wordDiffs = decodeDiffs(encodedDiffs, wordArray);

        // Step 5: Detect heavy rewrites (>80% changed)
        const changeRatio = calculateChangeRatio(wordDiffs);

        return {
            diffs: wordDiffs,
            isHeavyRewrite: changeRatio > 0.8
        };
    }, [oldText, newText]);

    if (diffs.length === 0) {
        return (
            <p className={`text-zinc-400 text-[13px] leading-relaxed ${className}`}>
                {newText || oldText}
            </p>
        );
    }

    return (
        <div className={`text-[13px] leading-[1.8] font-sans ${className}`}>
            {/* Heavy Rewrite Badge */}
            {isHeavyRewrite && (
                <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded mb-3">
                    <span className="material-symbols-outlined text-[12px]">warning</span>
                    Heavily Rewritten — Structure Fundamentally Changed
                </div>
            )}

            {/* Inline Diff Render */}
            <div>
                {diffs.map((diff, index) => {
                    const [operation, text] = diff;

                    // DIFF_DELETE = -1 (word was in V1, removed in V2)
                    if (operation === -1) {
                        return (
                            <span
                                key={index}
                                className="line-through text-zinc-500 bg-rose-950/30 px-1 rounded-sm"
                                title="Removed from V1"
                            >
                                {text}
                            </span>
                        );
                    }

                    // DIFF_INSERT = 1 (word added in V2, not in V1)
                    if (operation === 1) {
                        return (
                            <span
                                key={index}
                                className="no-underline text-zinc-200 bg-emerald-950/30 px-1 rounded-sm"
                                title="Added in V2"
                            >
                                {text}
                            </span>
                        );
                    }

                    // DIFF_EQUAL = 0 (word survived between V1 and V2)
                    return (
                        <span key={index} className="text-zinc-400">
                            {text}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
