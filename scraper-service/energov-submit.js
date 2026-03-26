const { getEnergovSession } = require("./energov-auth");

const SUBMIT_TIMEOUT = 30000;
const VALIDATION_WAIT_MS = 3000;
const SPA_RENDER_WAIT_MS = 3000;

async function takeSubmitScreenshot(page, stepName) {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    const base64 = buffer.toString("base64");
    const url = `data:image/png;base64,${base64}`;
    console.log(`  [EnerGov Submit] Screenshot captured: ${stepName} (${Math.round(base64.length / 1024)}KB)`);
    return {
      step_name: stepName,
      agent_name: "submission_finalization",
      screenshot_url: url,
      captured_at: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`  [EnerGov Submit] Screenshot failed for ${stepName}: ${err.message}`);
    return null;
  }
}

async function extractReviewPageFields(page) {
  return page.evaluate(() => {
    const fields = {};

    const rows = document.querySelectorAll("table tr, .review-row, .summary-row, dl dt");
    rows.forEach((row) => {
      if (row.tagName === "DT") {
        const dd = row.nextElementSibling;
        if (dd && dd.tagName === "DD") {
          fields[row.textContent.trim().replace(/:$/, "")] = dd.textContent.trim();
        }
        return;
      }
      const cells = row.querySelectorAll("td, th");
      if (cells.length === 2) {
        const label = cells[0].textContent.trim().replace(/:$/, "");
        const value = cells[1].textContent.trim();
        if (label && value) {
          fields[label] = value;
        }
      }
    });

    const labels = document.querySelectorAll("label");
    labels.forEach((label) => {
      const text = label.textContent.trim().replace(/:$/, "");
      let sibling = label.nextElementSibling;
      while (sibling) {
        const tag = (sibling.tagName || "").toLowerCase();
        if (["span", "div", "p", "input", "select", "textarea"].includes(tag)) {
          const value = sibling.value || sibling.textContent.trim();
          if (text && value) {
            fields[text] = value;
          }
          break;
        }
        sibling = sibling.nextElementSibling;
      }
    });

    const boldSpans = document.querySelectorAll("strong, b, span[class*='label'], span[class*='key']");
    boldSpans.forEach((el) => {
      const label = el.textContent.trim().replace(/:$/, "");
      let next = el.nextElementSibling || el.nextSibling;
      if (next) {
        const value = (next.textContent || "").trim();
        if (label && value && label.length < 60 && value.length < 300) {
          fields[label] = value;
        }
      }
    });

    const reactSummaryEls = document.querySelectorAll(
      "[class*='summary' i] [class*='row' i], [class*='review' i] [class*='row' i], [class*='detail' i] [class*='row' i]"
    );
    reactSummaryEls.forEach((row) => {
      const children = row.children;
      if (children.length >= 2) {
        const label = children[0].textContent.trim().replace(/:$/, "");
        const value = children[1].textContent.trim();
        if (label && value) {
          fields[label] = value;
        }
      }
    });

    return fields;
  });
}

