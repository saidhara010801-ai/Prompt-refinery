'use client';

import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

type Provider = 'gemini' | 'openrouter';
interface KeyStatus { provider: Provider; configured: boolean; keyHint: string; lastValidatedAt: string | null }

export function ProviderKeysPanel({ enabled }: { enabled: boolean }) {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [provider, setProvider] = useState<Provider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [useByok, setUseByok] = useState(false);
  const [busy, setBusy] = useState(false);

  const api = async (init?: RequestInit) => {
    if (!user) throw new Error('Sign in to manage provider keys.');
    const response = await fetch('/api/provider-keys', {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers || {}) },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Provider-key request failed.');
    return payload;
  };

  const load = async () => {
    if (!user || !enabled) return setKeys([]);
    const payload = await api();
    setKeys(payload.keys || []);
  };

  useEffect(() => {
    setUseByok(localStorage.getItem('clariftInferenceMode') === 'byok');
    const storedProvider = localStorage.getItem('clariftByokProvider');
    if (storedProvider === 'openrouter' || storedProvider === 'gemini') setProvider(storedProvider);
    load().catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user]);

  const savePreference = (enabled: boolean, selectedProvider = provider) => {
    setUseByok(enabled);
    localStorage.setItem('clariftInferenceMode', enabled ? 'byok' : 'managed');
    localStorage.setItem('clariftByokProvider', selectedProvider);
    window.dispatchEvent(new Event('clarift-provider-preference'));
  };

  const save = async () => {
    setBusy(true);
    try {
      await api({ method: 'POST', body: JSON.stringify({ provider, apiKey }) });
      setApiKey('');
      await load();
      toast({ title: 'Provider Key Secured', description: 'Clarift validated and encrypted the key on the server.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Save Provider Key', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (target: Provider) => {
    setBusy(true);
    try {
      await api({ method: 'DELETE', body: JSON.stringify({ provider: target }) });
      if (provider === target) savePreference(false);
      await load();
      toast({ title: 'Provider Key Revoked' });
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-5">
    <div className="flex items-center gap-2">
      <ShieldCheck className="h-4 w-4 text-primary" />
      <div><h3 className="font-medium">Advanced Provider Access</h3><p className="text-sm text-muted-foreground">Managed inference is the default. Personal provider keys are encrypted and never shown again.</p></div>
    </div>
    {!enabled && <div className="rounded-md border p-3 text-sm text-muted-foreground">Encrypted BYOK is staged but disabled in this environment until its Secret Manager key and rotation procedure are verified.</div>}
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div><Label htmlFor="use-byok">Use my provider key</Label><p className="text-xs text-muted-foreground">BYOK tasks do not consume managed credits.</p></div>
      <Switch id="use-byok" checked={enabled && useByok} onCheckedChange={(value) => savePreference(value)} disabled={!enabled} />
    </div>
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
      <div className="space-y-2"><Label>Provider</Label><Select value={provider} onValueChange={(value: Provider) => { setProvider(value); savePreference(useByok, value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gemini">Gemini</SelectItem><SelectItem value="openrouter">OpenRouter</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="provider-key">New provider key</Label><Input id="provider-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder="Validated once, then encrypted" /></div>
      <Button type="button" onClick={save} disabled={!enabled || busy || apiKey.trim().length < 8}><KeyRound className="h-4 w-4" />Save Key</Button>
    </div>
    <div className="space-y-2">{keys.map((key) => <div key={key.provider} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><div className="flex items-center gap-2"><span className="font-medium capitalize">{key.provider}</span><Badge variant="outline">{key.keyHint}</Badge></div><p className="text-xs text-muted-foreground">Validated {key.lastValidatedAt ? new Date(key.lastValidatedAt).toLocaleDateString() : 'recently'}</p></div><Button type="button" size="icon" variant="ghost" onClick={() => revoke(key.provider)} disabled={busy}><Trash2 className="h-4 w-4 text-destructive" /><span className="sr-only">Revoke {key.provider} key</span></Button></div>)}</div>
  </div>;
}
