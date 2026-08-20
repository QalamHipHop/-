import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function solanaDisabledResponse() {
  return NextResponse.json(
    { error: 'external Solana network is disabled; use the internal Rial network' },
    { status: 410 },
  );
}

function solanaEnabled() {
  return process.env.RIAL_ONLY_MODE === 'false' && process.env.ENABLE_SOLANA_MAINNET === 'true';
}

type MintPlanRequest = {
  owner?: string;
  decimals?: number;
};

/**
 * Builds, but never broadcasts, a zero-supply SPL mint transaction.
 * The mint account's ephemeral Keypair signs only its account-creation
 * instruction; the owner wallet remains the fee payer and final signer.
 */
export async function GET(request: NextRequest) {
  if (!solanaEnabled()) return solanaDisabledResponse();
  const rpcUrl = process.env.SOLANA_MAINNET_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: 'Solana RPC is not configured' }, { status: 503 });
  const mintParam = request.nextUrl.searchParams.get('mint');
  if (!mintParam) return NextResponse.json({ error: 'mint query parameter is required' }, { status: 400 });

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintParam);
  } catch {
    return NextResponse.json({ error: 'mint must be a valid Solana public address' }, { status: 400 });
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  try {
    if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) {
      return NextResponse.json({ error: 'configured RPC is not Solana Mainnet' }, { status: 503 });
    }
    const account = await connection.getAccountInfo(mint, 'confirmed');
    if (!account) return NextResponse.json({ exists: false, mintAddress: mint.toBase58(), network: 'mainnet-beta' }, { status: 404 });
    if (!account.owner.equals(TOKEN_PROGRAM_ID)) {
      return NextResponse.json({ exists: true, validSplMint: false, mintAddress: mint.toBase58(), ownerProgram: account.owner.toBase58() }, { status: 422 });
    }
    const { getMint } = await import('@solana/spl-token');
    const state = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
    return NextResponse.json({
      exists: true,
      validSplMint: true,
      network: 'mainnet-beta',
      mintAddress: mint.toBase58(),
      decimals: state.decimals,
      supplyMinor: state.supply.toString(),
      mintAuthority: state.mintAuthority?.toBase58() ?? null,
      freezeAuthority: state.freezeAuthority?.toBase58() ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'unable to verify Mainnet mint', detail: error instanceof Error ? error.message : 'unknown error' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!solanaEnabled()) return solanaDisabledResponse();
  const rpcUrl = process.env.SOLANA_MAINNET_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: 'Solana RPC is not configured' }, { status: 503 });
  let payload: MintPlanRequest;
  try {
    payload = (await request.json()) as MintPlanRequest;
  } catch {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(payload.owner ?? '');
  } catch {
    return NextResponse.json({ error: 'owner must be a valid Solana public address' }, { status: 400 });
  }

  const decimals = payload.decimals ?? 8;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    return NextResponse.json({ error: 'decimals must be an integer between 0 and 9' }, { status: 400 });
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  try {
    const genesisHash = await connection.getGenesisHash();
    if (genesisHash !== MAINNET_GENESIS_HASH) {
      return NextResponse.json({ error: 'configured RPC is not Solana Mainnet', genesisHash }, { status: 503 });
    }

    const mint = Keypair.generate();
    const associatedTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, owner, false, TOKEN_PROGRAM_ID);
    const rentLamports = await getMinimumBalanceForRentExemptMint(connection);
    const latest = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction({
      feePayer: owner,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(
      SystemProgram.createAccount({
        fromPubkey: owner,
        newAccountPubkey: mint.publicKey,
        lamports: rentLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint.publicKey, decimals, owner, null, TOKEN_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(owner, associatedTokenAccount, owner, mint.publicKey, TOKEN_PROGRAM_ID),
    );

    // The only non-owner signature is the new mint account. Its secret is never
    // returned; Phantom/injected wallet adds the payer signature and broadcasts.
    transaction.partialSign(mint);
    const feeLamports = (await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')).value ?? null;

    return NextResponse.json({
      network: 'mainnet-beta',
      owner: owner.toBase58(),
      mintAddress: mint.publicKey.toBase58(),
      associatedTokenAccount: associatedTokenAccount.toBase58(),
      decimals,
      initialSupplyMinor: '0',
      mintAuthority: owner.toBase58(),
      freezeAuthority: null,
      metadata: 'not-included',
      transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      cost: {
        mintRentLamports: String(rentLamports),
        estimatedNetworkFeeLamports: feeLamports === null ? null : String(feeLamports),
        note: 'The owner wallet funds mint rent, associated-token-account rent, and network fees. No transfer to a platform wallet is included.',
      },
      instructions: ['create rent-exempt SPL mint', 'initialize zero-supply mint', 'create owner associated token account'],
      broadcast: false,
    });
  } catch (error) {
    return NextResponse.json({ error: 'unable to construct Mainnet mint plan', detail: error instanceof Error ? error.message : 'unknown error' }, { status: 502 });
  }
}