function validateFieldsMatch(reviewFields, expectedData) {
  const mismatches = [];
  const matched = [];

  const normalize = (val) => {
    if (!val) return "";
    return String(val).trim().toLowerCase().replace(/\s+/g, " ");
  };

  const checkField = (label, expectedValue, reviewFieldKeys) => {
    if (!expectedValue) return;
    const normalizedExpected = normalize(expectedValue);

    for (const key of reviewFieldKeys) {
      const reviewValue = reviewFields[key];
      if (reviewValue) {
        const normalizedReview = normalize(reviewValue);
        if (normalizedReview.includes(normalizedExpected) || normalizedExpected.includes(normalizedReview)) {
          matched.push({ field: label, expected: expectedValue, found: reviewValue });
          return;
        }
      }
    }

    const allReviewValues = Object.values(reviewFields).map(normalize);
    const foundInAny = allReviewValues.some(
      (v) => v.includes(normalizedExpected) || normalizedExpected.includes(v)
    );

    if (foundInAny) {
      matched.push({ field: label, expected: expectedValue, found: "(found in page content)" });
    } else {
      mismatches.push({ field: label, expected: expectedValue, found: null });
    }
  };

  if (expectedData.property_address) {
    checkField("Address", expectedData.property_address, [
      "Address", "Property Address", "Project Address", "Location",
      "Street Address", "Site Address", "address", "property address",
    ]);
  }

  if (expectedData.permit_type) {
    checkField("Permit Type", expectedData.permit_type, [
      "Permit Type", "Type", "Application Type", "permit type",
      "Permit Category", "Category", "Record Type",
    ]);
  }

  if (expectedData.scope_of_work) {
    checkField("Scope of Work", expectedData.scope_of_work, [
      "Scope of Work", "Description", "Project Description",
      "Scope", "Work Description", "scope of work",
    ]);
  }

  if (expectedData.construction_value) {
    checkField("Construction Value", String(expectedData.construction_value), [
      "Construction Value", "Cost", "Estimated Cost",
      "Construction Cost", "Value", "construction value",
    ]);
  }

  return {
    valid: mismatches.length === 0,
    matched,
    mismatches,
    total_fields_checked: matched.length + mismatches.length,
    review_fields_found: Object.keys(reviewFields).length,
  };
}

async function detectPortalErrors(page) {
  return page.evaluate(() => {
    const errors = [];

    const errorSelectors = [
      ".error-message", ".error", ".alert-danger", ".alert-error",
      "[class*='error' i]", "[class*='Error']", "[id*='error' i]",
      ".validation-error", ".field-error", ".form-error",
      "[role='alert']", ".mat-error", ".ng-invalid.ng-touched",
      "[class*='snack' i][class*='error' i]",
    ];

    for (const sel of errorSelectors) {
      const elements = document.querySelectorAll(sel);
      elements.forEach((el) => {
        const text = el.textContent.trim();
        if (text && text.length > 2 && text.length < 500) {
          if (!errors.includes(text)) {
            errors.push(text);
          }
        }
      });
    }

    const modals = document.querySelectorAll(
      "[class*='modal' i], [class*='dialog' i], [class*='popup' i], [role='dialog']"
    );
    modals.forEach((modal) => {
      const style = window.getComputedStyle(modal);
      if (style.display !== "none" && style.visibility !== "hidden") {
        const text = modal.textContent.trim();
        if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed")) {
          if (text.length < 500 && !errors.includes(text)) {
            errors.push(text);
          }
        }
      }
    });

    return errors;
  });
}

