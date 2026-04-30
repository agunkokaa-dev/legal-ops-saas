import { comparisonRows } from '@/lib/landing-data';
import { Icon } from './ui/Icon';
import { SectionHeader } from './ui/SectionHeader';

export function ComparisonTable() {
  return (
    <section id="comparison" className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Comparison"
          title="A contract intelligence layer for modern legal teams."
          description="Replace fragmented review, negotiation, and obligation tracking with one source-backed workflow."
          align="center"
        />

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
          <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr] border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-[0.22em] text-white/35">
            <div className="p-4">Capability</div>
            <div className="p-4">clause.id</div>
            <div className="p-4">Manual workflow</div>
          </div>
          {comparisonRows.map((row) => (
            <div key={row} className="grid grid-cols-[1.2fr_0.9fr_0.9fr] border-b border-white/10 last:border-b-0">
              <div className="p-4 text-sm text-white/75">{row}</div>
              <div className="flex items-center gap-2 p-4 text-sm text-white/70">
                <Icon name="check" className="text-[18px] text-emerald-300/70" />
                Included
              </div>
              <div className="p-4 text-sm text-white/35">Fragmented</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
