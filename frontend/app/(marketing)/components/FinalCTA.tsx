import { Button } from './ui/Button';

export function FinalCTA() {
  return (
    <section id="demo" className="px-5 py-24 md:px-8">
      <div className="mx-auto max-w-5xl rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center md:p-14">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-white/35">
          Book a Demo
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
          See how clause.id fits your legal workflow.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/55 md:text-base">
          Review contracts, negotiate with evidence, and manage legal execution in one AI-native workspace.
        </p>
        <div className="mt-8 flex justify-center">
          <Button href="mailto:hello@clause.id?subject=Book%20a%20Demo">
            Book a Demo
          </Button>
        </div>
      </div>
    </section>
  );
}
