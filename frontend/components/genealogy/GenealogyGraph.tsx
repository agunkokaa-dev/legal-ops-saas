'use client'

import { useMemo, useEffect } from 'react'
import {
    ReactFlow,
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
    Edge,
    Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import ParentNode from './nodes/ParentNode'
import ChildNode from './nodes/ChildNode'

const nodeTypes = {
    parent: ParentNode,
    child: ChildNode,
}

interface GenealogyGraphProps {
    documents?: any[],
    relationships?: any[],
    currentContractId?: string
}

export default function GenealogyGraph({ documents = [], relationships = [], currentContractId }: GenealogyGraphProps) {

    // Dynamic generation from database records
    const { initialNodes, initialEdges } = useMemo(() => {
        if (!documents.length) {
            return { initialNodes: [], initialEdges: [] }
        }

        const nodes: Node[] = []
        const edges: Edge[] = []

        // 1. Identify "Parent" Document(s). For this simplified tree, a parent is a doc that is never a "child_id" in relations.
        // If there are no relationships at all, we just treat the oldest doc or the first doc as a parent.
        const childIds = new Set(relationships.map(r => r.child_id))
        const parents = documents.filter(doc => !childIds.has(doc.id))
        const children = documents.filter(doc => childIds.has(doc.id))

        // If everything somehow is a child (circular dependency), take the first doc as parent
        const rootDocs = parents.length > 0 ? parents : [documents[0]];

        // 2. Position and push Root Nodes
        rootDocs.forEach((parentDoc, i) => {
            nodes.push({
                id: parentDoc.id,
                type: 'parent',
                position: { x: 250 + (i * 400), y: 50 },
                data: {
                    id: parentDoc.id,
                    category: parentDoc.document_category || 'Parent Contract',
                    title: parentDoc.title,
                    dealValue: parentDoc.contract_value || 'Not analyzed',
                    liabilityCap: parentDoc.risk_level || 'Unknown', // Map risk level as proxy if no cap exists
                    isCurrent: parentDoc.id === currentContractId
                }
            })
        })

        // 3. Position and push Child Nodes
        children.forEach((childDoc, i) => {
            // Determine a pseudo-status based on risk_level or just default 'active'
            let status = 'active'
            if (childDoc.document_category === 'Complete' || childDoc.risk_level === 'Low') status = 'completed'
            if (childDoc.document_category === 'Amendment') status = 'pending'

            nodes.push({
                id: childDoc.id,
                type: 'child',
                position: { x: i * 300, y: 300 },
                data: {
                    id: childDoc.id,
                    category: childDoc.document_category || 'Document',
                    title: childDoc.title || 'Untitled Document',
                    status: status,
                    value: childDoc.contract_value || '', // Optional secondary text
                    progress: status === 'active' ? 50 : undefined,
                    warning: childDoc.risk_level === 'High',
                    isCurrent: childDoc.id === currentContractId
                }
            })
        })

        // 4. Trace relationships to edges
        relationships.forEach((rel) => {
            edges.push({
                id: rel.id,
                source: rel.parent_id,
                target: rel.child_id,
                animated: true,
                style: { stroke: '#B8B8B8', strokeWidth: 2, filter: 'drop-shadow(0 0 5px rgba(184, 184, 184,0.3))' },
            })
        })

        return { initialNodes: nodes, initialEdges: edges }
    }, [documents, relationships])


    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

    // Sync state when DB data arrives asynchronously
    useEffect(() => {
        setNodes(initialNodes)
        setEdges(initialEdges)
    }, [initialNodes, initialEdges, setNodes, setEdges])

    return (
        <div className="w-full h-full min-h-[500px] bg-lux-black border border-lux-border rounded-lg relative overflow-hidden">
            {nodes.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="material-symbols-outlined text-lux-text-muted text-[48px] mb-4">account_tree</span>
                    <p className="text-lux-text-muted">No contract relationships found.</p>
                </div>
            ) : (
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 1 }}
                    minZoom={0.5}
                    maxZoom={1.5}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={24}
                        size={1}
                        color="#334155"
                    />
                    <Controls
                        className="bg-lux-card border-lux-border fill-white [&>button]:border-lux-border [&>button]:hover:bg-lux-border"
                    />
                </ReactFlow>
            )}

            {/* Floating Title Overlay */}
            <div className="absolute top-6 left-6 pointer-events-none z-10">
                <h3 className="text-lg font-serif text-white mb-1 shadow-black drop-shadow-md">Deal Genealogy Graph</h3>
                <p className="text-xs text-lux-text-muted font-bold uppercase tracking-wider shadow-black drop-shadow-md">
                    Mapped by Smart Ingestion
                </p>
            </div>
        </div>
    )
}

