/**
 * Wallet Service for TimberConnect
 *
 * App-interne Token-Währung ("TimberToken"): Nutzer zahlen pro extrahiertem
 * Datenpunkt Token an den Daten-Eigentümer. Das Guthaben liegt im eigenen
 * Solid Pod:
 *
 *   {pod}wallet/wallet.ttl        -> #wallet  tc:tokenBalance "N"
 *   {pod}wallet/transactions.ttl  -> #tx...   tc:amount / tc:counterparty / ...
 *
 * Demo-Vereinfachung: wallet.ttl wird public read+write gestampt, damit
 * andere angemeldete Nutzer Zahlungen direkt gutschreiben können. In einer
 * echten Umsetzung würde das über einen Payment-/Clearing-Dienst laufen.
 */

import {
  getSolidDataset,
  createSolidDataset,
  getThing,
  getThingAll,
  setThing,
  buildThing,
  createThing,
  saveSolidDatasetAt,
  getInteger,
  getUrl,
  getStringNoLocale,
  getDatetime,
  type Access,
} from '@inrupt/solid-client';
import { RDF } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';
import { podBaseFromWebId, stampPublicAccess } from './accessControlService';
import { NAMESPACES } from '../config/solidPods';

export const TOKEN_NAME = 'TimberToken';
export const TOKEN_SYMBOL = 'TBT';

/** Startguthaben, das jeder Nutzer beim ersten Login geschenkt bekommt. */
export const START_BALANCE = 100;

const TC = NAMESPACES.tc;
const TC_WALLET = `${TC}Wallet`;
const TC_TOKEN_BALANCE = `${TC}tokenBalance`;
const TC_TRANSACTION = `${TC}TokenTransaction`;
const TC_AMOUNT = `${TC}tokenAmount`;
const TC_COUNTERPARTY = `${TC}counterparty`;
const TC_REASON = `${TC}transactionReason`;
const TC_TIMESTAMP = `${TC}transactionTime`;
const TC_TX_TYPE = `${TC}transactionType`;

export const WALLET_DOC = (pod: string) => `${pod}wallet/wallet.ttl`;
export const TX_DOC = (pod: string) => `${pod}wallet/transactions.ttl`;
const WALLET_SUBJECT = (pod: string) => `${WALLET_DOC(pod)}#wallet`;

// Demo: public read+write, damit fremde Nutzer Token gutschreiben können.
const WALLET_ACCESS: Access = { read: true, append: true, write: true, control: false };

export type TransactionType = 'purchase' | 'payment-out' | 'payment-in';

export interface WalletTransaction {
  amount: number;
  type: TransactionType;
  counterparty: string | null;
  reason: string | null;
  timestamp: Date | null;
}

export interface PaymentItem {
  recipientWebId: string;
  amount: number;
  reason: string;
}

export interface PaymentResult {
  paidTotal: number;
  newBalance: number;
  warnings: string[];
}

export class WalletError extends Error {}

// ---------------------------------------------------------------------------
// Guthaben lesen / schreiben
// ---------------------------------------------------------------------------

async function readWalletBalance(pod: string): Promise<number | null> {
  try {
    const ds = await getSolidDataset(WALLET_DOC(pod), { fetch: getAuthFetch() });
    const thing = getThing(ds, WALLET_SUBJECT(pod));
    if (!thing) return null;
    return getInteger(thing, TC_TOKEN_BALANCE);
  } catch {
    // 404 -> Wallet existiert noch nicht
    return null;
  }
}

async function writeWalletBalance(pod: string, balance: number): Promise<void> {
  let ds;
  try {
    ds = await getSolidDataset(WALLET_DOC(pod), { fetch: getAuthFetch() });
  } catch {
    ds = createSolidDataset();
  }
  const thing = buildThing(createThing({ url: WALLET_SUBJECT(pod) }))
    .addUrl(RDF.type, TC_WALLET)
    .addInteger(TC_TOKEN_BALANCE, Math.max(0, Math.round(balance)))
    .build();
  ds = setThing(ds, thing);
  await saveSolidDatasetAt(WALLET_DOC(pod), ds, { fetch: getAuthFetch() });
}

/** Guthaben eines Nutzers lesen (null = Wallet existiert noch nicht). */
export async function getBalance(webId: string): Promise<number | null> {
  return readWalletBalance(podBaseFromWebId(webId));
}

/**
 * Wallet des eingeloggten Nutzers sicherstellen: existiert noch keins, wird
 * es mit dem Startguthaben angelegt und die Demo-ACL gestampt.
 * Gibt das aktuelle Guthaben zurück.
 */
export async function ensureWallet(webId: string): Promise<number> {
  const pod = podBaseFromWebId(webId);
  const existing = await readWalletBalance(pod);
  if (existing !== null) return existing;

  await writeWalletBalance(pod, START_BALANCE);
  await stampPublicAccess(WALLET_DOC(pod), WALLET_ACCESS);
  return START_BALANCE;
}

// ---------------------------------------------------------------------------
// Transaktionslog (nur im eigenen Pod, best effort)
// ---------------------------------------------------------------------------

