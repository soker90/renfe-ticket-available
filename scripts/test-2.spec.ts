import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.renfe.com/es/es');
  await page.getByRole('button', { name: 'Aceptar todas las cookies' }).click();
  await page.getByPlaceholder('Estación de origen').click();
  await page.getByPlaceholder('Estación de origen').fill('mad');
  await page.getByRole('option', { name: 'MADRID (TODAS)' }).click();
  await page.getByPlaceholder('Estación de destino').click();
  await page.getByPlaceholder('Estación de destino').fill('alc');
  await page.getByRole('option', { name: 'ALCÁZAR DE SAN JUAN' }).click();
  await page.getByLabel('Ida y vuelta Menú desplegable').click();
  await page.getByRole('button', { name: 'Sólo ida' }).click();
  await page.getByLabel('Fecha ida').click();
  await page.getByText('16', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.getByRole('button', { name: 'Buscar billete' }).click();
  await page.getByRole('radio', { name: 'desde 16,65 €' }).click();
});