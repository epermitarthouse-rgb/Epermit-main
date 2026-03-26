const { getEnergovSession } = require("./energov-auth");

const WIZARD_TIMEOUT = 30000;
const STEP_WAIT_MS = 2000;
const SPA_RENDER_WAIT_MS = 3000;

async function takeStepScreenshot(page, stepName, agentName) {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    const base64 = buffer.toString("base64");
    const url = `data:image/png;base64,${base64}`;
    console.log(`  [EnerGov Filer] Screenshot captured: ${stepName} (${Math.round(base64.length / 1024)}KB)`);
    return {
      step_name: stepName,
      agent_name: agentName || "form_filing",
      screenshot_url: url,
      captured_at: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`  [EnerGov Filer] Screenshot failed for ${stepName}: ${err.message}`);
    return null;
  }
}

async function captureFieldAudit(page) {
  return page.evaluate(() => {
    const fields = {};
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="email"], textarea, select'
    );
    inputs.forEach((input) => {
      const id = input.id || input.name || "";
      if (!id) return;
      const label =
        document.querySelector(`label[for="${id}"]`)?.textContent?.trim() || id;
      if (input.tagName === "SELECT") {
        const selected = input.options[input.selectedIndex];
        fields[label] = {
          type: "select",
          value: selected ? selected.text : "",
          filled: input.selectedIndex > 0,
        };
      } else {
        fields[label] = {
          type: input.type || "text",
          value: input.value || "",
          filled: !!input.value,
        };
      }
    });
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      const id = cb.id || cb.name || "";
      if (!id) return;
      const label =
        document.querySelector(`label[for="${id}"]`)?.textContent?.trim() || id;
      fields[label] = { type: "checkbox", value: cb.checked, filled: true };
    });
    return fields;
  });
}

async function waitForSpaNavigation(page, timeoutMs) {
  const timeout = timeoutMs || WIZARD_TIMEOUT;
  try {
    await page.waitForLoadState("networkidle", { timeout });
  } catch (_) {}
  await page.waitForTimeout(SPA_RENDER_WAIT_MS);
}

async function fillField(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const field = await page.$(sel);
    if (field && (await field.isVisible().catch(() => false))) {
      await field.fill("");
      await field.fill(String(value));
      console.log(`  [EnerGov Filer] Filled field: ${sel} = "${String(value).substring(0, 50)}"`);
      return true;
    }
  }
  return false;
}

async function selectDropdown(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const select = await page.$(sel);
    if (select && (await select.isVisible().catch(() => false))) {
      try {
        await select.selectOption({ label: value });
        console.log(`  [EnerGov Filer] Selected dropdown: ${sel} = "${value}"`);
        return true;
      } catch (_) {
        try {
          await select.selectOption({ value: value });
          return true;
        } catch (_) {
          const options = await select.$$("option");
          for (const opt of options) {
            const text = (await opt.textContent().catch(() => "")).trim().toLowerCase();
            if (text.includes(value.toLowerCase())) {
              const optValue = await opt.getAttribute("value");
              await select.selectOption({ value: optValue });
              console.log(`  [EnerGov Filer] Selected dropdown (fuzzy): ${sel} = "${text}"`);
              return true;
            }
          }
        }
      }
    }
  }

  const matSelectors = [
    `mat-select, [role="listbox"], [role="combobox"]`,
  ];
  for (const sel of matSelectors) {
    const elements = await page.$$(sel);
    for (const el of elements) {
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(500);

        const optionSel = `mat-option, [role="option"], li[role="option"]`;
        const options = await page.$$(optionSel);
        for (const opt of options) {
          const text = (await opt.textContent().catch(() => "")).trim();
          if (text.toLowerCase().includes(value.toLowerCase())) {
            await opt.click();
            console.log(`  [EnerGov Filer] Selected SPA dropdown option: "${text}"`);
            await page.waitForTimeout(500);
            return true;
          }
        }

        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
  }

  return false;
}

async function clickNextButton(page) {
  const nextSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Proceed")',
    'input[value="Next"]',
    'input[value="Continue"]',
    'a:has-text("Next")',
    'button[type="submit"]:has-text("Next")',
    'button.btn-primary:has-text("Next")',
    '[data-action="next"]',
    ".wizard-next",
    ".btn-next",
    'button[mat-button]:has-text("Next")',
    'button[mat-raised-button]:has-text("Next")',
  ];

  for (const sel of nextSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      const isDisabled = await btn.evaluate(
        (el) => el.disabled || el.classList.contains("disabled") || el.hasAttribute("disabled")
      );
      if (!isDisabled) {
        console.log(`  [EnerGov Filer] Clicking next button: ${sel}`);
        await btn.click();
        await page.waitForTimeout(STEP_WAIT_MS);
        await waitForSpaNavigation(page, 15000);
        return true;
      }
    }
  }
  return false;
}

