'use client';

/**
 * AIReviewDemo – Cinematic CSS-only animation for the "AI Contract Review" pillar.
 *
 * Three-phase loop (14 s):
 *   1. Intro   – problem statement + typing query   (0 – 28 %)
 *   2. Process – scan-line + analysis steps          (28 – 52 %)
 *   3. Result  – clause highlights, tags, summary    (52 – 100 %)
 *
 * Zero external images; every visual is a styled div.
 */

import './ai-review-demo.css';

/* ------------------------------------------------------------------ */
/*  Faux contract lines (rendered as thin strips)                      */
/* ------------------------------------------------------------------ */
const DOC_LINES = [
  { w: '82%', accent: false },
  { w: '91%', accent: false },
  { w: '68%', accent: true },   // ← will get a highlight
  { w: '95%', accent: false },
  { w: '74%', accent: false },
  { w: '88%', accent: true },   // ← highlight
  { w: '60%', accent: false },
  { w: '93%', accent: false },
  { w: '78%', accent: true },   // ← highlight
  { w: '85%', accent: false },
  { w: '70%', accent: false },
  { w: '90%', accent: false },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function AIReviewDemo() {
  return (
    <div className="aird-frame" aria-hidden="true">
      {/* ── Ambient glow ─────────────────────────────────────── */}
      <div className="aird-glow aird-glow--tl" />
      <div className="aird-glow aird-glow--br" />

      {/* ── Faux document ────────────────────────────────────── */}
      <div className="aird-doc">
        <div className="aird-doc__toolbar">
          <span className="aird-dot aird-dot--r" />
          <span className="aird-dot aird-dot--y" />
          <span className="aird-dot aird-dot--g" />
          <span className="aird-doc__title">Contract_MSA_2025.pdf</span>
        </div>
        <div className="aird-doc__body">
          {DOC_LINES.map((l, i) => (
            <div
              key={i}
              className={`aird-line ${l.accent ? 'aird-line--accent' : ''}`}
              style={{ width: l.w }}
            />
          ))}
        </div>

        {/* scan beam */}
        <div className="aird-scan" />
      </div>

      {/* ── Phase 1 : Intro copy ─────────────────────────────── */}
      <div className="aird-intro-copy">
        Manual clause review slows everything&nbsp;down
      </div>

      {/* ── Phase 1 : Query box ──────────────────────────────── */}
      <div className="aird-query">
        <span className="aird-query__text">
          Apakah kontrak ini compliant dengan UU PDP?
        </span>
        <span className="aird-query__send" />
      </div>

      {/* ── Phase 2 : Processing card ────────────────────────── */}
      <div className="aird-proc">
        <p className="aird-proc__title">Analysis in progress</p>
        {[
          'Initializing Clause Assistant',
          'Extracting contract context',
          'Cross-referencing Civil Code',
          'Evaluating Playbook rules',
        ].map((step, i) => (
          <div key={i} className={`aird-step aird-step--${i + 1}`}>
            <span className="aird-step__dot" />
            {step}
          </div>
        ))}
      </div>

      {/* ── Phase 3 : Focus highlights on doc ────────────────── */}
      <div className="aird-focus aird-focus--1" />
      <div className="aird-focus aird-focus--2" />
      <div className="aird-focus aird-focus--3" />

      {/* ── Phase 3 : Tags ───────────────────────────────────── */}
      <div className="aird-tag aird-tag--missing">Missing clause</div>
      <div className="aird-tag aird-tag--risk">Liability risk</div>
      <div className="aird-tag aird-tag--ok">Compliant</div>

      {/* ── Phase 3 : Summary callouts ───────────────────────── */}
      <div className="aird-summary aird-summary--a">
        <span className="aird-summary__dot aird-summary__dot--blue" />
        3 missing key clauses detected
      </div>
      <div className="aird-summary aird-summary--b">
        <span className="aird-summary__dot aird-summary__dot--amber" />
        Liability cap exceeds threshold
      </div>

      {/* ── Phase 3 : Closing headline ───────────────────────── */}
      <div className="aird-closing">
        <strong>Review contracts in minutes, not days.</strong>
        <span>Surface risk before it reaches negotiation.</span>
      </div>
    </div>
  );
}
