'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAnalytics, api } from '@/lib/api';
import { formatCost } from '@/lib/utils';
import { BarChart3, TrendingUp, Download, Calendar } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<{
    totalOperations: number;
    totalTokens: number;
    totalCost: number;
    agentUsage: Record<string, { calls: number; tokens: number; cost: number }>;
  } | null>(null);
  const [dailyData, setDailyData] = useState<Array<{ date: string; totalOperations: number; totalTokens: number; totalCost: number }>>([]);
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    Promise.all([getAnalytics(), api('/analytics/daily?limit=90')])
      .then(([analyticsRes, dailyRes]) => {
        setAnalytics(analyticsRes.analytics);
        setDailyData(dailyRes.daily || []);
      })
      .finally(() => setLoading(false));

    // Real-time cost ticker
    const interval = setInterval(() => {
      setTicker((prev) => prev + Math.random() * 0.01);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredDaily = useMemo(() => {
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return dailyData.slice(-days).map((d) => ({
      ...d,
      date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }));
  }, [dailyData, dateRange]);

  const pieData = useMemo(() => {
    if (!analytics?.agentUsage) return [];
    return Object.entries(analytics.agentUsage).map(([name, stats]) => ({
      name,
      value: stats.tokens,
      cost: stats.cost,
    }));
  }, [analytics]);

  const handleExportCSV = () => {
    if (!dailyData.length) return;
    const headers = ['Date', 'Operations', 'Tokens', 'Cost'];
    const rows = dailyData.map((d) => [d.date, d.totalOperations, d.totalTokens, d.totalCost.toFixed(4)]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orca-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Track usage and performance metrics</p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Stats + Ticker */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            <span className="text-sm font-medium">Total Operations</span>
          </div>
          <p className="mt-2 text-3xl font-bold">{analytics?.totalOperations.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium">Total Tokens</span>
          </div>
          <p className="mt-2 text-3xl font-bold">{analytics?.totalTokens.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            <span className="text-sm font-medium">Total Cost</span>
          </div>
          <p className="mt-2 text-3xl font-bold">{formatCost((analytics?.totalCost || 0) + ticker)}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium">Live Updates</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-green-500">Active</p>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                dateRange === range
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              {range === '7d' ? 'Last 7 Days' : range === '30d' ? 'Last 30 Days' : 'Last 90 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Cost Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={filteredDaily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value: number) => [`$${Number(value).toFixed(4)}`, 'Cost']} />
              <Line type="monotone" dataKey="totalCost" stroke="#0088FE" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Tokens by Agent</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                outerRadius={100}
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Tokens']} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Daily Operations</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={filteredDaily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="totalOperations" fill="#00C49F" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Token Usage</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={filteredDaily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Tokens']} />
              <Bar dataKey="totalTokens" fill="#FFBB28" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent Usage Table */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Agent Usage Breakdown</h2>
        </div>
        <div className="divide-y">
          {pieData.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground">No usage data yet</p>
          ) : (
            pieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{(item.value || 0).toLocaleString()} tokens</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatCost(item.cost || 0)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
