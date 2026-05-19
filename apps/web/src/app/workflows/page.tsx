'use client';

import { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Play, Save, Trash2, Bot, GitBranch, GitCommit, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowNode extends Node {
  data: { label: string; type: string; config?: Record<string, string> };
}

const nodeTypes = [
  { type: 'agent', label: 'Agent', icon: Bot, color: '#3b82f6' },
  { type: 'condition', label: 'Condition', icon: GitBranch, color: '#f59e0b' },
  { type: 'loop', label: 'Loop', icon: Circle, color: '#10b981' },
  { type: 'approval', label: 'Approval', icon: GitCommit, color: '#8b5cf6' },
];

export default function WorkflowBuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState('New Workflow');
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const addNode = (type: string, label: string, color: string) => {
    const newNode: WorkflowNode = {
      id: `${type}-${Date.now()}`,
      type: 'default',
      position: { x: Math.random() * 400 + 50, y: Math.random() * 300 + 50 },
      data: { label, type, config: {} },
      style: { borderColor: color, borderWidth: 2 },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  };

  const saveWorkflow = async () => {
    setSaving(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
    alert('Workflow saved!');
  };

  const executeWorkflow = async () => {
    setExecuting(true);
    // Simulate execution
    await new Promise((r) => setTimeout(r, 2000));
    setExecuting(false);
    alert('Workflow executed successfully!');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Workflow Builder</h1>
          <p className="text-muted-foreground">Design and execute agent workflows</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={saveWorkflow}
            disabled={saving}
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={executeWorkflow}
            disabled={executing || nodes.length === 0}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {executing ? 'Running...' : 'Execute'}
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Node Palette */}
        <div className="w-48 shrink-0 space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Components</h3>
          {nodeTypes.map((nt) => {
            const Icon = nt.icon;
            return (
              <button
                key={nt.type}
                onClick={() => addNode(nt.type, nt.label, nt.color)}
                className="flex w-full items-center gap-2 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted"
              >
                <Icon className="h-4 w-4" style={{ color: nt.color }} />
                {nt.label}
              </button>
            );
          })}

          {selectedNode && (
            <div className="mt-4 rounded-md border p-3">
              <h3 className="mb-2 text-sm font-semibold">Node Properties</h3>
              <p className="text-xs text-muted-foreground">{selectedNode.data.label}</p>
              <button
                onClick={() => deleteNode(selectedNode.id)}
                className="mt-2 flex w-full items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
              >
                <Trash2 className="h-3 w-3" />
                Delete Node
              </button>
            </div>
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 rounded-lg border" style={{ height: 600 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right" className="text-xs text-muted-foreground">
              {nodes.length} nodes · {edges.length} edges
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
