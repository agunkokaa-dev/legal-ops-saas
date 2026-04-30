import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BuiltForIndonesia } from './components/BuiltForIndonesia';
import { ComparisonTable } from './components/ComparisonTable';
import { DemoAndTrial } from './components/DemoAndTrial';
import { FAQ } from './components/FAQ';
import { FeatureGrid } from './components/FeatureGrid';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { HowItWorks } from './components/HowItWorks';
import { Navbar } from './components/Navbar';
import { Pricing } from './components/Pricing';
import { ProductPillars } from './components/ProductPillars';
import { SecurityTrust } from './components/SecurityTrust';

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen scroll-smooth bg-[#08090b] font-[Inter,system-ui,sans-serif] text-white antialiased">
      <Navbar />
      <main>
        <Hero />
        <ProductPillars />
        <HowItWorks />
        <BuiltForIndonesia />
        <FeatureGrid />
        <SecurityTrust />
        <Pricing />
        <ComparisonTable />
        <FAQ />
        <DemoAndTrial />
      </main>
      <Footer />
    </div>
  );
}
