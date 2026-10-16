import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { createUser, signIn } from "./helpers"

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

test("a user sends their ID, staff approve it, and the user moves to Tier 2", async ({ browser }) => {
  const user = await createUser("Kemi Adebayo")
  // Support can review ID checks, but isn't a Finance/Owner admin (that would end solo mode in admin.spec)
  const reviewer = await createUser("Review Staff", { role: "SUPPORT" })

  // The user's side
  const userPage = await (await browser.newContext()).newPage()
  await signIn(userPage, user, "/settings")
  await userPage.getByRole("link", { name: "Upgrade to Tier 2" }).click()

  await userPage.getByLabel("Date of birth").fill("1992-06-15")
  await userPage.getByRole("radio", { name: "National ID card" }).click()
  await userPage.getByLabel("NIN").fill("1234 5678 901")
  await userPage.getByRole("button", { name: "Continue" }).click()

  const pickers = userPage.locator('input[type="file"]')
  await pickers.nth(0).setInputFiles(fixture("id-front.jpg"))
  await userPage.getByRole("button", { name: "Continue" }).click()
  await expect(userPage.getByText("Add a photo of the back too")).toBeVisible()
  await pickers.nth(1).setInputFiles(fixture("id-back.jpg"))
  await userPage.getByRole("button", { name: "Continue" }).click()

  await userPage.locator('input[type="file"]').setInputFiles(fixture("selfie.jpg"))
  await userPage.getByRole("checkbox").check()
  await userPage.getByRole("button", { name: "Send for review" }).click()
  await expect(userPage.getByText("ID being checked")).toBeVisible()

  // Staff review it
  const staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, reviewer, "/admin/verifications")
  await staffPage.getByRole("link", { name: user.name }).click()
  await expect(staffPage.getByText("12345678901")).toBeVisible()
  await expect(staffPage.getByRole("img", { name: "ID (front)" })).toBeVisible()
  await expect(staffPage.getByRole("img", { name: "Selfie with ID" })).toBeVisible()
  await staffPage.getByRole("button", { name: "Approve" }).click()
  await expect(staffPage.getByText(`Approved. ${user.name} is now on Tier 2.`)).toBeVisible()

  // Back to the user
  await userPage.reload()
  await expect(userPage.getByRole("region", { name: "Limits" }).getByText("Tier 2", { exact: true })).toBeVisible()
  await expect(userPage.getByText(/Up to ₦500,000.00 per transfer or withdrawal/)).toBeVisible()
})

test("a rejected ID tells the user why and lets them try again", async ({ browser }) => {
  const user = await createUser("Lanre Shittu")
  const reviewer = await createUser("Review Staff", { role: "SUPPORT" })

  const userPage = await (await browser.newContext()).newPage()
  await signIn(userPage, user, "/settings/upgrade")
  await userPage.getByLabel("Date of birth").fill("1988-02-01")
  await userPage.getByRole("radio", { name: "International passport" }).click()
  await userPage.getByLabel("Passport number").fill("A12345678")
  await userPage.getByRole("button", { name: "Continue" }).click()
  await userPage.locator('input[type="file"]').setInputFiles(fixture("id-front.jpg"))
  await userPage.getByRole("button", { name: "Continue" }).click()
  await userPage.locator('input[type="file"]').setInputFiles(fixture("selfie.jpg"))
  await userPage.getByRole("checkbox").check()
  await userPage.getByRole("button", { name: "Send for review" }).click()
  await expect(userPage.getByText("ID being checked")).toBeVisible()

  const staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, reviewer, "/admin/verifications")
  await staffPage.getByRole("link", { name: user.name }).click()
  await staffPage.getByRole("button", { name: "Reject" }).click()
  const dialog = staffPage.getByRole("dialog")
  await dialog.getByRole("radio", { name: "Photo blurry or too dark" }).click()
  await dialog.getByLabel(/Message to/).fill("The passport page is too dark.")
  await dialog.getByRole("button", { name: "Reject" }).click()
  await expect(staffPage.getByText("Rejected. They've been told why")).toBeVisible()

  await userPage.reload()
  await expect(userPage.getByText(/A photo was blurry or too dark to read\. The passport page is too dark\./)).toBeVisible()
  await expect(userPage.getByRole("link", { name: "Try again" })).toBeVisible()
})