async function appendTransaction(
  pod: string,
  tx: { amount: number; type: TransactionType; counterparty?: string; reason?: string },
): Promise<void> {
  try {
    let ds;
    try {
      ds = await getSolidDataset(TX_DOC(pod), { fetch: getAuthFetch() });
    } catch {
      ds = createSolidDataset();
    }
    const subject = `${TX_DOC(pod)}#tx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const built = buildThing(createThing({ url: subject }))
      .addUrl(RDF.type, TC_TRANSACTION)
      .addInteger(TC_AMOUNT, Math.round(tx.amount))
      .addStringNoLocale(TC_TX_TYPE, tx.type)
      .addDatetime(TC_TIMESTAMP, new Date());
    if (tx.counterparty) built.addUrl(TC_COUNTERPARTY, tx.counterparty);
    if (tx.reason) built.addStringNoLocale(TC_REASON, tx.reason);
    ds = setThing(ds, built.build());
    await saveSolidDatasetAt(TX_DOC(pod), ds, { fetch: getAuthFetch() });
  } catch (e) {
    console.warn('[wallet] Transaktionslog konnte nicht geschrieben werden:', e);
  }
}

/** Letzte Transaktionen des Nutzers (neueste zuerst). */
export async function getTransactions(webId: string, limit = 10): Promise<WalletTransaction[]> {
  const pod = podBaseFromWebId(webId);
  try {
    const ds = await getSolidDataset(TX_DOC(pod), { fetch: getAuthFetch() });
    const txs = getThingAll(ds)
      .filter((t) => getUrl(t, RDF.type) === TC_TRANSACTION)
      .map((t) => ({
        amount: getInteger(t, TC_AMOUNT) ?? 0,
        type: (getStringNoLocale(t, TC_TX_TYPE) ?? 'payment-out') as TransactionType,
        counterparty: getUrl(t, TC_COUNTERPARTY),
        reason: getStringNoLocale(t, TC_REASON),
        timestamp: getDatetime(t, TC_TIMESTAMP),
      }))
      .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));
    return txs.slice(0, limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Kauf & Transfer
// ---------------------------------------------------------------------------

/**
 * Token "kaufen" (Demo: keine echte Zahlung) — schreibt das neue Guthaben in
 * den eigenen Pod und protokolliert die Transaktion.
 */
export async function buyTokens(webId: string, amount: number): Promise<number> {
  if (amount <= 0) throw new WalletError('Ungültiger Betrag');
  const pod = podBaseFromWebId(webId);
  const balance = (await readWalletBalance(pod)) ?? (await ensureWallet(webId));
  const newBalance = balance + amount;
  await writeWalletBalance(pod, newBalance);
  await appendTransaction(pod, { amount, type: 'purchase', reason: 'Token-Kauf' });
  return newBalance;
}

/** Fremdes Wallet gutschreiben (setzt die Demo-ACL public write voraus). */
async function creditRecipient(recipientWebId: string, amount: number, reason: string): Promise<void> {
  const pod = podBaseFromWebId(recipientWebId);
  const balance = await readWalletBalance(pod);
  if (balance === null) {
    // Wallet des Empfängers existiert noch nicht (nie eingeloggt) — Anlage in
    // fremdem Pod scheitert i.d.R. an WAC, daher versuchen und sauber melden.
    await writeWalletBalance(pod, amount);
  } else {
    await writeWalletBalance(pod, balance + amount);
  }
  await appendTransaction(pod, {
    amount,
    type: 'payment-in',
    reason,
  });
}

/**
 * Token-Transfer für einen Datenabruf: bucht die Gesamtsumme vom eigenen
 * Wallet ab und schreibt jedem Daten-Eigentümer seinen Anteil gut.
 *
 * Wirft WalletError, wenn das Guthaben nicht reicht (dann wird nichts gebucht).
 * Fehlgeschlagene Gutschriften einzelner Empfänger werden als Warnung
 * zurückgegeben (Demo: kein Rollback).
 */
export async function payForData(webId: string, payments: PaymentItem[]): Promise<PaymentResult> {
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  if (total <= 0) {
    const balance = (await getBalance(webId)) ?? 0;
    return { paidTotal: 0, newBalance: balance, warnings: [] };
  }

  const pod = podBaseFromWebId(webId);
  const balance = (await readWalletBalance(pod)) ?? (await ensureWallet(webId));
  if (balance < total) {
    throw new WalletError(
      `Guthaben reicht nicht: ${total} ${TOKEN_SYMBOL} benötigt, ${balance} ${TOKEN_SYMBOL} verfügbar.`,
    );
  }

  // 1. Eigenes Wallet belasten
  const newBalance = balance - total;
  await writeWalletBalance(pod, newBalance);

  // 2. Empfänger gutschreiben (best effort) + eigenes Log schreiben
  const warnings: string[] = [];
  for (const p of payments) {
    await appendTransaction(pod, {
      amount: -p.amount,
      type: 'payment-out',
      counterparty: p.recipientWebId,
      reason: p.reason,
    });
    try {
      await creditRecipient(p.recipientWebId, p.amount, p.reason);
    } catch (e) {
      console.warn('[wallet] Gutschrift fehlgeschlagen für', p.recipientWebId, e);
      warnings.push(
        `Gutschrift an ${shortenWebId(p.recipientWebId)} fehlgeschlagen (${p.amount} ${TOKEN_SYMBOL}) — Empfänger-Wallet nicht erreichbar.`,
      );
    }
  }

  return { paidTotal: total, newBalance, warnings };
}

/** WebID für die Anzeige kürzen: https://host/pod/profile/card#me -> pod@host */
export function shortenWebId(webId: string): string {
  try {
    const url = new URL(webId);
    const podSegment = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return podSegment ? `${podSegment}@${url.hostname}` : url.hostname;
  } catch {
    return webId;
  }
}