async function fillPermitType(page, filingData) {
  console.log("  [EnerGov Filer] Step: Permit Type Selection");

  const permitTypeMap = {
    residential: ["Residential", "Building - Residential", "Homeowner", "Residential Building"],
    commercial: ["Commercial", "Building - Commercial", "Commercial Building"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    solar: ["Solar", "Solar Panel", "Renewable Energy"],
    demolition: ["Demolition", "Demo"],
    renovation: ["Renovation", "Alteration", "Remodel"],
  };

  const permitType = filingData.permit_type || "residential";
  const typeLabels = permitTypeMap[permitType] || [permitType];

  const typeSelectors = [
    'select[id*="permit" i][id*="type" i]',
    'select[name*="permit" i][name*="type" i]',
    'select[id*="permitType" i]',
    'select[name*="permitType" i]',
    'select[id*="type" i]',
    'select[id*="category" i]',
    'select[name*="category" i]',
  ];

  let selected = false;
  for (const label of typeLabels) {
    if (await selectDropdown(page, typeSelectors, label)) {
      selected = true;
      break;
    }
  }

  if (!selected) {
    for (const label of typeLabels) {
      const radioOrLink = await page.$(
        `input[type="radio"][value*="${label}" i], label:has-text("${label}"), a:has-text("${label}"), button:has-text("${label}"), [role="option"]:has-text("${label}")`
      );
      if (radioOrLink && (await radioOrLink.isVisible().catch(() => false))) {
        await radioOrLink.click();
        console.log(`  [EnerGov Filer] Clicked permit type option: ${label}`);
        selected = true;
        await page.waitForTimeout(STEP_WAIT_MS);
        break;
      }
    }
  }

  if (filingData.permit_subtype) {
    const subtypeSelectors = [
      'select[id*="subtype" i]',
      'select[name*="subtype" i]',
      'select[id*="sub" i][id*="type" i]',
      'select[id*="workType" i]',
    ];
    await selectDropdown(page, subtypeSelectors, filingData.permit_subtype);
  }

  return { step: "permit_type_selection", success: selected };
}

async function fillPropertyInfo(page, filingData) {
  console.log("  [EnerGov Filer] Step: Property / Address Information");

  const addressSelectors = [
    'input[id*="address" i]',
    'input[name*="address" i]',
    'input[id*="property" i]',
    'input[name*="property" i]',
    'input[id*="location" i]',
    'input[placeholder*="address" i]',
    'input[aria-label*="address" i]',
    'input[placeholder*="search" i][id*="address" i]',
  ];
  const addressFilled = await fillField(page, addressSelectors, filingData.property_address);

  if (addressFilled) {
    const searchBtnSelectors = [
      'button:has-text("Search")',
      'button:has-text("Look Up")',
      'button:has-text("Verify")',
      'button:has-text("Find")',
      'input[value="Search"]',
      '[data-action="search"]',
      'button[aria-label*="search" i]',
    ];
    for (const sel of searchBtnSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click();
        await waitForSpaNavigation(page, 10000);
        break;
      }
    }

    await page.waitForTimeout(2000);

    const resultSelectors = [
      'button:has-text("Select")',
      'a:has-text("Select")',
      'button:has-text("Confirm")',
      '[data-action="select-address"]',
      'tr:first-child td a',
      '.search-result:first-child',
      '[class*="result" i]:first-child',
    ];
    for (const sel of resultSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click();
        console.log(`  [EnerGov Filer] Selected address result: ${sel}`);
        await page.waitForTimeout(STEP_WAIT_MS);
        break;
      }
    }
  }

  const projectNameSelectors = [
    'input[id*="project" i][id*="name" i]',
    'input[name*="project" i][name*="name" i]',
    'input[id*="projectName" i]',
    'input[placeholder*="project name" i]',
    'input[placeholder*="description" i]',
  ];
  const projectName = filingData.project_name || filingData.property_address;
  await fillField(page, projectNameSelectors, projectName);

  return { step: "property_info", success: addressFilled };
}

