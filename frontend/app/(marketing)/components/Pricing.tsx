import { Icon } from './ui/Icon';

const tiers = [
  {
    name: 'Starter',
    target: 'In-house legal & startup',
    price: null,
    period: '',
    description: 'Untuk tim kecil yang mulai mendigitalisasi proses review kontrak.',
    features: [
      '5 kontrak per bulan',
      'AI Contract Review (7 agents)',
      'Clause Assistant',
      'Obligation Tracking',
      'Email support',
    ],
    cta: 'Mulai Trial',
    ctaHref: '#demo',
    ctaVariant: 'secondary',
    highlight: false,
  },
  {
    name: 'Professional',
    target: 'Law firm boutique & mid-size',
    price: null,
    period: '',
    description: 'Untuk firma yang butuh negosiasi terstruktur dan playbook enforcement.',
    features: [
      'Kontrak tidak terbatas',
      'Semua fitur Starter',
      'Negotiation War Room',
      'Playbook Enforcement',
      'Smart Drafting',
      'Bilingual Workflow',
      'Priority support',
    ],
    cta: 'Book a Demo',
    ctaHref: '#demo',
    ctaVariant: 'primary',
    highlight: true,
  },
  {
    name: 'Enterprise',
    target: 'Corporate & large firm',
    price: null,
    period: '',
    description: 'Untuk organisasi dengan kebutuhan multi-matter, SSO, dan SLA khusus.',
    features: [
      'Semua fitur Professional',
      'Multi-matter management',
      'SSO & user provisioning',
      'Custom playbook setup',
      'Dedicated onboarding',
      'SLA & uptime guarantee',
      'Invoice & PO payment',
    ],
    cta: 'Hubungi Kami',
    ctaHref: '#demo',
    ctaVariant: 'secondary',
    highlight: false,
  },
] as const;

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl scroll-mt-28 px-5 py-24 md:px-8 md:py-32">
      <div className="mb-16 text-center">
        <p className="mb-4 inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
          Pricing
        </p>
        <h2 className="mb-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
          Transparan dan skalabel
        </h2>
        <p className="mx-auto max-w-xl text-base leading-7 text-white/50">
          Mulai dengan trial gratis. Upgrade saat tim Anda siap. Semua paket
          termasuk AI review yang didukung referensi hukum Indonesia.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`relative flex flex-col rounded-[2rem] border p-8 ${
              tier.highlight
                ? 'border-white/25 bg-white/[0.06]'
                : 'border-white/10 bg-white/[0.025]'
            }`}
          >
            {tier.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full border border-white/20 bg-[#08090b] px-3 py-1 text-xs font-medium text-white/70">
                  Paling Populer
                </span>
              </div>
            )}

            <div className="mb-6">
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/40">
                {tier.target}
              </p>
              <h3 className="mb-1 text-xl font-semibold text-white">{tier.name}</h3>
              <p className="text-sm leading-6 text-white/50">{tier.description}</p>
            </div>

            {/* Price block */}
            <div className="mb-6 pb-6 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/30 italic">Pricing coming soon</span>
              </div>
              <p className="text-xs text-white/20 mt-1">
                Hubungi kami untuk informasi harga
              </p>
            </div>

            <ul className="mb-8 flex-1 space-y-3">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-white/65">
                  <Icon name="check" className="mt-0.5 shrink-0 text-[18px] text-white/40" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <a
              href={tier.ctaHref}
              className={`w-full rounded-xl py-3 text-center text-sm font-medium transition ${
                tier.ctaVariant === 'primary'
                  ? 'bg-white text-[#08090b] hover:bg-white/90'
                  : 'border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]'
              }`}
            >
              {tier.cta}
            </a>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-xs text-white/30">
        Harga dalam IDR. Belum termasuk PPN. Pembayaran via transfer bank atau invoice.
      </p>
    </section>
  );
}
