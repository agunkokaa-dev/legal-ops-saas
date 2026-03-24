'use client';

import dynamic from 'next/dynamic';

const PDFHighlighterComponent = dynamic(
    () => import('./PDFHighlighterComponent'),
    {
        ssr: false,
        loading: () => <div className="h-full w-full flex-1 flex items-center justify-center text-text-muted">Initializing PDF Viewer...</div>
    }
);

export default function PDFViewerWrapper(props: { fileUrl: string, contractId: string, scrollToId?: string | null, notes?: any[], draftVersion?: string | null }) {
    return <PDFHighlighterComponent {...props} />;
}
