# 07 — Financial and wallet

Ten screens: customer and dealer bank accounts with their approvals, wallet recharge by PG and its
status, wallet transfer, wallet balances for customer and RO, and suspense transactions.

Money paths. Every case here is at least P1, and anything that moves a balance is P0.

---

## Bank accounts — four-eyes

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-FI-01 | P0 | Add a customer bank account | Created, pending approval; not usable yet |
| REG-FI-02 | P0 | Approve it (`/Financial/BankApprovals`), as someone other than the adder | Active and usable |
| REG-FI-03 | P0 | The adder cannot approve their own | Refused |
| REG-FI-04 | P1 | Reject | Account not usable; reason recorded |
| REG-FI-05 | P1 | Invalid IFSC, and an account number failing the bank's format | Refused before submission |
| REG-FI-06 | P1 | A duplicate account number for the same customer | Refused |
| REG-FI-07 | P1 | Add an RO bank account (`/Financial/adddealerbankdetails`) | Created, pending approval |
| REG-FI-08 | P0 | Approve Dealer Bank Account (`/Financial/DealerBankApprovals`) | Active; four-eyes holds |
| REG-FI-09 | P1 | Pending Bank Account Status report agrees with both queues | Counts match |

---

## Wallet recharge

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-FI-10 | P0 | Recharge by PG, success | Balance increases by exactly the amount; a transaction row is written |
| REG-FI-11 | P0 | Recharge, payment failed at the gateway | Balance **unchanged**; the attempt is recorded as failed |
| REG-FI-12 | P0 | Recharge, gateway timeout or abandoned mid-flow | Balance unchanged; no orphan credit. The dangerous case |
| REG-FI-13 | P1 | View Wallet Recharge Status | Reflects the three outcomes above correctly |
| REG-FI-14 | P1 | Zero, negative and non-numeric amounts | Refused |
| REG-FI-15 | P1 | An amount above the configured maximum | Refused with the limit named |
| REG-FI-16 | P0 | The same recharge submitted twice (double-click, or resubmit) | Charged once. Confirm by balance **and** transaction count |

---

## Wallet transfer and balances

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-FI-17 | P0 | Transfer from customer wallet to vehicle | Source falls, destination rises, by the same amount |
| REG-FI-18 | P0 | Transfer more than the available balance | Refused; nothing moves |
| REG-FI-19 | P0 | Transfer to a blocked or de-mapped vehicle | Refused |
| REG-FI-20 | P1 | Transfer to a vehicle of another customer | Refused — the customer boundary |
| REG-FI-21 | P1 | View Wallet Balance, and RO Wallet Balance | Match the database and the transaction history |
| REG-FI-22 | P1 | Balance after a sequence of recharge, transfer and transaction | Reconciles. Do the arithmetic rather than reading the figure |
| REG-FI-23 | P0 | Two simultaneous transfers from one wallet | Never overdraws. Untested here; concurrency is not covered anywhere in this suite |

---

## Suspense and reconciliation

| ID | Pri | Case | Expected |
|---|---|---|---|
| REG-FI-24 | P1 | Suspense Transactions lists unclaimed entries | Renders; figures match `Financial` data |
| REG-FI-25 | P1 | Resolve a suspense entry to a customer | Balance moves; the entry leaves the queue |
| REG-FI-26 | P1 | Suspense Report agrees with the screen | Same totals |
| REG-FI-27 | P1 | NEFT Report against actual transfers | Reconciles |
| REG-FI-28 | P1 | SAP Entry - PG report | Reconciles with the recharge transactions |
| REG-FI-29 | P0 | Credit PIN required where configured | A transaction without it is refused |
| REG-FI-30 | P1 | Transaction Details (`/TransactionDetail/WalletFundTransactions`) | Every movement above appears, with actor and timestamp |
