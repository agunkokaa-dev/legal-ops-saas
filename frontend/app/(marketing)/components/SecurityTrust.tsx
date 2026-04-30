import { securityChecks } from '@/lib/landing-data';
import { Icon } from './ui/Icon';
import { SectionHeader } from './ui/SectionHeader';

export function SecurityTrust() {
  return (
    <section className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 md:p-10">
        <SectionHeader
          eyebrow="Security and trust"
          title="Built for sensitive legal work."
          description="Legal AI needs evidence, isolation, and operational visibility from the start."
        />

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {securityChecks.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#08090b]/60 p-4">
              <Icon name="check" className="text-[18px] text-white/55" />
              <span className="text-sm text-white/65">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
