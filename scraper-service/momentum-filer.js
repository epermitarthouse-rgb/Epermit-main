const { getMomentumSession, MOMENTUM_BASE_URL } = require("./momentum-auth");

const WIZARD_TIMEOUT = 30000;
const STEP_WAIT_MS = 2000;

const WIZARD_STEPS = [
  "address_confirmation",
  "permit_type_selection",
  "scope_of_work",
  "professional_identification",
  "construction_cost",
  "document_upload",
  "review_and_submit",
];

async function takeStepScreenshot(page, stepName, agentName) {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    const base64 = buffer.toString("base64");
    const url = `data:image/png;base64,${base64}`;
    console.log(`  [Momentum Filer] Screenshot captured: ${stepName} (${Math.round(base64.length / 1024)}KB)`);
    return {
      step_name: stepName,
      agent_name: agentName || "momentum_form_filing",
      screenshot_url: url,
      captured_at: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`  [Momentum Filer] Screenshot failed for ${stepName}: ${err.message}`);
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

async function waitForElement(page, selectors, timeoutMs) {
  const timeout = timeoutMs || WIZARD_TIMEOUT;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        return el;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
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
    'button:has-text("Save and Continue")',
    'a:has-text("Save and Continue")',
  ];

  for (const sel of nextSelectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      const isDisabled = await btn.evaluate(
        (el) => el.disabled || el.classList.contains("disabled")
      );
      if (!isDisabled) {
        console.log(`  [Momentum Filer] Clicking next button: ${sel}`);
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
      console.log(`  [Momentum Filer] Filled field: ${sel} = "${String(value).substring(0, 50)}"`);
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
        console.log(`  [Momentum Filer] Selected dropdown: ${sel} = "${value}"`);
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
              console.log(`  [Momentum Filer] Selected dropdown (fuzzy): ${sel} = "${text}"`);
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
  console.log("  [Momentum Filer] Step 1: Address Confirmation");

  const addressSelectors = [
    'input[id*="address" i]',
    'input[name*="address" i]',
    'input[id*="property" i]',
    'input[name*="property" i]',
    'input[id*="location" i]',
    'input[placeholder*="address" i]',
    'input[aria-label*="address" i]',
    'input[id*="street" i]',
    'input[name*="street" i]',
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
    'button:has-text("Find")',
    'input[value="Search"]',
    'input[value="Find"]',
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
    'a:has-text("Select")',
    '[data-action="confirm-address"]',
    'button:has-text("Use this address")',
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

async function fillPermitTypeSelection(page, filingData) {
  console.log("  [Momentum Filer] Step 2: Permit Type Selection");

  const permitTypeMap = {
    residential: ["Residential", "Building - Residential", "Residential Building"],
    commercial: ["Commercial", "Building - Commercial", "Commercial Building"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    solar: ["Solar", "Solar Panel", "Renewable Energy"],
    demolition: ["Demolition", "Demo", "Razing"],
    addition: ["Addition", "Addition/Alteration"],
    alteration: ["Alteration", "Interior Alteration"],
    fence: ["Fence", "Fence/Wall"],
    deck: ["Deck", "Deck/Porch"],
    use_and_occupancy: ["Use and Occupancy", "Use & Occupancy", "U&O"],
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
        `input[type="radio"][value*="${label}" i], label:has-text("${label}"), a:has-text("${label}"), button:has-text("${label}")`
      );
      if (radioOrLink && (await radioOrLink.isVisible().catch(() => false))) {
        await radioOrLink.click();
        console.log(`  [Momentum Filer] Clicked permit type option: ${label}`);
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

  return { step: "permit_type_selection", success: selected };
}

async function fillScopeOfWork(page, filingData) {
  console.log("  [Momentum Filer] Step 3: Scope of Work");

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
    'textarea[id*="detail" i]',
    'textarea[name*="detail" i]',
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
  console.log("  [Momentum Filer] Step 4: Professional Identification");

  const professionals = filingData.professionals || [];
  const results = [];

  const roleConfigs = [
    {
      role: "expediter",
      keywords: ["expedit"],
      licenseSelectors: [
        'input[id*="expediter" i]',
        'input[name*="expediter" i]',
        'input[id*="registration" i]',
        'input[id*="regNumber" i]',
      ],
      nameSelectors: [
        'input[id*="expediter" i][id*="name" i]',
        'input[name*="expediter" i][name*="name" i]',
      ],
    },
    {
      role: "architect",
      keywords: ["architect"],
      licenseSelectors: [
        'input[id*="architect" i][id*="license" i]',
        'input[name*="architect" i]',
        'input[id*="archLicense" i]',
        'input[id*="architect" i][id*="number" i]',
      ],
      nameSelectors: [
        'input[id*="architect" i][id*="name" i]',
        'input[name*="architect" i][name*="name" i]',
      ],
    },
    {
      role: "engineer",
      keywords: ["engineer"],
      licenseSelectors: [
        'input[id*="engineer" i][id*="license" i]',
        'input[name*="engineer" i]',
        'input[id*="engLicense" i]',
        'input[id*="engineer" i][id*="number" i]',
      ],
      nameSelectors: [
        'input[id*="engineer" i][id*="name" i]',
        'input[name*="engineer" i][name*="name" i]',
      ],
    },
    {
      role: "contractor",
      keywords: ["contractor"],
      licenseSelectors: [
        'input[id*="contractor" i][id*="license" i]',
        'input[name*="contractor" i]',
        'input[id*="contractorLicense" i]',
        'input[id*="contractor" i][id*="number" i]',
      ],
      nameSelectors: [
        'input[id*="contractor" i][id*="name" i]',
        'input[name*="contractor" i][name*="name" i]',
      ],
    },
    {
      role: "owner",
      keywords: ["owner"],
      licenseSelectors: [],
      nameSelectors: [
        'input[id*="owner" i][id*="name" i]',
        'input[name*="owner" i][name*="name" i]',
        'input[id*="owner" i]',
      ],
    },
  ];

  for (const config of roleConfigs) {
    const prof = professionals.find(
      (p) =>
        p.role_on_project === config.role ||
        p.license_type === config.role ||
        config.keywords.some((kw) =>
          (p.role_on_project || "").toLowerCase().includes(kw)
        )
    );
    if (!prof) continue;

    let filled = false;
    if (config.licenseSelectors.length > 0 && prof.license_number) {
      filled = await fillField(page, config.licenseSelectors, prof.license_number);
    }
    if (config.nameSelectors.length > 0 && prof.professional_name) {
      await fillField(page, config.nameSelectors, prof.professional_name);
    }
    results.push({
      role: config.role,
      name: prof.professional_name,
      filled,
    });
  }

  const knownRoles = roleConfigs.map((c) => c.role);
  for (const prof of professionals) {
    const role = (prof.role_on_project || "").toLowerCase();
    if (knownRoles.includes(role)) continue;
    const genericSelectors = [
      `input[id*="${role}" i]`,
      `input[name*="${role}" i]`,
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
  console.log("  [Momentum Filer] Step 5: Construction Cost");

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
    'input[id*="amount" i]',
    'input[name*="amount" i]',
  ];

  const costValue = filingData.construction_value || filingData.estimated_fee || "";
  const filled = await fillField(page, costSelectors, String(costValue));

  const propertyTypeSelectors = [
    'select[id*="property" i][id*="type" i]',
    'select[name*="property" i]',
    'select[id*="propertyType" i]',
    'select[id*="use" i]',
    'select[name*="use" i]',
  ];
  if (filingData.property_type) {
    await selectDropdown(page, propertyTypeSelectors, filingData.property_type);
  }

  return { step: "construction_cost", success: filled };
}

async function uploadDocuments(page, filingData) {
  console.log("  [Momentum Filer] Step 6: Document Upload");

  const documents = filingData.documents || [];
  const results = [];

  if (documents.length === 0) {
    console.log("  [Momentum Filer] No documents to upload");
    return { step: "document_upload", success: true, documents: [] };
  }

  const sortedDocs = [...documents].sort(
    (a, b) => (a.upload_order || 999) - (b.upload_order || 999)
  );

  for (const doc of sortedDocs) {
    console.log(`  [Momentum Filer] Uploading: ${doc.document_name} (${doc.document_type})`);

    const addDocSelectors = [
      'button:has-text("Add Document")',
      'button:has-text("Add File")',
      'button:has-text("Upload")',
      'a:has-text("Add Document")',
      'a:has-text("Upload Document")',
      '[data-action="add-document"]',
      '.btn-upload',
    ];

    for (const sel of addDocSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click();
        await page.waitForTimeout(STEP_WAIT_MS);
        break;
      }
    }

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
            console.log(`  [Momentum Filer] File input set for: ${doc.document_name}`);
          } catch (err) {
            console.log(`  [Momentum Filer] File upload failed: ${err.message}`);
          }
        } else if (doc.file_url) {
          console.log(`  [Momentum Filer] Remote file URL — manual upload may be needed: ${doc.file_url}`);
          uploaded = false;
        }
        break;
      }
    }

    if (uploaded) {
      const docTypeSelectors = [
        'select[id*="docType" i]',
        'select[name*="docType" i]',
        'select[id*="document" i][id*="type" i]',
        'select[name*="document" i][name*="type" i]',
        'select[id*="category" i]',
      ];
      if (doc.document_type) {
        await selectDropdown(page, docTypeSelectors, doc.document_type);
      }

      const uploadBtnSelectors = [
        'button:has-text("Upload")',
        'input[value="Upload"]',
        'button:has-text("Save")',
        'button:has-text("Attach")',
        '[data-action="upload-file"]',
        '[data-action="save-document"]',
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
  console.log("  [Momentum Filer] Step 7: Review & Submit (STOP — do NOT submit)");

  const reviewIndicators = [
    'h1:has-text("Review")',
    'h2:has-text("Review")',
    'h3:has-text("Review")',
    'h1:has-text("Summary")',
    'h2:has-text("Summary")',
    '[class*="review" i]',
    '[id*="review" i]',
    '[class*="summary" i]',
    '[id*="summary" i]',
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

async function momentumFile(page, sessionData, filingData, supabase) {
  console.log("  [Momentum Filer] Starting PG County Momentum form filing automation");
  console.log(`  [Momentum Filer] Filing ID: ${filingData.filing_id}`);
  console.log(`  [Momentum Filer] Address: ${filingData.property_address}`);

  const session = getMomentumSession(sessionData.sessionToken || sessionData);
  if (!session) {
    return {
      success: false,
      error: "session_not_found",
      message: "Momentum session not found or expired. Re-authenticate first.",
    };
  }

  const sessionPage = session.page;
  const screenshots = [];
  const stepResults = [];
  const fieldAudits = {};

  try {
    console.log("  [Momentum Filer] Navigating to Momentum application page...");
    const applyUrl = MOMENTUM_BASE_URL + "/apply";
    await sessionPage.goto(applyUrl, {
      waitUntil: "networkidle",
      timeout: WIZARD_TIMEOUT,
    });
    await sessionPage.waitForTimeout(3000);

    const currentUrl = sessionPage.url();
    console.log(`  [Momentum Filer] Landed on: ${currentUrl}`);

    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/Login") ||
      currentUrl.includes("session-expired") ||
      currentUrl.includes("SessionExpired")
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
      'a:has-text("Apply for a Permit")',
      'button:has-text("Apply for a Permit")',
      'a:has-text("Create New")',
      '[data-action="new-application"]',
    ];

    for (const sel of newAppSelectors) {
      const btn = await sessionPage.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        console.log(`  [Momentum Filer] Clicking: ${sel}`);
        await btn.click();
        await sessionPage.waitForTimeout(3000);
        await sessionPage.waitForLoadState("networkidle").catch(() => {});
        break;
      }
    }

    const initialScreenshot = await takeStepScreenshot(sessionPage, "initial_navigation", "momentum_form_filing");
    if (initialScreenshot) screenshots.push(initialScreenshot);

    const stepHandlers = [
      { name: "address_confirmation", handler: fillAddressConfirmation },
      { name: "permit_type_selection", handler: fillPermitTypeSelection },
      { name: "scope_of_work", handler: fillScopeOfWork },
      { name: "professional_identification", handler: fillProfessionalIdentification },
      { name: "construction_cost", handler: fillConstructionCost },
      { name: "document_upload", handler: uploadDocuments },
      { name: "review_and_submit", handler: verifyReviewPage },
    ];

    for (let i = 0; i < stepHandlers.length; i++) {
      const step = stepHandlers[i];
      console.log(`\n  [Momentum Filer] === Step ${i + 1}/${stepHandlers.length}: ${step.name} ===`);

      try {
        const preAudit = await captureFieldAudit(sessionPage);

        const result = await step.handler(sessionPage, filingData);
        stepResults.push(result);

        const postAudit = await captureFieldAudit(sessionPage);
        fieldAudits[step.name] = {
          before: preAudit,
          after: postAudit,
          fields_filled: Object.keys(postAudit).filter(
            (k) => postAudit[k].filled && (!preAudit[k] || !preAudit[k].filled)
          ),
        };

        const stepScreenshot = await takeStepScreenshot(
          sessionPage,
          `momentum_${step.name}`,
          "momentum_form_filing"
        );
        if (stepScreenshot) {
          stepScreenshot.field_audit = fieldAudits[step.name];
          screenshots.push(stepScreenshot);
        }

        if (step.name === "review_and_submit") {
          console.log("  [Momentum Filer] Reached review page — stopping before submit");
          break;
        }

        const navigated = await clickNextButton(sessionPage);
        if (!navigated) {
          console.log(`  [Momentum Filer] Could not navigate past step ${step.name} — continuing anyway`);
        }
      } catch (stepErr) {
        console.log(`  [Momentum Filer] Error in step ${step.name}: ${stepErr.message}`);
        stepResults.push({
          step: step.name,
          success: false,
          error: stepErr.message,
        });

        const errorScreenshot = await takeStepScreenshot(
          sessionPage,
          `momentum_${step.name}_error`,
          "momentum_form_filing"
        );
        if (errorScreenshot) screenshots.push(errorScreenshot);
      }
    }

    if (supabase && filingData.filing_id) {
      try {
        await supabase
          .from("permit_filings")
          .update({
            filing_status: "form_filled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", filingData.filing_id);

        console.log("  [Momentum Filer] Updated permit_filings: status=form_filled");
      } catch (err) {
        console.log(`  [Momentum Filer] Failed to update permit_filings: ${err.message}`);
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

    console.log("  [Momentum Filer] Form filing automation complete");

    return {
      success: true,
      steps: stepResults,
      screenshots,
      field_audits: fieldAudits,
      wizard_steps: WIZARD_STEPS,
      portal: "momentum_liferay",
      jurisdiction: "pg_county_md",
    };
  } catch (err) {
    console.error(`  [Momentum Filer] Fatal error: ${err.message}`);

    const errorScreenshot = await takeStepScreenshot(sessionPage, "momentum_fatal_error", "momentum_form_filing").catch(() => null);
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
      error: "filing_error",
      message: err.message,
      steps: stepResults,
      screenshots,
    };
  }
}

module.exports = {
  momentumFile,
  WIZARD_STEPS,
};
