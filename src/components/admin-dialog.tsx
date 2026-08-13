'use client';

import { useEffect, useState } from 'react';
import { Activity, Copy, ShieldCheck, Ticket, Trash2, UserCheck, UserX } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface PromoCodeRecord { id: string; prefix: string; label: string | null; mode: string; maxRedemptions: number | null; redemptionCount: number; active: boolean; createdAt: string | null }
interface PromoUser { id: string; uid: string; email: string; codeId: string; redeemedAt?: { seconds: number } }
interface InferenceHealth { requests: number; succeeded: number; failed: number; generative: number; fallback: number; malformedAttempts: number; latencyMs: { p50: number | null; p95: number | null }; budgets: Record<string, { settledUsd?: number; reservedUsd?: number } | null>; circuits: Array<{ id: string; state?: string; provider?: string }> }

export function AdminDialog() {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [isOwner, setIsOwner] = useState(false);
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<PromoCodeRecord[]>([]);
  const [promoUsers, setPromoUsers] = useState<PromoUser[]>([]);
  const [mode, setMode] = useState<'single' | 'limited' | 'unlimited'>('single');
  const [limit, setLimit] = useState('10');
  const [label, setLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [betaUid, setBetaUid] = useState('');
  const [inferenceHealth, setInferenceHealth] = useState<InferenceHealth | null>(null);

  const api = async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Sign in to continue.');
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Admin request failed.');
    return payload;
  };

  useEffect(() => {
    if (!user) { setIsOwner(false); return; }
    api('/api/account/me').then((account) => setIsOwner(account.role === 'owner')).catch(() => setIsOwner(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const refresh = async () => {
    if (!isOwner) return;
    try {
      const [codeData, userData, healthData] = await Promise.all([api('/api/admin/promo-codes'), api('/api/admin/promo-users'), api('/api/admin/free-inference')]);
      setCodes(codeData);
      setPromoUsers(userData);
      setInferenceHealth(healthData);
    } catch (error) { toast({ variant: 'destructive', title: 'Could Not Load Admin Data', description: error instanceof Error ? error.message : 'Please try again.' }); }
  };

  useEffect(() => { if (open) refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const createCode = async () => {
    setBusy(true);
    try {
      const result = await api('/api/admin/promo-codes', { method: 'POST', body: JSON.stringify({ mode, label, maxRedemptions: mode === 'limited' ? Number(limit) : null }) });
      setNewCode(result.code);
      setLabel('');
      await refresh();
    } catch (error) { toast({ variant: 'destructive', title: 'Could Not Create Code', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  const invalidate = async (codeId: string) => {
    setBusy(true);
    try { await api(`/api/admin/promo-codes/${codeId}/invalidate`, { method: 'POST' }); await refresh(); toast({ title: 'Promo Code Invalidated' }); }
    catch (error) { toast({ variant: 'destructive', title: 'Could Not Invalidate Code', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  const revokeUser = async (uid: string) => {
    setBusy(true);
    try { await api(`/api/admin/promo-users/${uid}/revoke`, { method: 'POST' }); await refresh(); toast({ title: 'Promo Access Revoked' }); }
    catch (error) { toast({ variant: 'destructive', title: 'Could Not Revoke Access', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  const updateBeta = async (enabled: boolean) => {
    if (!betaUid.trim()) return;
    setBusy(true);
    try {
      await api('/api/admin/free-inference', { method: 'POST', body: JSON.stringify({ uid: betaUid.trim(), enabled }) });
      toast({ title: enabled ? 'Managed Inference Enabled' : 'Managed Inference Disabled' });
      setBetaUid('');
      await refresh();
    } catch (error) { toast({ variant: 'destructive', title: 'Could Not Update Beta Access', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  if (!isOwner) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="icon"><ShieldCheck className="h-4 w-4" /><span className="sr-only">Promo administration</span></Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Clarift Administration</DialogTitle><DialogDescription>Manage controlled access and monitor release health.</DialogDescription></DialogHeader>
      <Tabs defaultValue="codes">
        <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="codes">Codes</TabsTrigger><TabsTrigger value="users">Promo Users</TabsTrigger><TabsTrigger value="inference">Inference</TabsTrigger></TabsList>
        <TabsContent value="codes" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_150px_100px_auto] sm:items-end">
            <div className="space-y-2"><Label htmlFor="promo-label">Label</Label><Input id="promo-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Alpha cohort" /></div>
            <div className="space-y-2"><Label>Mode</Label><Select value={mode} onValueChange={(value: typeof mode) => setMode(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single use</SelectItem><SelectItem value="limited">Limited</SelectItem><SelectItem value="unlimited">Unlimited</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="promo-limit">Uses</Label><Input id="promo-limit" type="number" min={2} max={10000} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={mode !== 'limited'} /></div>
            <Button type="button" size="icon" onClick={createCode} disabled={busy}><Ticket className="h-4 w-4" /><span className="sr-only">Create promo code</span></Button>
          </div>
          {newCode && <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-3"><code className="min-w-0 flex-1 break-all text-sm">{newCode}</code><Button type="button" variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(newCode)}><Copy className="h-4 w-4" /><span className="sr-only">Copy new code</span></Button></div>}
          <div className="space-y-2">{codes.map((code) => <div key={code.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{code.label || code.prefix}</p><p className="text-xs text-muted-foreground">{code.mode} · {code.redemptionCount}/{code.maxRedemptions ?? 'unlimited'} used</p></div><div className="flex items-center gap-2"><Badge variant={code.active ? 'default' : 'secondary'}>{code.active ? 'Active' : 'Inactive'}</Badge>{code.active && <Button type="button" variant="ghost" size="icon" onClick={() => invalidate(code.id)} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Invalidate code</span></Button>}</div></div>)}</div>
        </TabsContent>
        <TabsContent value="users" className="space-y-2 pt-4">
          {promoUsers.map((promoUser) => <div key={promoUser.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate font-medium">{promoUser.email}</p><p className="truncate text-xs text-muted-foreground">{promoUser.uid}</p></div><Button type="button" variant="outline" size="icon" onClick={() => revokeUser(promoUser.uid)} disabled={busy}><UserX className="h-4 w-4" /><span className="sr-only">Revoke promo access</span></Button></div>)}
          {promoUsers.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No active promo users.</p>}
        </TabsContent>
        <TabsContent value="inference" className="space-y-4 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={betaUid} onChange={(event) => setBetaUid(event.target.value)} placeholder="Firebase user UID" aria-label="Beta tester user ID" />
            <Button type="button" onClick={() => updateBeta(true)} disabled={busy || !betaUid.trim()}><UserCheck className="h-4 w-4" />Enable</Button>
            <Button type="button" variant="outline" onClick={() => updateBeta(false)} disabled={busy || !betaUid.trim()}><UserX className="h-4 w-4" />Disable</Button>
          </div>
          {inferenceHealth && <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Requests', inferenceHealth.requests], ['Generative', inferenceHealth.generative], ['Basic mode', inferenceHealth.fallback], ['Malformed', inferenceHealth.malformedAttempts]].map(([label, value]) => <div key={String(label)} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
            </div>
            <div className="rounded-md border p-3 text-sm"><div className="mb-2 flex items-center gap-2 font-medium"><Activity className="h-4 w-4" />Last 24 hours</div><p>Success: {inferenceHealth.succeeded} · Failed: {inferenceHealth.failed} · p50: {inferenceHealth.latencyMs.p50 ?? 'n/a'} ms · p95: {inferenceHealth.latencyMs.p95 ?? 'n/a'} ms</p><p className="mt-1 text-muted-foreground">Spend: ${Number(inferenceHealth.budgets.overall?.settledUsd ?? 0).toFixed(4)} settled · ${Number(inferenceHealth.budgets.overall?.reservedUsd ?? 0).toFixed(4)} reserved</p></div>
            <div className="space-y-2">{inferenceHealth.circuits.map((circuit) => <div key={circuit.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{circuit.provider || circuit.id}</span><Badge variant={circuit.state === 'open' ? 'destructive' : 'secondary'}>{circuit.state || 'closed'}</Badge></div>)}</div>
          </>}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
