'use client';

import { useEffect, useState } from 'react';
import { Share2, Trash2, UserPlus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface ShareRecord { id: string; recipientEmail: string; permission: 'viewer' | 'editor' }

export function ShareDialog({ resourceType, resourceId, resourceName }: { resourceType: 'project' | 'savedPrompt'; resourceId: string; resourceName: string }) {
  const { user } = useFirebase();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'viewer' | 'editor'>('viewer');
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const request = async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Sign in to share content.');
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Sharing request failed.');
    return payload;
  };

  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    request(`/api/shares?resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`)
      .then((payload) => active && setShares(payload.shares))
      .catch((error) => active && toast({ variant: 'destructive', title: 'Could Not Load Sharing', description: error.message }));
    return () => { active = false; };
  // request is intentionally scoped to the current dialog open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceId, resourceType, user]);

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const payload = await request('/api/shares', { method: 'POST', body: JSON.stringify({ resourceType, resourceId, recipientEmail: email, permission }) });
      setShares((current) => [...current.filter((share) => share.id !== payload.share.id), payload.share]);
      setEmail('');
      toast({ title: 'Access Shared', description: `${resourceName} is now available to ${payload.share.recipientEmail}.` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Share', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally { setBusy(false); }
  };

  const revoke = async (shareId: string) => {
    setBusy(true);
    try {
      await request('/api/shares', { method: 'DELETE', body: JSON.stringify({ shareId }) });
      setShares((current) => current.filter((share) => share.id !== shareId));
      toast({ title: 'Access Removed' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Remove Access', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Share2 className="h-4 w-4" />Share</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>Share {resourceName}</DialogTitle><DialogDescription>Invite an existing Clarift account as a viewer or content editor.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_130px_auto] sm:items-end">
          <div className="space-y-2"><Label htmlFor={`share-email-${resourceId}`}>Email</Label><Input id={`share-email-${resourceId}`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="collaborator@example.com" /></div>
          <div className="space-y-2"><Label>Access</Label><Select value={permission} onValueChange={(value: 'viewer' | 'editor') => setPermission(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="viewer">Viewer</SelectItem><SelectItem value="editor">Editor</SelectItem></SelectContent></Select></div>
          <Button type="button" size="icon" onClick={invite} disabled={busy || !email.trim()}><UserPlus className="h-4 w-4" /><span className="sr-only">Share access</span></Button>
        </div>
        <div className="space-y-2">
          {shares.map((share) => <div key={share.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{share.recipientEmail}</p><Badge variant="outline" className="mt-1 capitalize">{share.permission}</Badge></div><Button type="button" variant="ghost" size="icon" onClick={() => revoke(share.id)} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Remove access</span></Button></div>)}
          {shares.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No collaborators yet.</p>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
