const path = require("path");
const { getSession, PERMITWIZARD_URL, ACCELA_PORTAL_CONFIGS } = require("./permitwizard-auth");

const WIZARD_TIMEOUT = 30000;
const STEP_WAIT_MS = 2000;
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

const DEFAULT_PORTAL_CONFIG = {
  baseUrl: PERMITWIZARD_URL,
  jurisdictionLabel: "DC DOB",
  permitTypeMap: null,
  selectors: {},
};

const JURISDICTION_PERMIT_TYPE_MAPS = {
  dc_dob: {
    residential: ["Residential", "Building - Residential", "Homeowner"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    solar: ["Solar", "Solar Panel", "Renewable Energy"],
    demolition: ["Demolition", "Demo"],
    raze: ["Raze", "Razing"],
  },
  fairfax_county_va: {
    residential: ["Residential", "Building - Residential", "Residential Building"],
    commercial: ["Commercial", "Building - Commercial", "Commercial Building"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    demolition: ["Demolition", "Demo"],
    grading: ["Grading", "Land Disturbance"],
  },
  baltimore_city_md: {
    residential: ["Residential", "Building - Residential"],
    commercial: ["Commercial", "Building - Commercial"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    demolition: ["Demolition", "Demo", "Razing"],
    use_and_occupancy: ["Use & Occupancy", "U&O"],
  },
  howard_county_md: {
    residential: ["Residential", "Building - Residential"],
    commercial: ["Commercial", "Building - Commercial"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    grading: ["Grading", "Grading Permit"],
    demolition: ["Demolition", "Demo"],
  },
  arlington_county_va: {
    residential: ["Residential", "Building - Residential"],
    commercial: ["Commercial", "Building - Commercial"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    demolition: ["Demolition", "Demo"],
    sign: ["Sign", "Sign Permit"],
  },
  anne_arundel_county_md: {
    residential: ["Residential", "Building - Residential"],
    commercial: ["Commercial", "Building - Commercial"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    demolition: ["Demolition", "Demo"],
    grading: ["Grading", "Grading Permit"],
  },
};

function resolvePortalConfig(portalConfig) {
  const config = { ...DEFAULT_PORTAL_CONFIG, ...portalConfig };
  if (!config.permitTypeMap && config.municipalityKey) {
    config.permitTypeMap = JURISDICTION_PERMIT_TYPE_MAPS[config.municipalityKey] || null;
  }
  if (!config.permitTypeMap) {
    config.permitTypeMap = JURISDICTION_PERMIT_TYPE_MAPS.dc_dob;
  }
  return config;
}

const WIZARD_STEPS = [
  "address_confirmation",
  "permit_type_selection",
  "scope_of_work",
  "professional_identification",
  "construction_cost",
  "document_upload",
  "review_and_submit",
];

async function takeStepScreenshot(page, stepName, agentName, jurisdictionLabel) {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    const base64 = buffer.toString("base64");
    const url = `data:image/png;base64,${base64}`;
    const label = jurisdictionLabel || "DC DOB";
    const qualifiedStepName = `${label}_${stepName}`;
    console.log(`  [Filer] Screenshot captured: ${qualifiedStepName} (${Math.round(base64.length / 1024)}KB)`);
    return {
      step_name: qualifiedStepName,
      agent_name: agentName || "form_filing",
      screenshot_url: url,
      captured_at: new Date().toISOString(),
      jurisdiction: label,
    };
  } catch (err) {
    console.log(`  [Filer] Screenshot failed for ${stepName}: ${err.message}`);
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

async function waitForWizardStep(page, stepIndicators, timeoutMs) {
  const timeout = timeoutMs || WIZARD_TIMEOUT;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const indicator of stepIndicators) {
      const el = await page.$(indicator);
      if (el && (await el.isVisible().catch(() => false))) {
        return true;
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function clickNextButton(page) {
  const nextSelectors = [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'input[value="Next"]',
    'input[value="Continue"]',
    'a:has-text("Next")',
    'button[type="submit"]:has-text("Next")',
    'button.btn-primary:has-text("Next")',
    '[data-action="next"]',
    ".wizard-next",
    ".btn-next",
  ];

  for (const sel of nextSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      const isDisabled = await btn.evaluate(
        (el) => el.disabled || el.classList.contains("disabled")
      );
      if (!isDisabled) {
        console.log(`  [Filer] Clicking next button: ${sel}`);
        await btn.click();
        await page.waitForTimeout(STEP_WAIT_MS);
        await page.waitForLoadState("networkidle").catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function fillField(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const field = await page.$(sel);
    if (field && (await field.isVisible().catch(() => false))) {
      await field.fill("");
      await field.fill(String(value));
      console.log(`  [Filer] Filled field: ${sel} = "${String(value).substring(0, 50)}"`);
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
        console.log(`  [Filer] Selected dropdown: ${sel} = "${value}"`);
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
              console.log(`  [Filer] Selected dropdown (fuzzy): ${sel} = "${text}"`);
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

async function fillAddressConfirmation(page, filingData) {
  console.log("  [Filer] Step 1: Address Confirmation");

  const addressSelectors = [
    'input[id*="address" i]',
    'input[name*="address" i]',
    'input[id*="property" i]',
    'input[name*="property" i]',
    'input[id*="location" i]',
    'input[placeholder*="address" i]',
    'input[aria-label*="address" i]',
  ];
  await fillField(page, addressSelectors, filingData.property_address);

  const projectNameSelectors = [
    'input[id*="project" i][id*="name" i]',
    'input[name*="project" i][name*="name" i]',
    'input[id*="projectName" i]',
    'input[name*="projectName" i]',
    'input[placeholder*="project name" i]',
  ];
  const projectName = filingData.project_name || filingData.property_address;
  await fillField(page, projectNameSelectors, projectName);

  const searchBtnSelectors = [
    'button:has-text("Search")',
    'button:has-text("Look Up")',
    'button:has-text("Verify")',
    'input[value="Search"]',
    '[data-action="search"]',
  ];
  for (const sel of searchBtnSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle").catch(() => {});
      break;
    }
  }

  const confirmSelectors = [
    'button:has-text("Confirm")',
    'button:has-text("Select")',
    'a:has-text("Select this address")',
    '[data-action="confirm-address"]',
  ];
  for (const sel of confirmSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await page.waitForTimeout(STEP_WAIT_MS);
      break;
    }
  }

  return { step: "address_confirmation", success: true };
}

async function fillPermitTypeSelection(page, filingData, portalConfig) {
  console.log("  [Filer] Step 2: Permit Type Selection");

  const config = portalConfig || {};
  const permitTypeMap = config.permitTypeMap || JURISDICTION_PERMIT_TYPE_MAPS.dc_dob;

  const permitType = filingData.permit_type || "residential";
  const typeLabels = permitTypeMap[permitType] || [permitType];

  const typeSelectors = [
    'select[id*="permit" i][id*="type" i]',
    'select[name*="permit" i][name*="type" i]',
    'select[id*="permitType" i]',
    'select[name*="permitType" i]',
    'select[id*="type" i]',
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
        `input[type="radio"][value*="${label}" i], label:has-text("${label}"), a:has-text("${label}"), button:has-text("${label}")`
      );
      if (radioOrLink && (await radioOrLink.isVisible().catch(() => false))) {
        await radioOrLink.click();
        console.log(`  [Filer] Clicked permit type option: ${label}`);
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
    ];
    await selectDropdown(page, subtypeSelectors, filingData.permit_subtype);
  }

  if (filingData.review_track) {
    const trackLabel = filingData.review_track === "walk_through" ? "Walk-Through" : "ProjectDox";
    const trackSelectors = [
      'select[id*="review" i]',
      'select[id*="track" i]',
      'select[name*="review" i]',
    ];
    await selectDropdown(page, trackSelectors, trackLabel);
  }

  return { step: "permit_type_selection", success: selected };
}

async function fillScopeOfWork(page, filingData) {
  console.log("  [Filer] Step 3: Scope of Work");

  const scopeSelectors = [
    'textarea[id*="scope" i]',
    'textarea[name*="scope" i]',
    'textarea[id*="description" i]',
    'textarea[name*="description" i]',
    'textarea[placeholder*="scope" i]',
    'textarea[placeholder*="description" i]',
    'textarea[id*="work" i]',
    "#scopeOfWork",
    "#projectDescription",
  ];

  const scope = filingData.scope_of_work || "";
  const filled = await fillField(page, scopeSelectors, scope);

  if (!filled) {
    const inputSelectors = [
      'input[id*="scope" i]',
      'input[name*="scope" i]',
      'input[id*="description" i]',
      'input[name*="description" i]',
    ];
    await fillField(page, inputSelectors, scope);
  }

  return { step: "scope_of_work", success: true };
}

async function fillProfessionalIdentification(page, filingData) {
  console.log("  [Filer] Step 4: Professional Identification");

  const professionals = filingData.professionals || [];
  const results = [];

  const expediterRegSelectors = [
    'input[id*="expediter" i]',
    'input[name*="expediter" i]',
    'input[id*="registration" i]',
    'input[id*="regNumber" i]',
  ];

  const expediter = professionals.find(
    (p) =>
      p.role_on_project === "expediter" ||
      p.license_type === "expediter" ||
      (p.role_on_project || "").toLowerCase().includes("expedit")
  );
  if (expediter) {
    const filled = await fillField(
      page,
      expediterRegSelectors,
      expediter.license_number
    );
    results.push({
      role: "expediter",
      name: expediter.professional_name,
      filled,
    });

    const expediterNameSelectors = [
      'input[id*="expediter" i][id*="name" i]',
      'input[name*="expediter" i][name*="name" i]',
    ];
    await fillField(page, expediterNameSelectors, expediter.professional_name);
  }

  const architect = professionals.find(
    (p) =>
      p.role_on_project === "architect" ||
      p.license_type === "architect" ||
      (p.role_on_project || "").toLowerCase().includes("architect")
  );
  if (architect) {
    const archSelectors = [
      'input[id*="architect" i][id*="license" i]',
      'input[name*="architect" i]',
      'input[id*="archLicense" i]',
      'input[id*="architect" i][id*="number" i]',
    ];
    const filled = await fillField(page, archSelectors, architect.license_number);
    results.push({
      role: "architect",
      name: architect.professional_name,
      filled,
    });

    const archNameSelectors = [
      'input[id*="architect" i][id*="name" i]',
      'input[name*="architect" i][name*="name" i]',
    ];
    await fillField(page, archNameSelectors, architect.professional_name);
  }

  const engineer = professionals.find(
    (p) =>
      p.role_on_project === "engineer" ||
      p.license_type === "engineer" ||
      (p.role_on_project || "").toLowerCase().includes("engineer")
  );
  if (engineer) {
    const engSelectors = [
      'input[id*="engineer" i][id*="license" i]',
      'input[name*="engineer" i]',
      'input[id*="engLicense" i]',
      'input[id*="engineer" i][id*="number" i]',
    ];
    const filled = await fillField(page, engSelectors, engineer.license_number);
    results.push({
      role: "engineer",
      name: engineer.professional_name,
      filled,
    });
  }

  const contractor = professionals.find(
    (p) =>
      p.role_on_project === "contractor" ||
      p.license_type === "contractor" ||
      (p.role_on_project || "").toLowerCase().includes("contractor")
  );
  if (contractor) {
    const contractorSelectors = [
      'input[id*="contractor" i][id*="license" i]',
      'input[name*="contractor" i]',
      'input[id*="contractorLicense" i]',
      'input[id*="contractor" i][id*="number" i]',
    ];
    const filled = await fillField(
      page,
      contractorSelectors,
      contractor.license_number
    );
    results.push({
      role: "contractor",
      name: contractor.professional_name,
      filled,
    });

    const contractorNameSelectors = [
      'input[id*="contractor" i][id*="name" i]',
      'input[name*="contractor" i][name*="name" i]',
    ];
    await fillField(page, contractorNameSelectors, contractor.professional_name);
  }

  for (const prof of professionals) {
    if (
      ["expediter", "architect", "engineer", "contractor"].includes(
        (prof.role_on_project || "").toLowerCase()
      )
    ) {
      continue;
    }
    const genericSelectors = [
      `input[id*="${(prof.role_on_project || "").toLowerCase()}" i]`,
      `input[name*="${(prof.role_on_project || "").toLowerCase()}" i]`,
    ];
    const filled = await fillField(page, genericSelectors, prof.license_number);
    results.push({
      role: prof.role_on_project,
      name: prof.professional_name,
      filled,
    });
  }

  return { step: "professional_identification", success: true, professionals: results };
}

async function fillConstructionCost(page, filingData) {
  console.log("  [Filer] Step 5: Construction Cost");

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
  ];

  const costValue = filingData.construction_value || filingData.estimated_fee || "";
  const filled = await fillField(page, costSelectors, String(costValue));

  const propertyTypeSelectors = [
    'select[id*="property" i][id*="type" i]',
    'select[name*="property" i]',
    'select[id*="propertyType" i]',
  ];
  if (filingData.property_type) {
    await selectDropdown(page, propertyTypeSelectors, filingData.property_type);
  }

  return { step: "construction_cost", success: filled };
}

async function uploadDocuments(page, filingData) {
  console.log("  [Filer] Step 6: Document Upload");

  const documents = filingData.documents || [];
  const results = [];

  if (documents.length === 0) {
    console.log("  [Filer] No documents to upload");
    return { step: "document_upload", success: true, documents: [] };
  }

  const sortedDocs = [...documents].sort(
    (a, b) => (a.upload_order || 999) - (b.upload_order || 999)
  );

  for (const doc of sortedDocs) {
    console.log(`  [Filer] Uploading: ${doc.document_name} (${doc.document_type})`);

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
            console.log(`  [Filer] File input set for: ${doc.document_name}`);
          } catch (err) {
            console.log(`  [Filer] File upload failed: ${err.message}`);
          }
        } else if (doc.file_url) {
          console.log(`  [Filer] Remote file URL — manual upload may be needed: ${doc.file_url}`);
          uploaded = false;
        }
        break;
      }
    }

    if (uploaded) {
      const uploadBtnSelectors = [
        'button:has-text("Upload")',
        'input[value="Upload"]',
        'button:has-text("Add")',
        '[data-action="upload-file"]',
      ];
      for (const sel of uploadBtnSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible().catch(() => false))) {
          await btn.click();
          await page.waitForTimeout(3000);
          await page.waitForLoadState("networkidle").catch(() => {});
          break;
        }
      }
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
  console.log("  [Filer] Step 7: Review & Submit (STOP — do NOT submit)");

  const reviewIndicators = [
    'h1:has-text("Review")',
    'h2:has-text("Review")',
    'h3:has-text("Review")',
    '[class*="review" i]',
    '[id*="review" i]',
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
        'button:not([disabled])[type="submit"], input[value="Submit"]'
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

async function permitWizardFile(sessionToken, filingData, supabase, portalConfig) {
  const config = resolvePortalConfig(portalConfig || {});
  const jLabel = config.jurisdictionLabel;

  console.log(`  [Filer] Starting form filing automation for ${jLabel}`);
  console.log(`  [Filer] Filing ID: ${filingData.filing_id}`);
  console.log(`  [Filer] Address: ${filingData.property_address}`);

  const session = getSession(sessionToken);
  if (!session) {
    return {
      success: false,
      error: "session_not_found",
      message: "Session not found or expired. Re-authenticate first.",
    };
  }

  const page = session.page;
  const context = session.context;
  const screenshots = [];
  const stepResults = [];
  const fieldAudits = {};

  try {
    const baseUrl = config.baseUrl || PERMITWIZARD_URL;
    console.log(`  [Filer] Navigating to application page at ${baseUrl}...`);
    const applyUrl = baseUrl + "/apply";
    await page.goto(applyUrl, {
      waitUntil: "networkidle",
      timeout: WIZARD_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`  [Filer] Landed on: ${currentUrl}`);

    if (
      currentUrl.includes("SessionEnded") ||
      currentUrl.includes("login") ||
      currentUrl.includes("b2clogin")
    ) {
      return {
        success: false,
        error: "session_expired",
        message: "Portal session expired. Re-authenticate and try again.",
        requiresReauth: true,
      };
    }

    const newAppSelectors = [
      'a:has-text("New Application")',
      'button:has-text("New Application")',
      'a:has-text("Apply")',
      'button:has-text("Apply")',
      'a:has-text("Start Application")',
      'button:has-text("Start")',
      '[data-action="new-application"]',
    ];

    for (const sel of newAppSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        console.log(`  [Filer] Clicking: ${sel}`);
        await btn.click();
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle").catch(() => {});
        break;
      }
    }

    const initialScreenshot = await takeStepScreenshot(page, "initial_navigation", "form_filing", jLabel);
    if (initialScreenshot) screenshots.push(initialScreenshot);

    const stepHandlers = [
      { name: "address_confirmation", handler: fillAddressConfirmation },
      { name: "permit_type_selection", handler: (p, fd) => fillPermitTypeSelection(p, fd, config) },
      { name: "scope_of_work", handler: fillScopeOfWork },
      { name: "professional_identification", handler: fillProfessionalIdentification },
      { name: "construction_cost", handler: fillConstructionCost },
      { name: "document_upload", handler: uploadDocuments },
      { name: "review_and_submit", handler: verifyReviewPage },
    ];

    for (let i = 0; i < stepHandlers.length; i++) {
      const step = stepHandlers[i];
      console.log(`\n  [Filer] === Step ${i + 1}/${stepHandlers.length}: ${step.name} ===`);

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
          "form_filing",
          jLabel
        );
        if (stepScreenshot) {
          stepScreenshot.field_audit = fieldAudits[step.name];
          screenshots.push(stepScreenshot);
        }

        if (step.name === "review_and_submit") {
          console.log("  [Filer] Reached Review & Submit — STOPPING (not submitting)");
          break;
        }

        const advanced = await clickNextButton(page);
        if (!advanced) {
          console.log(`  [Filer] Could not advance past step: ${step.name}`);
          const errorEls = await page.$$('.error, .alert-danger, [class*="error" i], .validation-error');
          const errors = [];
          for (const el of errorEls) {
            const text = (await el.textContent().catch(() => "")).trim();
            if (text) errors.push(text);
          }
          if (errors.length > 0) {
            console.log(`  [Filer] Validation errors: ${errors.join("; ")}`);
            stepResults[stepResults.length - 1].errors = errors;
          }
        }
      } catch (stepErr) {
        console.error(`  [Filer] Error in step ${step.name}: ${stepErr.message}`);
        stepResults.push({
          step: step.name,
          success: false,
          error: stepErr.message,
        });

        const errorScreenshot = await takeStepScreenshot(
          page,
          `${step.name}_error`,
          "form_filing",
          jLabel
        );
        if (errorScreenshot) screenshots.push(errorScreenshot);
      }
    }

    if (supabase && filingData.filing_id) {
      try {
        for (const ss of screenshots) {
          await supabase.from("filing_screenshots").insert({
            filing_id: filingData.filing_id,
            agent_name: ss.agent_name,
            step_name: ss.step_name,
            screenshot_url: ss.screenshot_url,
            field_audit: ss.field_audit || null,
          });
        }
        console.log(`  [Filer] Saved ${screenshots.length} screenshots to database`);
      } catch (dbErr) {
        console.log(`  [Filer] Error saving screenshots: ${dbErr.message}`);
      }

      try {
        await supabase
          .from("permit_filings")
          .update({
            filing_status: "filing",
            updated_at: new Date().toISOString(),
          })
          .eq("id", filingData.filing_id);
      } catch (dbErr) {
        console.log(`  [Filer] Error updating filing status: ${dbErr.message}`);
      }
    }

    const allStepsSucceeded = stepResults.every((r) => r.success !== false);

    return {
      success: allStepsSucceeded,
      filing_id: filingData.filing_id,
      steps: stepResults,
      screenshots: screenshots.map((s) => ({
        step_name: s.step_name,
        captured_at: s.captured_at,
        has_screenshot: !!s.screenshot_url,
      })),
      field_audits: fieldAudits,
      stopped_before_submit: true,
      message: allStepsSucceeded
        ? "All wizard steps completed. Stopped at Review & Submit page — awaiting finalization."
        : "Some wizard steps encountered issues. Review step results for details.",
    };
  } catch (err) {
    console.error(`  [Filer] Fatal error: ${err.message}`);

    const errorScreenshot = await takeStepScreenshot(page, "fatal_error", "form_filing", jLabel);
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
    }

    return {
      success: false,
      error: "filing_error",
      message: err.message,
      filing_id: filingData.filing_id,
      steps: stepResults,
      screenshots: screenshots.map((s) => ({
        step_name: s.step_name,
        captured_at: s.captured_at,
      })),
    };
  }
}

module.exports = {
  permitWizardFile,
  WIZARD_STEPS,
  JURISDICTION_PERMIT_TYPE_MAPS,
  resolvePortalConfig,
  DEFAULT_PORTAL_CONFIG,
};
