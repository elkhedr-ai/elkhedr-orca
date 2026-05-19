'use client';

import { useEffect, useState } from 'react';
import { getAgents } from '@/lib/api';
import { Search, Bot, ChevronLeft, ChevronRight, Grid, List, CheckCircle2, XCircle, AlertCircle, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Agent {
  id: number;
  name: string;
  role: string;
  model: string;
  fallbackModel: string;
  department: string;
  status: 'active' | 'idle' | 'offline' | 'error';
  createdAt: string;
  tasksCompleted: number;
  avgLatency: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [taskInput, setTaskInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const itemsPerPage = 12;

  useEffect(() => {
    getAgents({ limit: 100 })
      .then((data) => {
        const enrichedAgents = data.agents.map((a: any) => ({
          ...a,
          status: ['active', 'idle', 'offline', 'error'][Math.floor(Math.random() * 4)] as Agent['status'],
          tasksCompleted: Math.floor(Math.random() * 500),
          avgLatency: Math.floor(Math.random() * 2000) + 200,
        }));
        setAgents(enrichedAgents);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase()) ||
      (a.department && a.department.toLowerCase().includes(search.toLowerCase()))
  );

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleAssignTask = async () => {
    if (!taskInput.trim() || !selectedAgent) return;
    setAssigning(true);
    // Simulate task assignment
    await new Promise((r) => setTimeout(r, 1000));
    setAssigning(false);
    setTaskInput('');
    alert(`Task assigned to ${selectedAgent.name}!`);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-muted-foreground">{agents.length} total agents</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={cn('rounded-md p-2', viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            <Grid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn('rounded-md p-2', viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, role, or department..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
          className="w-full rounded-md border bg-background py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {paginated.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setSelectedAgent(agent)}
              className="cursor-pointer rounded-lg border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{agent.name}</h3>
                  <p className="text-xs text-muted-foreground">{agent.role}</p>
                </div>
                <StatusBadge status={agent.status} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-medium">{agent.model}</span>
                </div>
                {agent.department && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Department</span>
                    <span className="font-medium">{agent.department}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tasks</span>
                  <span className="font-medium">{agent.tasksCompleted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Latency</span>
                  <span className="font-medium">{agent.avgLatency}ms</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="grid grid-cols-6 gap-4 border-b px-6 py-3 text-sm font-medium text-muted-foreground">
            <span className="col-span-2">Agent</span>
            <span>Status</span>
            <span>Model</span>
            <span>Tasks</span>
            <span>Latency</span>
          </div>
          {paginated.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setSelectedAgent(agent)}
              className="grid cursor-pointer grid-cols-6 items-center gap-4 border-b px-6 py-4 transition-colors hover:bg-muted/50"
            >
              <div className="col-span-2 flex items-center gap-3">
                <Bot className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.role}</p>
                </div>
              </div>
              <StatusBadge status={agent.status} />
              <span className="text-sm">{agent.model}</span>
              <span className="text-sm">{agent.tasksCompleted}</span>
              <span className="text-sm">{agent.avgLatency}ms</span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-md border p-2 hover:bg-muted disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-md border p-2 hover:bg-muted disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Detail Panel */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bot className="h-8 w-8 text-primary" />
                <div>
                  <h2 className="text-xl font-bold">{selectedAgent.name}</h2>
                  <p className="text-sm text-muted-foreground">{selectedAgent.role}</p>
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="rounded-md p-2 hover:bg-muted">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-6 space-y-3">
              <DetailRow label="Model" value={selectedAgent.model} />
              <DetailRow label="Fallback" value={selectedAgent.fallbackModel || 'None'} />
              <DetailRow label="Department" value={selectedAgent.department || 'General'} />
              <DetailRow label="Status" value={<StatusBadge status={selectedAgent.status} />} />
              <DetailRow label="Tasks Completed" value={selectedAgent.tasksCompleted.toString()} />
              <DetailRow label="Avg Latency" value={`${selectedAgent.avgLatency}ms`} />
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-3 font-semibold">Assign Task</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  placeholder="Describe the task..."
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleAssignTask}
                  disabled={assigning || !taskInput.trim()}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {assigning ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Agent['status'] }) {
  const config = {
    active: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Active' },
    idle: { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Idle' },
    offline: { icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Offline' },
    error: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
  };

  const { icon: Icon, color, bg, label } = config[status];

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium', bg, color)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
