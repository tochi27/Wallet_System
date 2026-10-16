import { MAX_DEPOSIT, MAX_WITHDRAWAL, MIN_DEPOSIT, MIN_WITHDRAWAL } from "../../validators/payment.validators";
import { MAX_BANK_ACCOUNTS } from "../payments/bank-account.service";

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/**
 * How PurpleWallet works, for the assistant's app_help tool. Limits come from the code itself, so
 * the assistant can never describe a rule the app doesn't enforce.
 */
export const HELP_TOPICS = {
  add_money: `Add money with Add money: you pay through Paystack (card, bank transfer or USSD) and your wallet is credited once Paystack confirms the payment. Each deposit can be ${naira(MIN_DEPOSIT)} to ${naira(MAX_DEPOSIT)}. If a payment is still pending, the app keeps checking with Paystack automatically.`,
  send_money: `Send money to another PurpleWallet user with Send money: enter their email, the amount and an optional note, then confirm with your 4-digit transaction PIN. Transfers between PurpleWallet users arrive instantly.`,
  withdraw: `Withdraw sends money to a bank account you've saved (up to ${MAX_BANK_ACCOUNTS} accounts; the account name is checked with the bank). Each withdrawal can be ${naira(MIN_WITHDRAWAL)} to ${naira(MAX_WITHDRAWAL)} and needs your transaction PIN. The money leaves your wallet straight away; if the bank transfer fails or is reversed, it's refunded to your wallet automatically, exactly once.`,
  pin: `Your 4-digit transaction PIN approves every transfer and withdrawal. Set or change it in Settings → Security. Five wrong PINs in a row lock transfers and withdrawals for 30 minutes. Forgot it? Change it in Settings using your account password instead of the old PIN.`,
  password: `Change your password in Settings → Security; other devices are signed out. Forgot it? Use "Forgot password?" on the login page to get an email link that works once and expires in 30 minutes.`,
  statements: `Download a statement as PDF or CSV from the Wallet page, for any period up to one year. Every transaction also has its own receipt: tap it in your history.`,
  insights: `AI features (Settings → AI features) give you monthly spending insights and this assistant. Your spending is sorted into categories automatically; change a category on any transaction's receipt. Turning AI features off deletes your insights.`,
  account_on_hold: `If your account is on hold, you can still sign in, see your wallet and receive money, but you can't send or withdraw until support lifts the hold. Please contact support.`,
  security: `Security alerts (new sign-ins, password and PIN changes) are always emailed. Never share your PIN or password; PurpleWallet will never ask for them.`,
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;
