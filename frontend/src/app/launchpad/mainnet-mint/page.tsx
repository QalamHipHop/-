'use client';

import { useMemo, useState } from 'react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const DEFAULT_OWNER = '23QPN8TtY3p79gVRjqWghuFRb5XGpvMS3Dp8nVHuZAGG';

type MintPlan = {
  network: string;
  owner: string;
  mintAddress: string;
  associatedTokenAccount: string;
  decimals: number;
  initialSupplyMinor: string;
  mintAuthority: string;
  freezeAuthority: string | null;
  metadata: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cost: { mintRentLamports: string; estimatedNetworkFeeLamports: string | null; note: string };
  instructions: string[];
};

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
};

declare global { interface Window { solana?: PhantomProvider } }

function fromBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export default function MainnetMintPage() {
  const [owner, setOwner] = useState(DEFAULT_OWNER);
  const [plan, setPlan] = useState<MintPlan | null>(null);
  const [status, setStatus] = useState<string>('No transaction has been created or broadcast.');
  const [busy, setBusy] = useState(false);
  const costSol = useMemo(() => plan ? (Number(plan.cost.mintRentLamports) + Number(plan.cost.estimatedNetworkFeeLamports ?? 0)) / 1_000_000_000 : null, [plan]);

  async function buildPlan() {
    setBusy(true); setStatus('Building a zero-supply Mainnet transaction plan…'); setPlan(null);
    try {
      const response = await fetch('/api/solana/mint-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, decimals: 8 }) });
      const data = await response.json() as MintPlan & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? 'Unable to build transaction plan');
      setPlan(data); setStatus('Review every field below. The plan is not broadcast and expires with its blockhash.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to build transaction plan'); }
    finally { setBusy(false); }
  }

  async function signWithPhantom() {
    if (!plan) return;
    const provider = window.solana;
    if (!provider?.isPhantom) { setStatus('Phantom injected wallet was not detected. Open this page in Phantom-enabled browser context.'); return; }
    setBusy(true);
    try {
      const connected = await provider.connect();
      if (connected.publicKey.toBase58() !== plan.owner) throw new Error('Connected Phantom address does not match the owner shown in the plan.');
      const transaction = Transaction.from(fromBase64(plan.transactionBase64));
      const result = await provider.signAndSendTransaction(transaction);
      setStatus(`Transaction submitted by Phantom. Signature: ${result.signature}. Verifying Mainnet state…`);
      const verification = await fetch(`/api/solana/mint-plan?mint=${encodeURIComponent(plan.mintAddress)}`);
      const verified = await verification.json() as { exists?: boolean; validSplMint?: boolean; supplyMinor?: string; error?: string };
      if (verification.ok && verified.exists && verified.validSplMint) {
        setStatus(`Mainnet mint verified. Supply minor units: ${verified.supplyMinor}. Record the signature and mint address before enabling any issuance.`);
      } else {
        setStatus(`Phantom returned a signature, but the mint is not yet confirmed by the verifier: ${verified.error ?? 'retry verification after confirmation'}`);
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Phantom signing did not complete'); }
    finally { setBusy(false); }
  }

  return (
    <div className="container max-w-3xl py-10 space-y-5">
      <div><h1 className="text-3xl font-bold">Mainnet Mint Signing Ceremony</h1><p className="mt-2 text-muted-foreground">This page builds a zero-supply SPL mint plan. Your private key and seed phrase never leave Phantom.</p></div>
      <Card><CardContent className="p-5 space-y-4"><label className="text-sm font-medium">Owner public address</label><Input value={owner} onChange={(event) => setOwner(event.target.value.trim())} spellCheck={false} /><div className="flex gap-3"><Button onClick={buildPlan} disabled={busy}>Build unsigned plan</Button>{plan && <Button variant="destructive" onClick={signWithPhantom} disabled={busy}>Review in Phantom and sign</Button>}</div><p className="text-sm text-muted-foreground">{status}</p></CardContent></Card>
      {plan && <Card><CardContent className="p-5 space-y-4"><h2 className="font-semibold">Exact plan to approve</h2><div className="grid gap-3 text-sm md:grid-cols-2"><Fact label="Network" value={plan.network} /><Fact label="Mint address" value={plan.mintAddress} mono /><Fact label="Owner / mint authority" value={plan.mintAuthority} mono /><Fact label="Freeze authority" value={plan.freezeAuthority ?? 'disabled'} /><Fact label="Initial supply" value={plan.initialSupplyMinor} /><Fact label="Metadata" value={plan.metadata} /><Fact label="Estimated minimum cost" value={costSol === null ? 'unavailable' : `${costSol.toFixed(9)} SOL`} /><Fact label="Blockhash expiry height" value={String(plan.lastValidBlockHeight)} /></div><div className="rounded-md border p-3 text-sm"><p className="font-medium">Instructions</p><ol className="mt-2 list-decimal pl-5 text-muted-foreground">{plan.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></div><p className="text-xs text-muted-foreground">{plan.cost.note} A signature is a real Mainnet action; do not continue unless all values match the approved specification.</p></CardContent></Card>}
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><div className="text-xs text-muted-foreground">{label}</div><div className={`break-all font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value}</div></div>; }
