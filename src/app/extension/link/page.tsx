'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { CheckCircle2, Link2, LogIn } from 'lucide-react';

import { Logo } from '@/components/icons/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FirebaseClientProvider, useFirebase } from '@/firebase';

function LinkContent() {
  const { user, isUserLoading } = useFirebase();
  const searchParams = useSearchParams();
  const deviceCode = searchParams.get('code') || '';
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');

  const approve = async () => {
    if (!user || !deviceCode) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/extension/device/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ deviceCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not link the extension.');
      setApproved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not link the extension.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10">
    <Card className="w-full">
      <CardHeader className="items-center text-center"><Logo variant="wordmark" className="h-16 w-52" /><CardTitle>Connect Browser Extension</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-center">
        {!deviceCode && <p className="text-sm text-destructive">This link is incomplete. Start again from the Clarift extension settings.</p>}
        {deviceCode && approved && <div className="space-y-3"><CheckCircle2 className="mx-auto h-10 w-10 text-green-600" /><p className="font-medium">Extension connected</p><p className="text-sm text-muted-foreground">Return to the extension settings. You can close this tab.</p></div>}
        {deviceCode && !approved && !isUserLoading && !user && <div className="space-y-3"><p className="text-sm text-muted-foreground">Sign in to Clarift in this browser, then reopen the connection link from the extension.</p><Button asChild><Link href="/"><LogIn className="h-4 w-4" />Open Clarift Sign In</Link></Button></div>}
        {deviceCode && !approved && user && <div className="space-y-3"><p className="text-sm text-muted-foreground">Connect this extension installation to <strong>{user.email}</strong>. It will use your Clarift managed credits and will not receive any provider key.</p><Button onClick={approve} disabled={busy}><Link2 className="h-4 w-4" />{busy ? 'Connecting...' : 'Connect Extension'}</Button></div>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  </main>;
}

export default function ExtensionLinkPage() {
  return <FirebaseClientProvider><Suspense fallback={<main className="flex min-h-screen items-center justify-center">Loading...</main>}><LinkContent /></Suspense></FirebaseClientProvider>;
}
