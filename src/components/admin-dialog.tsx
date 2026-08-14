'use client';

import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Copy, RefreshCw, Search, ShieldAlert, Ticket, Trash2, UserCheck, UserCog, UserX } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface PromoCodeRecord { id: string; prefix: string; label: string | null; mode: string; maxRedemptions: number | null; redemptionCount: number; active: boolean }
interface PromoUser { id: string; uid: string; email: string; codeId: string }
interface InferenceHealth { requests: number; succeeded: number; failed: number; generative: number; fallback: number; malformedAttempts: number; latencyMs: { p50: number | null; p95: number | null }; budgets: Record<string, { settledUsd?: number; reservedUsd?: number } | null>; circuits: Array<{ id: string; state?: string; provider?: string }> }
interface SystemHealth { ready: boolean; checks: Record<string, boolean>; featureFlags: Record<string, boolean> }
interface AdminUser { uid: string; email: string; name: string; role: string; subscriptionTier: string; subscriptionSource: string | null; accountStatus: 'active' | 'disabled' | 'suspended' | 'deleted_pending' }
interface AuditLog { id: string; actorUid: string | null; actorRole: string | null; action: string; targetUid: string | null; metadataRedacted: Record<string, unknown>; createdAt: string | null }
type AdminFeed = 'codes' | 'promoUsers' | 'inference' | 'system' | 'audit';

