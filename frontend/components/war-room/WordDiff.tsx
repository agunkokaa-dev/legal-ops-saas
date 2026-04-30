'use client'

import React, { useMemo } from 'react';
import DiffMatchPatch from 'diff-match-patch';

export interface WordDiffProps {
    oldText: string;
    newText: string;
    className?: string;
    showStructuralChangeBadge?: boolean;
    title?: string;
    category?: string;
    roundNumber?: number;
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

function renderTokenSpans(
    text: string,
    keyPrefix: string,
    tokenClassName: string
): React.ReactNode[] {
    const tokens = text.match(/\S+|\s+/g) || [];

    return tokens.map((token, index) => {
        const key = `${keyPrefix}-${index}`;

        if (/^\s+$/.test(token)) {
            return <React.Fragment key={key}>{token}</React.Fragment>;
        }

        return (
            <span key={key} className={tokenClassName}>
                {token}
            </span>
        );
    });
}

function collectTokens(
    diffs: [number, string][],
    includeOperation: -1 | 0 | 1,
    stableClassName: string,
    changedClassName: string,
    keyPrefix: string
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];

    diffs.forEach(([operation, text], index) => {
        if (operation !== includeOperation && operation !== 0) {
            return;
        }

        nodes.push(
            <React.Fragment key={`${keyPrefix}-${index}`}>
                {renderTokenSpans(
                    text,
                    `${keyPrefix}-${index}`,
                    operation === includeOperation ? changedClassName : stableClassName
                )}
            </React.Fragment>
        );
    });

    return nodes;
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
 * The structural-change pill is owned by the parent War Room renderer.
 */
export default function WordDiff({ oldText, newText, className = '', showStructuralChangeBadge = false, title, category, roundNumber = 1 }: WordDiffProps) {
    const { diffs, isHeavyRewrite, addedCount, removedCount, totalChanges } = useMemo(() => {
        if (!oldText && !newText) return { diffs: [], isHeavyRewrite: false, addedCount: 0, removedCount: 0, totalChanges: 0 };

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

        // Step 5: Count metrics and detect heavy rewrites
        let v1WordCount = 0;
        let v2WordCount = 0;
        let addedCount = 0;
        let removedCount = 0;

        for (const [op, text] of wordDiffs) {
            const count = text.trim().length > 0 ? text.trim().split(/\s+/).length : 0;
            if (op === -1) {
                removedCount += count;
                v1WordCount += count;
            } else if (op === 1) {
                addedCount += count;
                v2WordCount += count;
            } else {
                v1WordCount += count;
                v2WordCount += count;
            }
        }
        
        const totalChanges = addedCount + removedCount;
        const maxWords = Math.max(v1WordCount, v2WordCount) || 1;
        const isHeavyRewrite = (totalChanges / maxWords) > 0.4;

        return {
            diffs: wordDiffs,
            isHeavyRewrite,
            addedCount,
            removedCount,
            totalChanges
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
        <div className={`overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900/60 ${className}`}>
            <div className="flex items-center justify-between border-b border-zinc-700/60 bg-[#111115] px-4 py-3">
                <span className="text-sm font-semibold text-zinc-100">
                    {title || category || 'Word-Level Diff'}
                </span>
                
                <div className="flex items-center gap-2">
                    {(showStructuralChangeBadge || isHeavyRewrite) && (
                        <span className="flex items-center gap-1 text-xs text-[#B8B8B8]">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                            Structural Change Detected
                        </span>
                    )}
                    
                    {category && (
                        <span className="rounded border border-[#3A3A3A] bg-[#1C1C1C] px-2 py-0.5 text-xs font-semibold text-[#B8B8B8]">
                            {category.toUpperCase()}
                        </span>
                    )}
                </div>
            </div>

            <div className="border-b border-zinc-800/60 bg-zinc-950/40 px-4 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Version 2 (Round {roundNumber}) revision summary
                </span>
            </div>

            <div className="divide-y divide-zinc-800/60">
                <div className="flex items-start gap-3 border-b border-zinc-800/60 px-4 py-3">
                    <div className="flex-1 whitespace-pre-wrap text-sm leading-relaxed">
                        {collectTokens(
                            diffs,
                            -1,
                            'text-zinc-200',
                            'text-red-400 line-through decoration-red-400/70 decoration-[1px]',
                            'removed'
                        )}
                    </div>
                    <span className="shrink-0 rounded bg-red-500/20 px-2 py-1 text-[10px] font-semibold text-red-400">
                        Removed
                    </span>
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                </div>

                <div className="flex items-start gap-3 px-4 py-3">
                    <div className="flex-1 whitespace-pre-wrap text-sm leading-relaxed">
                        {collectTokens(
                            diffs,
                            1,
                            'text-zinc-200',
                            'text-emerald-400',
                            'added'
                        )}
                    </div>
                    <span className="shrink-0 rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-400">
                        Added
                    </span>
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                </div>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-700/60 bg-[#111115] px-4 py-2">
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-sm border border-zinc-600 bg-zinc-800" />
                        Unchanged
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="h-0.5 w-3 bg-red-500/60" />
                        Removed
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-sm border border-emerald-500/20 bg-emerald-500/15" />
                        Added
                    </span>
                </div>
                
                <span className="text-xs text-zinc-500">
                    {totalChanges} changes • {addedCount} added • {removedCount} removed
                </span>
            </div>
        </div>
    );
}
