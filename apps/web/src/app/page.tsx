'use client';

import { useEffect, useState } from 'react';
import { getAnalytics, getAgents, getSessions } from '@/lib/api';
import { formatDate, formatCost } from '@/lib/utils';
import {
  Activity,
  DollarSign,
  Users,
  Bot,
  TrendingUp,
  MessageSquare,
} from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalOperations: 0, totalTokens: 0, totalCost: 0 });
  const [agents, setAgents] = useState<Array<{ id: number; name: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ id: number; prompt: string; agent: string; tokens: number; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAnalytics(), getAgents({ limit: 5 }), getSessions({ limit: 5 })])
      .then(([analyticsData, agentsData, sessionsData]) => {
        setStats(analyticsData.analytics);
        setAgents(agentsData.agents);
        setSessions(sessionsData.sessions);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your agent activity</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Operations"
          value={stats.totalOperations.toLocaleString()}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          title="Total Tokens"
          value={stats.totalTokens.toLocaleString()}
          icon={<MessageSquare className="h-4 w-4" />}
        />
        <StatCard
          title="Total Cost"
          value={formatCost(stats.totalCost)}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          title="Active Agents"
          value={agents.length.toString()}
          icon={<Bot className="h-4 w-4" />}
        />
      </div>

      {/* Recent Sessions */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Recent Sessions</h2>
        </div>
        <div className="divide-y">
          {sessions.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground">No sessions yet</p>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{session.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.agent} · {session.tokens.toLocaleString()} tokens · {formatDate(session.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