async function fillScopeOfWork(page, filingData) {
  console.log("  [EnerGov Filer] Step: Scope of Work / Description");

  const scopeSelectors = [
    'textarea[id*="scope" i]',
    'textarea[name*="scope" i]',
    'textarea[id*="description" i]',
    'textarea[name*="description" i]',
    'textarea[placeholder*="scope" i]',
    'textarea[placeholder*="description" i]',
    'textarea[placeholder*="work" i]',
    'textarea[id*="work" i]',
    "#scopeOfWork",
    "#projectDescription",
    "#description",
  ];

  const scope = filingData.scope_of_work || "";
  let filled = await fillField(page, scopeSelectors, scope);

  if (!filled) {
    const inputSelectors = [
      'input[id*="scope" i]',
      'input[name*="scope" i]',
      'input[id*="description" i]',
      'input[name*="description" i]',
      'input[placeholder*="scope" i]',
      'input[placeholder*="description" i]',
    ];
    filled = await fillField(page, inputSelectors, scope);
  }

  return { step: "scope_of_work", success: filled || !scope };
}

async function fillConstructionCost(page, filingData) {
  console.log("  [EnerGov Filer] Step: Construction Cost / Value");

  const costSelectors = [
    'input[id*="cost" i]',
    'input[name*="cost" i]',
    'input[id*="value" i][id*="construct" i]',
    'input[name*="value" i]',
    'input[id*="constructionValue" i]',
    'input[id*="constructionCost" i]',
    'input[id*="estimatedCost" i]',
    'input[placeholder*="cost" i]',
    'input[placeholder*="value" i]',
    'input[type="number"][id*="cost" i]',
    'input[type="number"][id*="value" i]',
  ];

  const costValue = filingData.construction_value || filingData.estimated_fee || "";
  const filled = await fillField(page, costSelectors, String(costValue));

  return { step: "construction_cost", success: filled || !costValue };
}

async function fillProfessionalInfo(page, filingData) {
  console.log("  [EnerGov Filer] Step: Professional / Contact Information");

  const professionals = filingData.professionals || [];
  const results = [];

  const roleFieldMappings = {
    expediter: {
      license: ['input[id*="expediter" i]', 'input[name*="expediter" i]', 'input[id*="registration" i]'],
      name: ['input[id*="expediter" i][id*="name" i]', 'input[name*="expediter" i][name*="name" i]'],
    },
    architect: {
      license: ['input[id*="architect" i][id*="license" i]', 'input[name*="architect" i]', 'input[id*="archLicense" i]'],
      name: ['input[id*="architect" i][id*="name" i]', 'input[name*="architect" i][name*="name" i]'],
    },
    engineer: {
      license: ['input[id*="engineer" i][id*="license" i]', 'input[name*="engineer" i]', 'input[id*="engLicense" i]'],
      name: ['input[id*="engineer" i][id*="name" i]', 'input[name*="engineer" i][name*="name" i]'],
    },
    contractor: {
      license: ['input[id*="contractor" i][id*="license" i]', 'input[name*="contractor" i]', 'input[id*="contractorLicense" i]'],
      name: ['input[id*="contractor" i][id*="name" i]', 'input[name*="contractor" i][name*="name" i]'],
    },
  };

  for (const prof of professionals) {
    const role = (prof.role_on_project || "").toLowerCase();
    const mapping = roleFieldMappings[role];

    if (mapping) {
      const licenseFilled = await fillField(page, mapping.license, prof.license_number);
      await fillField(page, mapping.name, prof.professional_name);
      results.push({ role, name: prof.professional_name, filled: licenseFilled });
    } else {
      const genericSelectors = [
        `input[id*="${role}" i]`,
        `input[name*="${role}" i]`,
      ];
      const filled = await fillField(page, genericSelectors, prof.license_number);
      results.push({ role: prof.role_on_project, name: prof.professional_name, filled });
    }
  }

  const applicantName = filingData.applicant_name || "";
  if (applicantName) {
    const applicantSelectors = [
      'input[id*="applicant" i][id*="name" i]',
      'input[name*="applicant" i]',
      'input[id*="contact" i][id*="name" i]',
      'input[placeholder*="applicant" i]',
      'input[placeholder*="name" i]',
    ];
    await fillField(page, applicantSelectors, applicantName);
  }

  const applicantEmail = filingData.applicant_email || "";
  if (applicantEmail) {
    const emailSelectors = [
      'input[id*="email" i]',
      'input[name*="email" i]',
      'input[type="email"]',
      'input[placeholder*="email" i]',
    ];
    await fillField(page, emailSelectors, applicantEmail);
  }

  const applicantPhone = filingData.applicant_phone || "";
  if (applicantPhone) {
    const phoneSelectors = [
      'input[id*="phone" i]',
      'input[name*="phone" i]',
      'input[type="tel"]',
      'input[placeholder*="phone" i]',
    ];
    await fillField(page, phoneSelectors, applicantPhone);
  }

  return { step: "professional_info", success: true, professionals: results };
}

