import { test, expect } from '@playwright/test'

test('has title', async ({ page }) => {
  await page.goto('https://www.renfe.com/es/es')

  await expect(page).toHaveTitle(/Renfe/)
  await page.waitForLoadState('domcontentloaded')
  // await page.waitForSelector('#origin')
  // await page.locator('#origin').isVisible()

  await page.locator('#origin').pressSequentially('MAD')
  await page.locator('#awesomplete_list_2_item_0').click()

  await page.locator('#destination').pressSequentially('Barc')
  await page.locator('#awesomplete_list_1_item_0').click()

  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  await page.locator('#datepicker').click()
  await page.locator('[date-time=1707433200000]').click()
})
