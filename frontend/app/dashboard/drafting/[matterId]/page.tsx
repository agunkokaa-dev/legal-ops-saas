"use client";

import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SmartComposer from "@/components/drafting/SmartComposer";

export default function DraftingWorkspacePage({ params }: { params: Promise<{ matterId: string }> }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const resolvedParams = use(params);
    
    const mode = searchParams.get('mode') || undefined;
    const contractId = searchParams.get('contract_id') || undefined;
    const focusFinding = searchParams.get('focus_finding') || undefined;

    return (
        <SmartComposer 
            matterId={resolvedParams.matterId} 
            taskTitle={mode === 'review' ? "Review & Apply Changes" : "Live Drafting Session"}
            onClose={() => router.push('/dashboard/drafting')}
            mode={mode}
            contractId={contractId}
            focusFindingId={focusFinding}
        />
    );
}
