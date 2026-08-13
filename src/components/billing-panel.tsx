'use client';

import { useEffect, useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SubscriptionContext } from '@/context/subscription-context';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { useContext } from 'react';

interface Product {
  code: string;
  kind: 'credit_pack' | 'subscription';
  displayName: string;
  currency: 'INR';
  amountSubunits?: number;
  credits?: number;
  creditsPerCycle?: number;
  interval?: 'monthly';
}

declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }
}

async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
    document.head.appendChild(script);
  });
}

export function BillingPanel() {
  const { user } = useFirebase();
  const { toast } = useToast();
  const { planLabel, availableCredits, reservedCredits, refreshTenant } = useContext(SubscriptionContext);
  const [products, setProducts] = useState<Product[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/razorpay/catalog').then((response) => response.json()).then((payload) => {
      setEnabled(Boolean(payload.enabled));
      setProducts(payload.products || []);
    }).catch(() => undefined);
  }, []);

  const token = async () => {
    if (!user) throw new Error('Sign in before starting checkout.');
    return user.getIdToken();
  };

  const start = async (product: Product) => {
    setBusy(product.code);
    try {
      await loadRazorpay();
      const response = await fetch('/api/razorpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ productCode: product.code, kind: product.kind }),
      });
      const checkout = await response.json();
      if (!response.ok) throw new Error(checkout.error?.message || 'Checkout unavailable.');
      const options: Record<string, unknown> = {
        key: checkout.keyId,
        name: 'Clarift',
        description: checkout.displayName,
        prefill: { email: user?.email || undefined, name: user?.displayName || undefined },
        theme: { color: '#ff7200' },
      };
      if (product.kind === 'credit_pack') {
        options.order_id = checkout.razorpayOrderId;
        options.amount = checkout.amount;
        options.currency = checkout.currency;
        options.handler = async (result: Record<string, string>) => {
          const verify = await fetch('/api/razorpay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
            body: JSON.stringify({
              localOrderId: checkout.localOrderId,
              razorpayOrderId: result.razorpay_order_id,
              razorpayPaymentId: result.razorpay_payment_id,
              signature: result.razorpay_signature,
            }),
          });
          if (!verify.ok) throw new Error('Payment verification failed.');
          toast({ title: 'Payment Verified', description: 'Credits will appear after Razorpay confirms the payment.' });
          await refreshTenant();
        };
      } else {
        options.subscription_id = checkout.razorpaySubscriptionId;
        options.handler = () => toast({ title: 'Subscription Authorized', description: 'Your plan updates after Razorpay confirms the charge.' });
      }
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error('Razorpay Checkout did not load.');
      new Razorpay(options).open();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Checkout Unavailable', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Plan</p><p className="font-semibold">{planLabel}</p></div>
      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Available credits</p><p className="font-semibold">{availableCredits}</p></div>
      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Reserved</p><p className="font-semibold">{reservedCredits}</p></div>
    </div>
    {!enabled && <div className="rounded-md border p-4 text-sm text-muted-foreground">Razorpay billing is in pre-release configuration. Trial and administrator-granted credits remain available.</div>}
    {enabled && <div className="space-y-2">{products.map((product) => <div key={product.code} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /><span className="font-medium">{product.displayName}</span><Badge variant="outline">{product.kind === 'subscription' ? 'Monthly' : `${product.credits} credits`}</Badge></div><p className="text-xs text-muted-foreground">{product.kind === 'credit_pack' ? `₹${(product.amountSubunits || 0) / 100}` : `${product.creditsPerCycle} credits each successful cycle`}</p></div><Button type="button" onClick={() => start(product)} disabled={busy !== null}>{busy === product.code ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}{product.kind === 'credit_pack' ? 'Buy' : 'Subscribe'}</Button></div>)}</div>}
  </div>;
}
