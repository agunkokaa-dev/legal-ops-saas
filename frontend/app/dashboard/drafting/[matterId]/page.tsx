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
    const draftId = searchParams.get('draft_id') || undefined;
    const source = searchParams.get('source') || undefined;

    const taskTitle = mode === 'warroom' 
        ? "War Room — Working Draft" 
        : mode === 'review' 
            ? "Review & Apply Changes" 
            : "Live Drafting Session";

    return (
        <SmartComposer 
            matterId={resolvedParams.matterId} 
            taskTitle={taskTitle}
            onClose={() => router.push(
                mode === 'warroom' && contractId 
                    ? `/dashboard/contracts/${contractId}/war-room` 
                    : '/dashboard/drafting'
            )}
            mode={mode}
            contractId={contractId}
            focusFindingId={focusFinding}
            draftId={draftId}
            source={source}
        />
    );
}
