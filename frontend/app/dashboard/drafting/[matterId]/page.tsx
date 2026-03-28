"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import SmartComposer from "@/components/drafting/SmartComposer";

export default function DraftingWorkspacePage({ params }: { params: Promise<{ matterId: string }> }) {
    const router = useRouter();
    const resolvedParams = use(params);
    
    return (
        <SmartComposer 
            matterId={resolvedParams.matterId} 
            taskTitle="Live Drafting Session" 
            onClose={() => router.push('/dashboard/drafting')} 
        />
    );
}
