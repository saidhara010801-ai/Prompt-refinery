'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface ApiKeyRecord { id: string; name: string; prefix: string; active: boolean; createdAt: string | null; lastUsedAt: string | null }

export function ApiKeysPanel({ enabled }: { enabled: boolean }) {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState('Browser extension');
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
      const payload = await api({ method: 'POST', body: JSON.stringify({ name }) });
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
    <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h3 className="font-medium">Public API</h3><Badge variant="outline">Pro</Badge></div>
    {!enabled ? <p className="text-sm text-muted-foreground">Upgrade to Pro to create API keys for integrations and the browser extension.</p> : <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1 space-y-2"><Label htmlFor="api-key-name">Key name</Label><Input id="api-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div><Button type="button" onClick={create} disabled={busy || !name.trim()}><Plus className="h-4 w-4" />Create Key</Button></div>
      {newKey && <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 p-3"><code className="min-w-0 flex-1 break-all text-xs">{newKey}</code><Button type="button" variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(newKey)}><Copy className="h-4 w-4" /><span className="sr-only">Copy API key</span></Button></div>}
      <div className="space-y-2">{keys.filter((key) => key.active).map((key) => <div key={key.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{key.name}</p><code className="text-xs text-muted-foreground">{key.prefix}...</code></div><Button type="button" variant="ghost" size="icon" onClick={() => revoke(key.id)} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Revoke API key</span></Button></div>)}</div>
      <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-block text-sm text-primary underline underline-offset-4">OpenAPI specification</a>
    </div>}
  </div>;
}
