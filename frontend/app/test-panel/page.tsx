'use client'

import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels"

export default function TestPanelPage() {
    return (
        <div className="h-screen w-screen bg-black overflow-hidden flex text-white font-sans">
            <PanelGroup orientation="horizontal" className="flex-1 w-full h-full">
                <Panel defaultSize={50} minSize={20} className="bg-red-500/20 border border-red-500 flex items-center justify-center">
                    <h1>Panel 1 (Red)</h1>
                </Panel>

                <PanelResizeHandle className="w-4 bg-white/20 hover:bg-white cursor-col-resize flex items-center justify-center transition-colors touch-none" />

                <Panel defaultSize={50} minSize={20} className="bg-[#B8B8B8]/20 border border-[#3A3A3A] flex items-center justify-center">
                    <h1>Panel 2 (Blue)</h1>
                </Panel>
            </PanelGroup>
        </div>
    )
}