export function AdminPanel() {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [codes, setCodes] = useState<PromoCodeRecord[]>([]);
  const [promoUsers, setPromoUsers] = useState<PromoUser[]>([]);
  const [mode, setMode] = useState<'single' | 'limited' | 'unlimited'>('single');
  const [limit, setLimit] = useState('10');
  const [label, setLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [betaUid, setBetaUid] = useState('');
  const [inferenceHealth, setInferenceHealth] = useState<InferenceHealth | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<AdminFeed, string>>>({});

  const api = async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Sign in to continue.');
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Admin request failed.');
    return payload;
  };

  const refresh = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const [codeResult, promoUserResult, healthResult, systemResult, auditResult] = await Promise.allSettled([
        api('/api/admin/promo-codes'),
        api('/api/admin/promo-users'),
        api('/api/admin/free-inference'),
        api('/api/admin/system-health'),
        api('/api/admin/audit-logs?pageSize=20'),
      ]);

      const errors: Partial<Record<AdminFeed, string>> = {};
      const failedLabels: string[] = [];
      const applyResult = <T,>(result: PromiseSettledResult<T>, feed: AdminFeed, label: string, apply: (value: T) => void) => {
        if (result.status === 'fulfilled') {
          apply(result.value);
          return;
        }

        errors[feed] = result.reason instanceof Error ? result.reason.message : 'Admin request failed.';
        failedLabels.push(label);
      };

      applyResult(codeResult, 'codes', 'promo codes', setCodes);
      applyResult(promoUserResult, 'promoUsers', 'promo users', setPromoUsers);
      applyResult(healthResult, 'inference', 'inference health', setInferenceHealth);
      applyResult(systemResult, 'system', 'system readiness', setSystemHealth);
      applyResult(auditResult, 'audit', 'audit activity', (value) => setAuditLogs(value.logs ?? []));
      setLoadErrors(errors);

      if (failedLabels.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Some Admin Data Could Not Load',
          description: `${failedLabels.join(', ')} failed. The available sections are still shown.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const searchUsers = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const result = await api('/api/admin/users/search', { method: 'POST', body: JSON.stringify({ search: search.trim(), pageSize: 25 }) });
      setAdminUsers(result.users ?? []);
    } catch (error) {
      toast({ variant: 'destructive', title: 'User Search Failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSearching(false);
    }
  };

  const mutateUser = async (url: string, body: Record<string, unknown> | undefined, successTitle: string) => {
    setBusy(true);
    try {
      await api(url, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      toast({ title: successTitle });
      await searchUsers();
      await refresh();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Admin Update Failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const createCode = async () => {
    setBusy(true);
    try {
      const result = await api('/api/admin/promo-codes', { method: 'POST', body: JSON.stringify({ mode, label, maxRedemptions: mode === 'limited' ? Number(limit) : null }) });
      setNewCode(result.code);
      setLabel('');
      await refresh();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Create Code', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const invalidate = async (codeId: string) => {
    await mutateUser(`/api/admin/promo-codes/${codeId}/invalidate`, undefined, 'Promo Code Invalidated');
  };

  const revokePromoUser = async (uid: string) => {
    await mutateUser(`/api/admin/promo-users/${uid}/revoke`, undefined, 'Promo Access Revoked');
  };

  const updateBeta = async (uid: string, enabled: boolean) => {
    if (!uid.trim()) return;
    setBusy(true);
    try {
      await api('/api/admin/free-inference', { method: 'POST', body: JSON.stringify({ uid: uid.trim(), enabled }) });
      toast({ title: enabled ? 'Managed Inference Enabled' : 'Managed Inference Disabled' });
      setBetaUid('');
      await refresh();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Update Beta Access', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">Clarift Administration</h3><p className="text-sm text-muted-foreground">Manage users, controlled access, release health, and audit activity.</p></div>
      <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /><span className="sr-only">Refresh administration data</span></Button>
    </div>
    <Tabs defaultValue="overview">
      <TabsList className="grid h-auto grid-cols-3 gap-1 sm:grid-cols-5">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="codes">Codes</TabsTrigger>
        <TabsTrigger value="inference">Inference</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        {loadErrors.system && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">System readiness could not load. Use Refresh to try again.</p>}
        <div className="flex items-center gap-2"><CheckCircle2 className={`h-5 w-5 ${systemHealth?.ready ? 'text-green-600' : 'text-amber-500'}`} /><span className="font-medium">{systemHealth?.ready ? 'Production ready' : 'Readiness needs attention'}</span></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(systemHealth?.checks ?? {}).map(([name, healthy]) => <div key={name} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"><span className="break-all">{name}</span><Badge variant={healthy ? 'secondary' : 'destructive'}>{healthy ? 'Ready' : 'Check'}</Badge></div>)}
        </div>
        <div className="space-y-2"><p className="text-sm font-medium">Feature flags</p><div className="flex flex-wrap gap-2">{Object.entries(systemHealth?.featureFlags ?? {}).map(([name, enabled]) => <Badge key={name} variant={enabled ? 'default' : 'outline'}>{name}: {enabled ? 'on' : 'off'}</Badge>)}</div></div>
      </TabsContent>

      <TabsContent value="users" className="space-y-4 pt-4">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void searchUsers(); }}>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Email prefix or Firebase UID" aria-label="Search users" />
          <Button type="submit" size="icon" disabled={searching || !search.trim()}><Search className="h-4 w-4" /><span className="sr-only">Search users</span></Button>
        </form>
        {adminUsers.map((adminUser) => <div key={adminUser.uid} className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{adminUser.name || adminUser.email || adminUser.uid}</p><p className="truncate text-xs text-muted-foreground">{adminUser.email || 'No email'} · {adminUser.uid}</p></div><div className="flex gap-2"><Badge variant="outline">{adminUser.role}</Badge><Badge variant={adminUser.accountStatus === 'active' ? 'secondary' : 'destructive'}>{adminUser.accountStatus}</Badge><Badge>{adminUser.subscriptionTier}</Badge></div></div>
          <div className="flex flex-wrap gap-2">
            <Select value={adminUser.accountStatus} onValueChange={(accountStatus) => void mutateUser(`/api/admin/users/${adminUser.uid}/status`, { accountStatus }, 'Account Status Updated')} disabled={busy || adminUser.uid === user?.uid}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="disabled">Disabled</SelectItem><SelectItem value="deleted_pending">Delete pending</SelectItem></SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => void mutateUser(`/api/admin/users/${adminUser.uid}/grant-pro`, { source: 'manual', reason: 'Owner grant from Admin Center' }, 'Pro Access Granted')} disabled={busy}><UserCheck className="h-4 w-4" />Grant Pro</Button>
            <Button type="button" variant="outline" onClick={() => void mutateUser(`/api/admin/users/${adminUser.uid}/revoke-pro`, undefined, 'Manual Pro Access Revoked')} disabled={busy}><UserX className="h-4 w-4" />Revoke Pro</Button>
            <Button type="button" variant="outline" onClick={() => void updateBeta(adminUser.uid, true)} disabled={busy}><UserCog className="h-4 w-4" />Enable AI Beta</Button>
          </div>
        </div>)}
        {!searching && search.trim() && adminUsers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No matching users.</p>}
      </TabsContent>

      <TabsContent value="codes" className="space-y-4 pt-4">
        {(loadErrors.codes || loadErrors.promoUsers) && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">Some promo data could not load. Use Refresh to try again.</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_100px_auto] sm:items-end">
          <div className="space-y-2"><Label htmlFor="promo-label">Label</Label><Input id="promo-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Alpha cohort" /></div>
          <div className="space-y-2"><Label>Mode</Label><Select value={mode} onValueChange={(value: typeof mode) => setMode(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single use</SelectItem><SelectItem value="limited">Limited</SelectItem><SelectItem value="unlimited">Unlimited</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="promo-limit">Uses</Label><Input id="promo-limit" type="number" min={2} max={10000} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={mode !== 'limited'} /></div>
          <Button type="button" size="icon" onClick={createCode} disabled={busy}><Ticket className="h-4 w-4" /><span className="sr-only">Create promo code</span></Button>
        </div>
        {newCode && <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-3"><code className="min-w-0 flex-1 break-all text-sm">{newCode}</code><Button type="button" variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(newCode)}><Copy className="h-4 w-4" /><span className="sr-only">Copy new code</span></Button></div>}
        <div className="space-y-2">{codes.map((code) => <div key={code.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{code.label || code.prefix}</p><p className="text-xs text-muted-foreground">{code.mode} · {code.redemptionCount}/{code.maxRedemptions ?? 'unlimited'} used</p></div><div className="flex items-center gap-2"><Badge variant={code.active ? 'default' : 'secondary'}>{code.active ? 'Active' : 'Inactive'}</Badge>{code.active && <Button type="button" variant="ghost" size="icon" onClick={() => void invalidate(code.id)} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Invalidate code</span></Button>}</div></div>)}</div>
        <div className="space-y-2"><p className="text-sm font-medium">Active promo users</p>{promoUsers.map((promoUser) => <div key={promoUser.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate font-medium">{promoUser.email}</p><p className="truncate text-xs text-muted-foreground">{promoUser.uid}</p></div><Button type="button" variant="outline" size="icon" onClick={() => void revokePromoUser(promoUser.uid)} disabled={busy}><UserX className="h-4 w-4" /><span className="sr-only">Revoke promo access</span></Button></div>)}{promoUsers.length === 0 && <p className="text-sm text-muted-foreground">No active promo users.</p>}</div>
      </TabsContent>

      <TabsContent value="inference" className="space-y-4 pt-4">
        {loadErrors.inference && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">Inference health could not load. Use Refresh to try again.</p>}
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={betaUid} onChange={(event) => setBetaUid(event.target.value)} placeholder="Firebase user UID" aria-label="Beta tester user ID" /><Button type="button" onClick={() => void updateBeta(betaUid, true)} disabled={busy || !betaUid.trim()}><UserCheck className="h-4 w-4" />Enable</Button><Button type="button" variant="outline" onClick={() => void updateBeta(betaUid, false)} disabled={busy || !betaUid.trim()}><UserX className="h-4 w-4" />Disable</Button></div>
        {inferenceHealth && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Requests', inferenceHealth.requests], ['Generative', inferenceHealth.generative], ['Basic mode', inferenceHealth.fallback], ['Malformed', inferenceHealth.malformedAttempts]].map(([itemLabel, value]) => <div key={String(itemLabel)} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{itemLabel}</p><p className="text-xl font-semibold">{value}</p></div>)}</div><div className="rounded-md border p-3 text-sm"><div className="mb-2 flex items-center gap-2 font-medium"><Activity className="h-4 w-4" />Last 24 hours</div><p>Success: {inferenceHealth.succeeded} · Failed: {inferenceHealth.failed} · p50: {inferenceHealth.latencyMs.p50 ?? 'n/a'} ms · p95: {inferenceHealth.latencyMs.p95 ?? 'n/a'} ms</p><p className="mt-1 text-muted-foreground">Spend: ${Number(inferenceHealth.budgets.overall?.settledUsd ?? 0).toFixed(4)} settled · ${Number(inferenceHealth.budgets.overall?.reservedUsd ?? 0).toFixed(4)} reserved</p></div><div className="space-y-2">{inferenceHealth.circuits.map((circuit) => <div key={circuit.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{circuit.provider || circuit.id}</span><Badge variant={circuit.state === 'open' ? 'destructive' : 'secondary'}>{circuit.state || 'closed'}</Badge></div>)}</div></>}
      </TabsContent>

      <TabsContent value="audit" className="space-y-2 pt-4">
        {loadErrors.audit && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">Audit activity could not load. Use Refresh to try again.</p>}
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldAlert className="h-4 w-4" />Sensitive values are redacted before audit records are stored.</div>
        {auditLogs.map((log) => <div key={log.id} className="space-y-1 rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{log.action}</span><span className="text-xs text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleString() : 'Unknown time'}</span></div><p className="break-all text-xs text-muted-foreground">Actor: {log.actorUid || 'unknown'} ({log.actorRole || 'unknown'}){log.targetUid ? ` · Target: ${log.targetUid}` : ''}</p>{Object.keys(log.metadataRedacted ?? {}).length > 0 && <code className="block break-all text-xs">{JSON.stringify(log.metadataRedacted)}</code>}</div>)}
      </TabsContent>
    </Tabs>
  </div>;
}
