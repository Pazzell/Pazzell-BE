import WalletModel, { IWallet } from "../../models/wallet.model";
import WalletTransactionModel, {
  IWalletTransaction,
  WalletTransactionReason,
} from "../../models/walletTransaction.model";

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient wallet balance");
  }
}

/**
 * Ledger-first design without requiring multi-document Mongo transactions
 * (which need a replica set — not guaranteed available in every deployment
 * target for this project). Each single-document write (the balance $inc,
 * the ledger insert) is atomic on its own; the unique `idempotencyKey` index
 * on WalletTransaction is what actually prevents double-crediting/debiting
 * under retries or concurrent requests. A nightly reconciliation job
 * (services/scheduler) re-derives Wallet.balance from
 * SUM(WalletTransaction) as defense-in-depth against the narrow window where
 * a process could crash between the balance update and the ledger insert.
 */
async function ensureWallet(userId: string): Promise<IWallet> {
  let wallet = await WalletModel.findOne({ userId });
  if (wallet) return wallet;
  try {
    wallet = await WalletModel.create({ userId, balance: 0 });
  } catch (e: any) {
    if (e.code === 11000) {
      wallet = await WalletModel.findOne({ userId });
    } else {
      throw e;
    }
  }
  return wallet!;
}

export interface LedgerMutationParams {
  userId: string;
  amount: number;
  reason: WalletTransactionReason;
  referenceId?: string;
  idempotencyKey: string;
}

export async function credit(
  params: LedgerMutationParams
): Promise<IWalletTransaction> {
  if (params.amount <= 0) throw new Error("amount must be positive");
  await ensureWallet(params.userId);

  const existing = await WalletTransactionModel.findOne({
    idempotencyKey: params.idempotencyKey,
  });
  if (existing) return existing;

  const updatedWallet = await WalletModel.findOneAndUpdate(
    { userId: params.userId },
    { $inc: { balance: params.amount } },
    { new: true }
  );

  try {
    return await WalletTransactionModel.create({
      userId: params.userId,
      type: "credit",
      amount: params.amount,
      balanceAfter: updatedWallet!.balance,
      reason: params.reason,
      referenceId: params.referenceId,
      idempotencyKey: params.idempotencyKey,
    });
  } catch (e: any) {
    if (e.code === 11000) {
      // Concurrent duplicate call already inserted the ledger row between our
      // existence check and this insert — undo the balance bump we just made
      // and return the entry that actually won.
      await WalletModel.findOneAndUpdate(
        { userId: params.userId },
        { $inc: { balance: -params.amount } }
      );
      const winner = await WalletTransactionModel.findOne({
        idempotencyKey: params.idempotencyKey,
      });
      return winner!;
    }
    throw e;
  }
}

export async function debit(
  params: LedgerMutationParams
): Promise<IWalletTransaction> {
  if (params.amount <= 0) throw new Error("amount must be positive");
  await ensureWallet(params.userId);

  const existing = await WalletTransactionModel.findOne({
    idempotencyKey: params.idempotencyKey,
  });
  if (existing) return existing;

  // Atomically enforce non-negative balance under concurrent debits.
  const updatedWallet = await WalletModel.findOneAndUpdate(
    { userId: params.userId, balance: { $gte: params.amount } },
    { $inc: { balance: -params.amount } },
    { new: true }
  );
  if (!updatedWallet) throw new InsufficientBalanceError();

  try {
    return await WalletTransactionModel.create({
      userId: params.userId,
      type: "debit",
      amount: params.amount,
      balanceAfter: updatedWallet.balance,
      reason: params.reason,
      referenceId: params.referenceId,
      idempotencyKey: params.idempotencyKey,
    });
  } catch (e: any) {
    if (e.code === 11000) {
      await WalletModel.findOneAndUpdate(
        { userId: params.userId },
        { $inc: { balance: params.amount } }
      );
      const winner = await WalletTransactionModel.findOne({
        idempotencyKey: params.idempotencyKey,
      });
      return winner!;
    }
    throw e;
  }
}

/** Compensating credit for a failed withdrawal — append-only, never mutates the original debit. */
export async function reverseDebit(
  originalIdempotencyKey: string,
  params: Omit<LedgerMutationParams, "reason"> & { idempotencyKey: string }
): Promise<IWalletTransaction> {
  return credit({ ...params, reason: "withdrawal_reversal" });
}

export async function getBalance(userId: string): Promise<number> {
  const wallet = await ensureWallet(userId);
  return wallet.balance;
}

export async function listTransactions(
  userId: string,
  limit = 50
): Promise<IWalletTransaction[]> {
  return WalletTransactionModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/** Recomputes every user's Wallet.balance from the ledger sum — the nightly reconciliation job. */
export async function reconcileAllWallets(): Promise<{
  checked: number;
  corrected: number;
}> {
  const wallets = await WalletModel.find({});
  let corrected = 0;
  for (const wallet of wallets) {
    const agg = await WalletTransactionModel.aggregate([
      { $match: { userId: wallet.userId } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $eq: ["$type", "credit"] }, "$amount", { $multiply: ["$amount", -1] }],
            },
          },
        },
      },
    ]);
    const ledgerSum = agg[0]?.total || 0;
    if (ledgerSum !== wallet.balance) {
      wallet.balance = ledgerSum;
      await wallet.save();
      corrected++;
    }
  }
  return { checked: wallets.length, corrected };
}
