import type { Transaction } from "@/api/wallet"

// The API only has CREDIT/DEBIT; transfers and reversals are told apart by their link fields
export function transactionLabel(tx: Transaction) {
  if (tx.reversalOf) return "Reversal"
  if (tx.transferId) return tx.type === "CREDIT" ? "Transfer received" : "Transfer sent"
  return tx.type === "CREDIT" ? "Deposit" : "Withdrawal"
}