async function uploadDocuments(page, filingData) {
  console.log("  [EnerGov Filer] Step: Document Upload");

  const documents = filingData.documents || [];
  const results = [];

  if (documents.length === 0) {
    console.log("  [EnerGov Filer] No documents to upload");
    return { step: "document_upload", success: true, documents: [] };
  }

  const sortedDocs = [...documents].sort(
    (a, b) => (a.upload_order || 999) - (b.upload_order || 999)
  );

  for (const doc of sortedDocs) {
    console.log(`  [EnerGov Filer] Uploading: ${doc.document_name} (${doc.document_type})`);

    const fileInputSelectors = [
      'input[type="file"]',
      'input[accept*="pdf"]',
      'input[accept*="image"]',
      '[data-action="upload"]',
    ];

    let uploaded = false;
    for (const sel of fileInputSelectors) {
      const fileInput = await page.$(sel);
      if (fileInput) {
        if (doc.file_url && doc.file_url.startsWith("/")) {
          try {
            await fileInput.setInputFiles(doc.file_url);
            uploaded = true;
            console.log(`  [EnerGov Filer] File input set for: ${doc.document_name}`);
          } catch (err) {
            console.log(`  [EnerGov Filer] File upload failed: ${err.message}`);
          }
        } else if (doc.file_url) {
          console.log(`  [EnerGov Filer] Remote file URL — manual upload may be needed: ${doc.file_url}`);
          uploaded = false;
        }
        break;
      }
    }

    if (uploaded) {
      const uploadBtnSelectors = [
        'button:has-text("Upload")',
        'button:has-text("Add")',
        'button:has-text("Attach")',
        'input[value="Upload"]',
        '[data-action="upload-file"]',
      ];
      for (const sel of uploadBtnSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible().catch(() => false))) {
          await btn.click();
          await waitForSpaNavigation(page, 10000);
          break;
        }
      }
    }

    if (doc.document_type) {
      const docTypeSelectors = [
        'select[id*="document" i][id*="type" i]',
        'select[name*="document" i][name*="type" i]',
        'select[id*="docType" i]',
        'select[id*="fileType" i]',
      ];
      await selectDropdown(page, docTypeSelectors, doc.document_type);
    }

    results.push({
      document_name: doc.document_name,
      document_type: doc.document_type,
      uploaded,
      upload_order: doc.upload_order,
    });
  }

  return { step: "document_upload", success: true, documents: results };
}

async function verifyReviewPage(page, filingData) {
  console.log("  [EnerGov Filer] Step: Review & Verify (STOP — do NOT submit)");

  const reviewIndicators = [
    'h1:has-text("Review")',
    'h2:has-text("Review")',
    'h3:has-text("Review")',
    'h1:has-text("Summary")',
    'h2:has-text("Summary")',
    '[class*="review" i]',
    '[id*="review" i]',
    '[class*="summary" i]',
    'button:has-text("Submit")',
    'input[value="Submit"]',
    '.wizard-step-review',
    '[data-step="review"]',
  ];

  let onReviewPage = false;
  for (const sel of reviewIndicators) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) {
      onReviewPage = true;
      break;
    }
  }

  const pageContent = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      headings: Array.from(document.querySelectorAll("h1, h2, h3")).map(
        (h) => h.textContent.trim()
      ),
      hasSubmitButton: !!document.querySelector(
        'button:not([disabled])[type="submit"], input[value="Submit"], button:not([disabled]):has(span)'
      ),
    };
  });

  return {
    step: "review_and_submit",
    success: true,
    on_review_page: onReviewPage,
    page_info: pageContent,
    stopped_before_submit: true,
  };
}

