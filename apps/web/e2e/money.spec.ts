import { expect, test, type Page } from "@playwright/test"
import { api, createUser, naira, PIN, signIn, type TestUser } from "./helpers"

// Fills the Send money dialog and confirms with the PIN
async function send(page: Page, to: TestUser, amount: number, pin = PIN) {
  await page.getByRole("button", { name: "Send money" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Recipient email").fill(to.email)
  await dialog.getByLabel("Amount").fill(String(amount))
  await dialog.getByRole("button", { name: "Continue" }).click()
  // Like a banking app, the PIN step submits by itself on the fourth digit
  await dialog.getByLabel("Transaction PIN").fill(pin)
  return dialog
}

test("sends money with the PIN, and both sides see it", async ({ page }) => {
  const sender = await createUser("Chi Eze", { pin: true, balance: 20_000 })
  const receiver = await createUser("Dayo Bello")
  await signIn(page, sender)

  await send(page, receiver, 2_500)
  await expect(page.getByText(`Sent ${naira(2_500)} to ${receiver.email}`)).toBeVisible()

  // The receipt, from the recent transactions list
  await page.getByRole("link", { name: /Transfer to/ }).first().click()
  await expect(page).toHaveURL(/\/transactions\//)
  await expect(page.getByText(naira(2_500)).first()).toBeVisible()

  const theirs = await api<{ balance: string }>("/api/wallet/balance", { token: receiver.token })
  expect(Number(theirs.balance)).toBe(2_500)
})

test("a wrong PIN is refused and no money moves", async ({ page }) => {
  const sender = await createUser("Efe Okon", { pin: true, balance: 10_000 })
  const receiver = await createUser("Funmi Ola")
  await signIn(page, sender)

  const dialog = await send(page, receiver, 1_000, "1357")
  await expect(dialog.getByText(/Incorrect PIN/)).toBeVisible()

  const mine = await api<{ balance: string }>("/api/wallet/balance", { token: sender.token })
  expect(Number(mine.balance)).toBe(10_000)
})

test("the daily limit stops a payment, says how much is left, and Settings shows today's usage", async ({ page }) => {
  const sender = await createUser("Gozie Nnamdi", { pin: true, balance: 300_000 })
  const receiver = await createUser("Hauwa Musa")
  // ₦190,000 of the ₦200,000 Tier 1 daily limit, sent earlier today
  for (const amount of [50_000, 50_000, 50_000, 40_000]) {
    await api("/api/wallet/transfer", { token: sender.token, body: { receiverEmail: receiver.email, amount, pin: PIN } })
  }
  await signIn(page, sender)

  const dialog = await send(page, receiver, 20_000)
  await expect(dialog.getByText(`You can send or withdraw up to ${naira(10_000)} more today`)).toBeVisible()

  await page.goto("/settings")
  const limits = page.getByRole("region", { name: "Limits" })
  await expect(limits.getByText(`${naira(10_000)} left today`)).toBeVisible()
  await expect(limits.getByRole("meter", { name: "Sent and withdrawn today" })).toHaveAttribute("aria-valuenow", "190000")
})

test("@phone sends money from the phone layout", async ({ page }) => {
  const sender = await createUser("Ify Uche", { pin: true, balance: 5_000 })
  const receiver = await createUser("Jide Ojo")
  await signIn(page, sender)

  // On phones, Send is the raised button in the bottom bar
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Send money" })).toBeVisible()
  await send(page, receiver, 750)
  await expect(page.getByText(`Sent ${naira(750)} to ${receiver.email}`)).toBeVisible()
})
