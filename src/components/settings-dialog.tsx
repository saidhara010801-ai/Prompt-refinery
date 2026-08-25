'use client';

import { type ReactNode, useContext, useEffect, useState } from 'react';
import { Database, KeyRound, Settings, ShieldCheck, Type, UserRound, WalletCards } from 'lucide-react';

import { AdminPanel } from '@/components/admin-dialog';
import { ApiKeysPanel } from '@/components/api-keys-panel';
import { BillingPanel } from '@/components/billing-panel';
import { BrowserExtensionPanel } from '@/components/browser-extension-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsContext } from '@/context/settings-context';
import { SubscriptionContext } from '@/context/subscription-context';
import { useFirebase } from '@/firebase';
import { cn } from '@/lib/utils';

export function SettingsDialog({ trigger }: { trigger?: ReactNode }) {
  const { animate, setAnimate, fontScale, setFontScale, highContrast, setHighContrast } = useContext(SettingsContext);
  const { tenantId, workspaceId, capabilities } = useContext(SubscriptionContext);
  const { user } = useFirebase();
  const [open, setOpen] = useState(false);
  const [accountRole, setAccountRole] = useState<string>('user');

  useEffect(() => {
    if (!user) { setAccountRole('user'); return; }
    user.getIdToken()
      .then((token) => fetch('/api/account/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }))
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Account lookup failed.')))
      .then((account) => setAccountRole(account.role ?? 'user'))
      .catch(() => setAccountRole('user'));
  }, [user]);

  const isOwner = accountRole === 'owner';

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setAnimate(false);
  };

  return <Dialog open={open} onOpenChange={handleOpenChange}>
    <DialogTrigger asChild>
      {trigger ?? (
        <Button variant="outline" size="icon" className={cn(animate && 'animate-pulse ring-2 ring-destructive ring-offset-2')}>
          <Settings className="h-4 w-4" /><span className="sr-only">Settings</span>
        </Button>
      )}
    </DialogTrigger>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your account, personal workspace, credits, security, integrations, and data preferences.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="account" className="mt-2">
        <TabsList className={`grid h-auto grid-cols-3 gap-1 ${isOwner ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <TabsTrigger value="account" aria-label="Account"><UserRound className="h-4 w-4" /><span className="hidden lg:inline">Account</span></TabsTrigger>
          <TabsTrigger value="billing" aria-label="Plan and credits"><WalletCards className="h-4 w-4" /><span className="hidden lg:inline">Plan</span></TabsTrigger>
          <TabsTrigger value="developer" aria-label="Developer API"><KeyRound className="h-4 w-4" /><span className="hidden lg:inline">Developer</span></TabsTrigger>
          <TabsTrigger value="data" aria-label="Data and accessibility"><Database className="h-4 w-4" /><span className="hidden lg:inline">Data</span></TabsTrigger>
          <TabsTrigger value="extension" aria-label="Browser extension"><Settings className="h-4 w-4" /><span className="hidden lg:inline">Extension</span></TabsTrigger>
          {isOwner && <TabsTrigger value="admin" aria-label="Administration"><ShieldCheck className="h-4 w-4" /><span className="hidden lg:inline">Admin</span></TabsTrigger>}
        </TabsList>
        <TabsContent value="account" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Signed in as</p><p className="truncate font-medium">{user?.email || 'Not signed in'}</p></div>
            <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Access</p><p className="font-medium capitalize">{accountRole}</p></div>
          </div>
          <div className="rounded-md border p-3 text-xs text-muted-foreground"><p>Tenant: {tenantId || 'Initializing'}</p><p>Workspace: {workspaceId || 'Initializing'}</p></div>
        </TabsContent>
        <TabsContent value="billing" className="pt-4"><BillingPanel /></TabsContent>
        <TabsContent value="developer" className="pt-4"><ApiKeysPanel enabled={capabilities.developerApi} /></TabsContent>
        <TabsContent value="data" className="space-y-4 pt-4">
          <div className="flex items-center gap-2"><Type className="h-4 w-4 text-primary" /><h3 className="font-medium">Accessibility</h3></div>
          <div className="grid gap-4 sm:grid-cols-4 sm:items-center">
            <Label htmlFor="fontScale" className="sm:text-right">Text size</Label>
            <select id="fontScale" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value) as 90 | 100 | 112.5 | 125)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-3"><option value={90}>Compact</option><option value={100}>Default</option><option value={112.5}>Large</option><option value={125}>Extra large</option></select>
            <Label htmlFor="highContrast" className="sm:text-right">High contrast</Label>
            <div className="flex items-center gap-3 sm:col-span-3"><Switch id="highContrast" checked={highContrast} onCheckedChange={setHighContrast} /><span className="text-sm text-muted-foreground">Strengthen foreground and control contrast.</span></div>
          </div>
          <div className="rounded-md border p-3 text-sm text-muted-foreground">Tenant content remains private to the active personal workspace. Billing, usage, credentials, and security records are server-managed and unavailable to browser clients.</div>
        </TabsContent>
        <TabsContent value="extension" className="pt-4"><BrowserExtensionPanel enabled={Boolean(user) && capabilities.extension} /></TabsContent>
        {isOwner && <TabsContent value="admin" className="pt-4"><AdminPanel /></TabsContent>}
      </Tabs>
    </DialogContent>
  </Dialog>;
}