async function energovFile(sessionToken, filingData, config, supabase) {
  const baseUrl = (config && config.baseUrl) || "";
  console.log("  [EnerGov Filer] Starting EnerGov permit application filing");
  console.log(`  [EnerGov Filer] Filing ID: ${filingData.filing_id}`);
  console.log(`  [EnerGov Filer] Address: ${filingData.property_address}`);
  console.log(`  [EnerGov Filer] Base URL: ${baseUrl}`);

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
  const stepResults = [];
  const fieldAudits = {};

  try {
    const portalBase = baseUrl || session.baseUrl || "";
    const applyUrl = `${portalBase.replace(/\/$/, "")}/#/apply`;
    console.log(`  [EnerGov Filer] Navigating to ${applyUrl}`);
    await page.goto(applyUrl, {
      waitUntil: "networkidle",
      timeout: WIZARD_TIMEOUT,
    });
    await page.waitForTimeout(SPA_RENDER_WAIT_MS);

    const currentUrl = page.url();
    console.log(`  [EnerGov Filer] Landed on: ${currentUrl}`);

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

    const newAppSelectors = [
      'a:has-text("New Application")',
      'button:has-text("New Application")',
      'a:has-text("Apply")',
      'button:has-text("Apply")',
      'a:has-text("Start Application")',
      'button:has-text("Create")',
      'a:has-text("Create")',
      '[data-action="new-application"]',
      'a:has-text("Apply for a Permit")',
      'button:has-text("Apply for a Permit")',
    ];

    for (const sel of newAppSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        console.log(`  [EnerGov Filer] Clicking: ${sel}`);
        await btn.click();
        await waitForSpaNavigation(page, 15000);
        break;
      }
    }

    const initialScreenshot = await takeStepScreenshot(page, "initial_navigation", "form_filing");
    if (initialScreenshot) screenshots.push(initialScreenshot);

    const stepHandlers = [
      { name: "permit_type_selection", handler: fillPermitType },
      { name: "property_info", handler: fillPropertyInfo },
      { name: "scope_of_work", handler: fillScopeOfWork },
      { name: "professional_info", handler: fillProfessionalInfo },
      { name: "construction_cost", handler: fillConstructionCost },
      { name: "document_upload", handler: uploadDocuments },
      { name: "review_and_submit", handler: verifyReviewPage },
    ];

    for (let i = 0; i < stepHandlers.length; i++) {
      const step = stepHandlers[i];
      console.log(`\n  [EnerGov Filer] === Step ${i + 1}/${stepHandlers.length}: ${step.name} ===`);

      try {
        const preAudit = await captureFieldAudit(page);

        const result = await step.handler(page, filingData);
        stepResults.push(result);

        const postAudit = await captureFieldAudit(page);
        fieldAudits[step.name] = {
          before: preAudit,
          after: postAudit,
          fields_filled: Object.keys(postAudit).filter(
            (k) => postAudit[k].filled && (!preAudit[k] || !preAudit[k].filled)
          ),
        };

        const stepScreenshot = await takeStepScreenshot(
          page,
          step.name,
          "form_filing"
        );
        if (stepScreenshot) {
          stepScreenshot.field_audit = fieldAudits[step.name];
          screenshots.push(stepScreenshot);
        }

        if (step.name === "review_and_submit") {
          console.log("  [EnerGov Filer] Reached review page — stopping before submit");
          break;
        }

        const advanced = await clickNextButton(page);
        if (!advanced) {
          console.log(`  [EnerGov Filer] No next button found after ${step.name} — may be single-page form`);
        }
      } catch (stepErr) {
        console.log(`  [EnerGov Filer] Error in step ${step.name}: ${stepErr.message}`);
        stepResults.push({
          step: step.name,
          success: false,
          error: stepErr.message,
        });

        const errScreenshot = await takeStepScreenshot(page, `${step.name}_error`, "form_filing");
        if (errScreenshot) screenshots.push(errScreenshot);
      }
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

    console.log("  [EnerGov Filer] Form filing automation complete");

    return {
      success: true,
      steps: stepResults,
      screenshots,
      field_audits: fieldAudits,
      stopped_before_submit: true,
      portal_type: "energov",
      base_url: portalBase,
    };
  } catch (err) {
    console.error(`  [EnerGov Filer] Fatal error: ${err.message}`);

    const errorScreenshot = await takeStepScreenshot(page, "fatal_error", "form_filing").catch(() => null);
    if (errorScreenshot) screenshots.push(errorScreenshot);

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
      error: "filing_error",
      message: err.message,
      steps: stepResults,
      screenshots,
    };
  }
}

module.exports = {
  energovFile,
  fillPermitType,
  fillPropertyInfo,
  fillScopeOfWork,
  fillProfessionalInfo,
  fillConstructionCost,
  uploadDocuments,
  verifyReviewPage,
};
