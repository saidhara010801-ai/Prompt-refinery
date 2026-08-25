'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

const TOKEN_SCOPES = ['refinements:write', 'evaluations:write', 'conversions:write', 'projects:read', 'projects:write', 'memory:read', 'memory:write', 'usage:read'] as const;
type TokenScope = typeof TOKEN_SCOPES[number];
interface ApiKeyRecord { id: string; name: string; prefix: string; scopes: TokenScope[]; active: boolean; createdAt: string | null; expiresAt: string | null; lastUsedAt: string | null }

export function ApiKeysPanel({ enabled }: { enabled: boolean }) {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState('Developer integration');
  const [scopes, setScopes] = useState<TokenScope[]>(['refinements:write']);
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);

  const api = async (init?: RequestInit) => {
    if (!user) throw new Error('Sign in to manage API keys.');
    const response = await fetch('/api/api-keys', { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'API key request failed.');
    return payload;
  };

  const load = () => enabled && user ? api().then((payload) => setKeys(payload.keys)).catch(() => undefined) : undefined;
  useEffect(() => { load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user]);

  const create = async () => {
    setBusy(true);
    try {
      const payload = await api({ method: 'POST', body: JSON.stringify({ name, scopes, expiresInDays: Number(expiresInDays) || null }) });
      setNewKey(payload.key);
      await load();
      toast({ title: 'API Key Created', description: 'Store it now; Clarift will not show the full key again.' });
    } catch (error) { toast({ variant: 'destructive', title: 'Could Not Create API Key', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  const revoke = async (keyId: string) => {
    setBusy(true);
    try { await api({ method: 'DELETE', body: JSON.stringify({ keyId }) }); await load(); toast({ title: 'API Key Revoked' }); }
    catch (error) { toast({ variant: 'destructive', title: 'Could Not Revoke API Key', description: error instanceof Error ? error.message : 'Please try again.' }); }
    finally { setBusy(false); }
  };

  return <div className="border-t pt-4">
    <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="font-medium">Clarift API Tokens</h3><Badge variant="outline">Developer</Badge></div>
    {!enabled ? <p className="text-sm text-muted-foreground">Developer API tokens are unavailable until both the Developer entitlement and the public API release gate are active.</p> : <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="api-key-name">Token name</Label><Input id="api-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div><div className="space-y-2"><Label htmlFor="api-key-expiry">Expires</Label><select id="api-key-expiry" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div><Button type="button" onClick={create} disabled={busy || !name.trim() || !scopes.length}><Plus className="h-4 w-4" />Create</Button></div>
      <div className="grid gap-2 sm:grid-cols-2">{TOKEN_SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 rounded-md border p-2 text-xs"><Checkbox checked={scopes.includes(scope)} onCheckedChange={(checked) => setScopes((current) => checked ? Array.from(new Set([...current, scope])) : current.filter((value) => value !== scope))} /><code>{scope}</code></label>)}</div>
      {newKey && <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-3"><code className="min-w-0 flex-1 break-all text-xs">{newKey}</code><Button type="button" variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(newKey)}><Copy className="h-4 w-4" /><span className="sr-only">Copy API key</span></Button></div>}
      <div className="space-y-2">{keys.filter((key) => key.active).map((key) => <div key={key.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0 space-y-1"><p className="truncate text-sm font-medium">{key.name}</p><code className="text-xs text-muted-foreground">{key.prefix}...</code><div className="flex flex-wrap gap-1">{key.scopes.map((scope) => <Badge key={scope} variant="secondary" className="text-[10px]">{scope}</Badge>)}</div><p className="text-[11px] text-muted-foreground">Expires {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'never'}</p></div><Button type="button" variant="ghost" size="icon" onClick={() => revoke(key.id)} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Revoke API token</span></Button></div>)}</div>
      <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-block text-sm text-primary underline underline-offset-4">OpenAPI specification</a>
    </div>}
  </div>;
}