async function extractConfirmation(page) {
  return page.evaluate(() => {
    const result = {
      application_id: null,
      confirmation_number: null,
      record_number: null,
      message: null,
      raw_text: "",
    };

    const body = document.body.innerText || "";
    result.raw_text = body.substring(0, 2000);

    const confirmPatterns = [
      /(?:confirmation|reference|tracking)\s*(?:#|number|no\.?|num)?\s*[:=]?\s*([A-Z0-9\-]+)/i,
      /(?:application|permit)\s*(?:#|number|no\.?|num|id)?\s*[:=]?\s*([A-Z0-9\-]+)/i,
      /(?:record|case)\s*(?:#|number|no\.?|num|id)?\s*[:=]?\s*([A-Z0-9\-]+)/i,
      /(?:plan|plan case)\s*(?:#|number|no\.?)?\s*[:=]?\s*([A-Z0-9\-]+)/i,
    ];

    for (const pattern of confirmPatterns) {
      const match = body.match(pattern);
      if (match && match[1]) {
        const value = match[1].trim();
        if (value.length >= 4 && value.length <= 30) {
          if (!result.confirmation_number) {
            result.confirmation_number = value;
          } else if (!result.application_id) {
            result.application_id = value;
          }
        }
      }
    }

    const idSelectors = [
      "[data-field='applicationId']", "[data-field='confirmationNumber']",
      "[data-field='recordNumber']", "[data-field='recordId']",
      "[id*='confirmation' i]", "[id*='applicationId' i]",
      "[id*='trackingNumber' i]", "[id*='recordId' i]",
      "[id*='recordNumber' i]", "[id*='planNumber' i]",
      "[class*='confirmation' i]", "[class*='tracking' i]",
      "[class*='record-number' i]",
    ];

    for (const sel of idSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.value || el.textContent || "").trim();
        if (text && text.length >= 4 && text.length <= 30) {
          if (sel.toLowerCase().includes("application") || sel.toLowerCase().includes("record")) {
            result.application_id = result.application_id || text;
            result.record_number = result.record_number || text;
          } else {
            result.confirmation_number = result.confirmation_number || text;
          }
        }
      }
    }

    const successSelectors = [
      "[class*='success' i]", ".alert-success", "[class*='confirm' i]",
      "[class*='complete' i]", "h1", "h2", "h3",
    ];

    for (const sel of successSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (
          text.toLowerCase().includes("success") ||
          text.toLowerCase().includes("submitted") ||
          text.toLowerCase().includes("confirmation") ||
          text.toLowerCase().includes("received") ||
          text.toLowerCase().includes("complete")
        ) {
          result.message = text.substring(0, 200);
          break;
        }
      }
    }

    return result;
  });
}

async function energovSubmit(sessionToken, filingData, config, supabase) {
  const baseUrl = (config && config.baseUrl) || "";
  console.log("  [EnerGov Submit] Starting EnerGov submission finalization");
  console.log(`  [EnerGov Submit] Filing ID: ${filingData.filing_id}`);
  console.log(`  [EnerGov Submit] Base URL: ${baseUrl}`);

  const session = getEnergovSession(sessionToken);
  if (!session) {
    return {
      success: false,
      error: "session_not_found",
      message: "EnerGov session not found or expired. Re-authenticate first.",
    };
  }

  const page = session.page;
  const screenshots = [];

  try {
    const currentUrl = page.url();
    console.log(`  [EnerGov Submit] Current page URL: ${currentUrl}`);

    if (
      currentUrl.includes("SessionEnded") ||
      currentUrl.includes("/login") ||
      currentUrl.includes("b2clogin")
    ) {
      return {
        success: false,
        error: "session_expired",
        message: "EnerGov portal session expired. Re-authenticate and try again.",
        requiresReauth: true,
      };
    }

    const reviewScreenshot = await takeSubmitScreenshot(page, "review_page_before_validation");
    if (reviewScreenshot) screenshots.push(reviewScreenshot);

    console.log("  [EnerGov Submit] Extracting review page fields...");
    const reviewFields = await extractReviewPageFields(page);
    console.log(`  [EnerGov Submit] Found ${Object.keys(reviewFields).length} fields on review page`);

    const validation = validateFieldsMatch(reviewFields, filingData);
    console.log(`  [EnerGov Submit] Validation result: ${validation.valid ? "PASS" : "FAIL"}`);
    console.log(`  [EnerGov Submit] Matched: ${validation.matched.length}, Mismatches: ${validation.mismatches.length}`);

    if (validation.mismatches.length > 0) {
      console.log("  [EnerGov Submit] Mismatches found:");
      validation.mismatches.forEach((m) => {
        console.log(`    - ${m.field}: expected "${m.expected}", found: ${m.found || "NOT FOUND"}`);
      });
    }

    const validationScreenshot = await takeSubmitScreenshot(page, "review_validation_result");
    if (validationScreenshot) {
      validationScreenshot.field_audit = {
        review_fields: reviewFields,
        validation_result: validation,
      };
      screenshots.push(validationScreenshot);
    }

    if (!validation.valid) {
      if (supabase && filingData.filing_id) {
        for (const ss of screenshots) {
          try {
            await supabase.from("filing_screenshots").insert({
              filing_id: filingData.filing_id,
              agent_name: ss.agent_name,
              step_name: ss.step_name,
              screenshot_url: ss.screenshot_url,
              field_audit: ss.field_audit || null,
            });
          } catch (_) {}
        }
      }

      return {
        success: false,
        error: "validation_failed",
        message: `Review page validation failed: ${validation.mismatches.length} field(s) did not match expected values`,
        validation,
        screenshots,
        review_fields: reviewFields,
      };
    }

    console.log("  [EnerGov Submit] Validation passed — proceeding to submit...");

    const preSubmitErrors = await detectPortalErrors(page);
    if (preSubmitErrors.length > 0) {
      console.log(`  [EnerGov Submit] Portal errors detected before submit: ${preSubmitErrors.join("; ")}`);

      return {
        success: false,
        error: "portal_errors_before_submit",
        message: `Portal showed errors before submission: ${preSubmitErrors.join("; ")}`,
        portal_errors: preSubmitErrors,
        screenshots,
      };
    }

    const agreeSelectors = [
      'input[type="checkbox"][id*="agree" i]',
      'input[type="checkbox"][id*="terms" i]',
      'input[type="checkbox"][id*="accept" i]',
      'input[type="checkbox"][name*="agree" i]',
      'label:has-text("I agree") input[type="checkbox"]',
      'label:has-text("I certify") input[type="checkbox"]',
    ];
    for (const sel of agreeSelectors) {
      const checkbox = await page.$(sel);
      if (checkbox && (await checkbox.isVisible().catch(() => false))) {
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
          await checkbox.check();
          console.log(`  [EnerGov Submit] Checked agreement checkbox: ${sel}`);
          await page.waitForTimeout(500);
        }
        break;
      }
    }

    const submitSelectors = [
      'button:has-text("Submit")',
      'button:has-text("Submit Application")',
      'button:has-text("Submit Permit")',
      'input[value="Submit"]',
      'input[value="Submit Application"]',
      'button[type="submit"]:has-text("Submit")',
      'button.btn-primary:has-text("Submit")',
      '[data-action="submit"]',
      '[data-action="submit-application"]',
      ".wizard-submit",
      ".btn-submit",
      'button[mat-raised-button]:has-text("Submit")',
    ];

    let submitButton = null;
    for (const sel of submitSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        const isDisabled = await btn.evaluate(
          (el) => el.disabled || el.classList.contains("disabled") || el.hasAttribute("disabled")
        );
        if (!isDisabled) {
          submitButton = { element: btn, selector: sel };
          break;
        }
      }
    }

    if (!submitButton) {
      const noSubmitScreenshot = await takeSubmitScreenshot(page, "no_submit_button_found");
      if (noSubmitScreenshot) screenshots.push(noSubmitScreenshot);

      return {
        success: false,
        error: "submit_button_not_found",
        message: "Could not find an enabled Submit button on the review page",
        screenshots,
      };
    }

    console.log(`  [EnerGov Submit] Found submit button: ${submitButton.selector}`);
    console.log("  [EnerGov Submit] Clicking submit...");

    const preSubmitScreenshot = await takeSubmitScreenshot(page, "pre_submit_click");
    if (preSubmitScreenshot) screenshots.push(preSubmitScreenshot);

    await submitButton.element.click();
    console.log("  [EnerGov Submit] Submit button clicked");

    await page.waitForTimeout(VALIDATION_WAIT_MS);
    try {
      await page.waitForLoadState("networkidle", { timeout: SUBMIT_TIMEOUT });
    } catch (_) {}
    await page.waitForTimeout(SPA_RENDER_WAIT_MS);

    const confirmDialogSelectors = [
      'button:has-text("OK")',
      'button:has-text("Confirm")',
      'button:has-text("Yes")',
      '[role="dialog"] button:has-text("OK")',
      '.modal button:has-text("OK")',
    ];
    for (const sel of confirmDialogSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click();
        console.log(`  [EnerGov Submit] Clicked confirmation dialog button: ${sel}`);
        await page.waitForTimeout(2000);
        break;
      }
    }

    const immediateErrors = await detectPortalErrors(page);

    if (immediateErrors.length > 0) {
      console.log(`  [EnerGov Submit] Portal errors after submit: ${immediateErrors.join("; ")}`);

      const errorScreenshot = await takeSubmitScreenshot(page, "post_submit_errors");
      if (errorScreenshot) {
        errorScreenshot.field_audit = { portal_errors: immediateErrors };
        screenshots.push(errorScreenshot);
      }

      if (supabase && filingData.filing_id) {
        for (const ss of screenshots) {
          try {
            await supabase.from("filing_screenshots").insert({
              filing_id: filingData.filing_id,
              agent_name: ss.agent_name,
              step_name: ss.step_name,
              screenshot_url: ss.screenshot_url,
              field_audit: ss.field_audit || null,
            });
          } catch (_) {}
        }
      }

      return {
        success: false,
        error: "portal_errors_after_submit",
        message: `Portal showed errors after submission: ${immediateErrors.join("; ")}`,
        portal_errors: immediateErrors,
        screenshots,
      };
    }

    console.log("  [EnerGov Submit] No errors detected — extracting confirmation...");

    const confirmationData = await extractConfirmation(page);
    console.log(`  [EnerGov Submit] Confirmation number: ${confirmationData.confirmation_number || "not found"}`);
    console.log(`  [EnerGov Submit] Application ID: ${confirmationData.application_id || "not found"}`);
    console.log(`  [EnerGov Submit] Record number: ${confirmationData.record_number || "not found"}`);
    console.log(`  [EnerGov Submit] Message: ${confirmationData.message || "none"}`);

    const confirmScreenshot = await takeSubmitScreenshot(page, "confirmation_page");
    if (confirmScreenshot) {
      confirmScreenshot.field_audit = { confirmation: confirmationData };
      screenshots.push(confirmScreenshot);
    }

    if (supabase && filingData.filing_id) {
      try {
        const submittedAt = new Date().toISOString();
        await supabase
          .from("permit_filings")
          .update({
            filing_status: "submitted",
            application_id: confirmationData.application_id || confirmationData.record_number || null,
            confirmation_number: confirmationData.confirmation_number || null,
            submitted_at: submittedAt,
            updated_at: submittedAt,
          })
          .eq("id", filingData.filing_id);

        console.log(`  [EnerGov Submit] Updated permit_filings: status=submitted`);
      } catch (err) {
        console.log(`  [EnerGov Submit] Failed to update permit_filings: ${err.message}`);
      }

      for (const ss of screenshots) {
        try {
          await supabase.from("filing_screenshots").insert({
            filing_id: filingData.filing_id,
            agent_name: ss.agent_name,
            step_name: ss.step_name,
            screenshot_url: ss.screenshot_url,
            field_audit: ss.field_audit || null,
          });
        } catch (_) {}
      }
    }

    console.log("  [EnerGov Submit] Submission finalization complete");

    return {
      success: true,
      application_id: confirmationData.application_id,
      confirmation_number: confirmationData.confirmation_number,
      record_number: confirmationData.record_number,
      confirmation_message: confirmationData.message,
      validation,
      screenshots,
      submitted_at: new Date().toISOString(),
      portal_type: "energov",
    };
  } catch (err) {
    console.error(`  [EnerGov Submit] Fatal error: ${err.message}`);

    const errorScreenshot = await takeSubmitScreenshot(page, "fatal_error").catch(() => null);
    if (errorScreenshot) screenshots.push(errorScreenshot);

    if (supabase && filingData.filing_id) {
      try {
        await supabase
          .from("permit_filings")
          .update({
            filing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", filingData.filing_id);
      } catch (_) {}

      for (const ss of screenshots) {
        try {
          await supabase.from("filing_screenshots").insert({
            filing_id: filingData.filing_id,
            agent_name: ss.agent_name,
            step_name: ss.step_name,
            screenshot_url: ss.screenshot_url,
            field_audit: ss.field_audit || null,
          });
        } catch (_) {}
      }
    }

    return {
      success: false,
      error: "submission_error",
      message: err.message,
      screenshots,
    };
  }
}

module.exports = {
  energovSubmit,
  extractReviewPageFields,
  validateFieldsMatch,
  extractConfirmation,
  detectPortalErrors,
};
