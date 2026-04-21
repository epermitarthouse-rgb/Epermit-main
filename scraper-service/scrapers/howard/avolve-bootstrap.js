/**
 * Howard Avolve shell: SSOLanding → Continue → ServiceScreen → Go To ProjectDox (new tab) → User/Index.
 */

"use strict";

const HOWARD_HOST = "howardco-md-us.avolvecloud.com";

/**
 * After B2C login, advance through portal chrome into ProjectDox WebUI.
 * @param {import('playwright').Page} portalPage — main tab on howardco-md-us.avolvecloud.com
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<import('playwright').Page>} ProjectDox page (typically popup) showing /User/Index
 */
async function bootstrapHowardProjectDoxFromPortal(portalPage, context) {
  const u0 = portalPage.url();
  console.log("[Howard][bootstrap] start URL:", u0);

  if (!/\/Home\/SSOLanding/i.test(u0)) {
    console.log("[Howard][bootstrap] waiting for SSOLanding path…");
    await portalPage
      .waitForURL(/\/Home\/SSOLanding/i, { timeout: 120000 })
      .catch(() => {});
  }

  await portalPage.waitForSelector("#continue-button", { timeout: 60000 });
  console.log("[Howard][bootstrap] clicking #continue-button");
  await portalPage.locator("#continue-button").first().click();
  await portalPage.waitForLoadState("domcontentloaded").catch(() => {});
  await portalPage.waitForTimeout(1200);

  await portalPage.waitForURL(/\/Home\/ServiceScreen/i, { timeout: 90000 }).catch(() => {});
  const u1 = portalPage.url();
  console.log("[Howard][bootstrap] after Continue:", u1);

  const popupPromise = context.waitForEvent("page", { timeout: 45000 });
  const goLink = portalPage.locator('a[name="Go To ProjectDox"]').first();
  await goLink.waitFor({ state: "visible", timeout: 30000 });
  console.log('[Howard][bootstrap] clicking a[name="Go To ProjectDox"]');
  await goLink.click({ timeout: 15000 });

  const pdxPage = await popupPromise;
  if (!pdxPage) {
    throw new Error("[Howard][bootstrap] expected new page from Go To ProjectDox — none opened");
  }

  await pdxPage.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  const deadline = Date.now() + 90000;
  let finalUrl = "";
  while (Date.now() < deadline) {
    finalUrl = pdxPage.url();
    if (finalUrl && finalUrl !== "about:blank" && /\/User\/Index/i.test(finalUrl)) {
      console.log("[Howard][bootstrap] ProjectDox shell ready:", finalUrl);
      return pdxPage;
    }
    await pdxPage.waitForTimeout(400);
  }

  finalUrl = pdxPage.url();
  if (!/\/User\/Index/i.test(finalUrl)) {
    throw new Error(
      `[Howard][bootstrap] ProjectDox page did not reach /User/Index (got ${finalUrl})`,
    );
  }
  return pdxPage;
}

module.exports = {
  bootstrapHowardProjectDoxFromPortal,
  HOWARD_HOST,
};
