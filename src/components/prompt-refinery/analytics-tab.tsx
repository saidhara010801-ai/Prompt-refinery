'use client';

import { useEffect, useState } from 'react';
import { Activity, FileText, Gauge, Wand2 } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirebase } from '@/firebase';

interface DashboardData {
  totalRefinements: number;
  totalConversions: number;
  evaluationCount: number;
  scoreImprovement: number | null;
  mostUsedTechnique: string | null;
  monthly: Array<{ month: string; refinements: number; evaluations: number; conversions: number; averageScore: number | null }>;
}

export function AnalyticsTab() {
  const { user } = useFirebase();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken()
      .then((token) => fetch('/api/analytics', { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || 'Could not load analytics.');
        if (active) setData(payload);
      })
      .catch((caught) => active && setError(caught instanceof Error ? caught.message : 'Could not load analytics.'));
    return () => { active = false; };
  }, [user]);

  if (error) return <Card><CardContent className="py-12 text-center text-sm text-destructive">{error}</CardContent></Card>;
  if (!data) return <div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;

  const metrics = [
    { label: 'Refinements', value: data.totalRefinements, icon: Wand2 },
    { label: 'Conversions', value: data.totalConversions, icon: FileText },
    { label: 'Evaluations', value: data.evaluationCount, icon: Gauge },
    { label: 'Score improvement', value: data.scoreImprovement === null ? 'No trend yet' : `${data.scoreImprovement >= 0 ? '+' : ''}${data.scoreImprovement}`, icon: Activity },
  ];

  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div><Icon className="h-5 w-5 text-primary" /></CardContent></Card>)}
    </div>
    <Card>
      <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2"><span>12-month activity</span><span className="text-sm font-normal text-muted-foreground">Top technique: {data.mostUsedTechnique || 'No data yet'}</span></CardTitle></CardHeader>
      <CardContent className="h-80">
        {data.monthly.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.monthly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="refinements" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" /><Area type="monotone" dataKey="evaluations" stroke="hsl(var(--foreground))" fill="hsl(var(--foreground) / 0.08)" /></AreaChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Activity will appear after your next refinement, evaluation, or conversion.</div>}
      </CardContent>
    </Card>
  </div>;
}
