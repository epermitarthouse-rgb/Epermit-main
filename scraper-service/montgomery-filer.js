const { getMontgomerySession } = require("./montgomery-auth");

const MONTGOMERY_BASE_URL = "https://permittingservices.montgomerycountymd.gov";
const WIZARD_TIMEOUT = 30000;
const STEP_WAIT_MS = 2000;
const POSTBACK_WAIT_MS = 3000;

const WIZARD_STEPS = [
  "address_lookup",
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
    console.log(`  [MoCo Filer] Screenshot captured: ${stepName} (${Math.round(base64.length / 1024)}KB)`);
    return {
      step_name: stepName,
      agent_name: agentName || "montgomery_filing",
      screenshot_url: url,
      captured_at: new Date().toISOString(),
    };
  } catch (err) {
    console.log(`  [MoCo Filer] Screenshot failed for ${stepName}: ${err.message}`);
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

async function waitForPostback(page, timeoutMs) {
  const timeout = timeoutMs || POSTBACK_WAIT_MS;
  await page.waitForTimeout(timeout);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
}

async function fillField(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const field = await page.$(sel);
    if (field && (await field.isVisible().catch(() => false))) {
      await field.fill("");
      await field.fill(String(value));
      console.log(`  [MoCo Filer] Filled field: ${sel} = "${String(value).substring(0, 50)}"`);
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
        console.log(`  [MoCo Filer] Selected dropdown: ${sel} = "${value}"`);
        await waitForPostback(page);
        return true;
      } catch (_) {
        try {
          await select.selectOption({ value: value });
          await waitForPostback(page);
          return true;
        } catch (_) {
          const options = await select.$$("option");
          for (const opt of options) {
            const text = (await opt.textContent().catch(() => "")).trim().toLowerCase();
            if (text.includes(value.toLowerCase())) {
              const optValue = await opt.getAttribute("value");
              await select.selectOption({ value: optValue });
              console.log(`  [MoCo Filer] Selected dropdown (fuzzy): ${sel} = "${text}"`);
              await waitForPostback(page);
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

async function clickAspNetButton(page, selectors) {
  for (const sel of selectors) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible().catch(() => false))) {
      const isDisabled = await btn.evaluate(
        (el) => el.disabled || el.classList.contains("disabled") || el.classList.contains("aspNetDisabled")
      );
      if (!isDisabled) {
        console.log(`  [MoCo Filer] Clicking ASP.NET button: ${sel}`);
        await btn.click();
        await waitForPostback(page);
        return true;
      }
    }
  }
  return false;
}

async function clickNextButton(page) {
  const nextSelectors = [
    '[name*="btnNext"]',
    '[name*="cmdNext"]',
    '[id*="btnNext"]',
    '[id*="cmdNext"]',
    'input[value="Next"]',
    'input[value="Continue"]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'a:has-text("Next")',
    '[data-action="next"]',
    ".btn-next",
  ];

  return clickAspNetButton(page, nextSelectors);
}

async function fillAddressLookup(page, filingData) {
  console.log("  [MoCo Filer] Step 1: Address Lookup");

  const addressSelectors = [
    '[name*="txtAddress"]',
    '[name*="txtStreetAddress"]',
    '[name*="txtPropertyAddress"]',
    '[id*="txtAddress"]',
    'input[id*="address" i]',
    'input[name*="address" i]',
    'input[placeholder*="address" i]',
    'input[aria-label*="address" i]',
  ];
  await fillField(page, addressSelectors, filingData.property_address);

  const searchSelectors = [
    '[name*="btnSearch"]',
    '[name*="cmdSearch"]',
    '[id*="btnSearch"]',
    'input[value="Search"]',
    'input[value="Look Up"]',
    'button:has-text("Search")',
    'button:has-text("Look Up")',
    'button:has-text("Find")',
  ];
  await clickAspNetButton(page, searchSelectors);

  const resultSelectors = [
    'a[id*="lnkAddress"]',
    '[id*="grdResults"] a',
    '[id*="GridView"] a',
    'table a[href*="javascript:__doPostBack"]',
    '.result-row a',
    'button:has-text("Select")',
    'a:has-text("Select")',
  ];

  for (const sel of resultSelectors) {
    const result = await page.$(sel);
    if (result && (await result.isVisible().catch(() => false))) {
      console.log(`  [MoCo Filer] Selecting address result: ${sel}`);
      await result.click();
      await waitForPostback(page);
      break;
    }
  }

  return { step: "address_lookup", success: true };
}

async function fillPermitTypeSelection(page, filingData) {
  console.log("  [MoCo Filer] Step 2: Permit Type Selection");

  const permitTypeMap = {
    residential: ["Residential", "Building - Residential", "Res Building"],
    commercial: ["Commercial", "Building - Commercial", "Com Building"],
    trade: ["Trade", "Electrical", "Mechanical", "Plumbing"],
    solar: ["Solar", "Solar Panel", "Solar PV"],
    demolition: ["Demolition", "Demo", "Raze"],
    addition: ["Addition", "Addition/Alteration"],
    alteration: ["Alteration", "Interior Alteration"],
    deck: ["Deck", "Deck/Porch"],
    fence: ["Fence"],
    shed: ["Shed", "Accessory Structure"],
  };

  const permitType = filingData.permit_type || "residential";
  const typeLabels = permitTypeMap[permitType] || [permitType];

  const typeSelectors = [
    '[name*="ddlPermitType"]',
    '[name*="ddlType"]',
    '[name*="cboPermitType"]',
    '[id*="ddlPermitType"]',
    '[id*="ddlType"]',
    'select[id*="permit" i][id*="type" i]',
    'select[name*="permit" i][name*="type" i]',
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
        `input[type="radio"][value*="${label}" i], label:has-text("${label}"), a:has-text("${label}"), [id*="rdo"][id*="${label.replace(/\s/g, '')}" i]`
      );
      if (radioOrLink && (await radioOrLink.isVisible().catch(() => false))) {
        await radioOrLink.click();
        console.log(`  [MoCo Filer] Clicked permit type option: ${label}`);
        selected = true;
        await waitForPostback(page);
        break;
      }
    }
  }

  if (filingData.permit_subtype) {
    const subtypeSelectors = [
      '[name*="ddlSubType"]',
      '[name*="ddlPermitSubType"]',
      '[id*="ddlSubType"]',
      'select[id*="subtype" i]',
      'select[name*="subtype" i]',
    ];
    await selectDropdown(page, subtypeSelectors, filingData.permit_subtype);
  }

  return { step: "permit_type_selection", success: selected };
}

async function fillScopeOfWork(page, filingData) {
  console.log("  [MoCo Filer] Step 3: Scope of Work");

  const scopeSelectors = [
    '[name*="txtDescription"]',
    '[name*="txtScope"]',
    '[name*="txtScopeOfWork"]',
    '[name*="txtWorkDescription"]',
    '[id*="txtDescription"]',
    '[id*="txtScope"]',
    'textarea[id*="scope" i]',
    'textarea[name*="scope" i]',
    'textarea[id*="description" i]',
    'textarea[name*="description" i]',
    'textarea[id*="work" i]',
  ];

  const scope = filingData.scope_of_work || "";
  const filled = await fillField(page, scopeSelectors, scope);

  if (!filled) {
    const inputSelectors = [
      'input[name*="txtDescription"]',
      'input[name*="txtScope"]',
      'input[id*="scope" i]',
      'input[id*="description" i]',
    ];
    await fillField(page, inputSelectors, scope);
  }

  return { step: "scope_of_work", success: true };
}

async function fillProfessionalIdentification(page, filingData) {
  console.log("  [MoCo Filer] Step 4: Professional Identification");

  const professionals = filingData.professionals || [];
  const results = [];

  const roleConfig = {
    expediter: {
      licenseSelectors: [
        '[name*="txtExpediter" i]',
        '[id*="txtExpediter" i]',
        'input[id*="expediter" i][id*="license" i]',
        'input[id*="expediter" i][id*="reg" i]',
      ],
      nameSelectors: [
        '[name*="txtExpediterName" i]',
        '[id*="txtExpediterName" i]',
        'input[id*="expediter" i][id*="name" i]',
      ],
    },
    architect: {
      licenseSelectors: [
        '[name*="txtArchitect" i]',
        '[id*="txtArchitect" i]',
        'input[id*="architect" i][id*="license" i]',
        'input[id*="architect" i][id*="number" i]',
      ],
      nameSelectors: [
        '[name*="txtArchitectName" i]',
        '[id*="txtArchitectName" i]',
        'input[id*="architect" i][id*="name" i]',
      ],
    },
    engineer: {
      licenseSelectors: [
        '[name*="txtEngineer" i]',
        '[id*="txtEngineer" i]',
        'input[id*="engineer" i][id*="license" i]',
        'input[id*="engineer" i][id*="number" i]',
      ],
      nameSelectors: [
        '[name*="txtEngineerName" i]',
        '[id*="txtEngineerName" i]',
        'input[id*="engineer" i][id*="name" i]',
      ],
    },
    contractor: {
      licenseSelectors: [
        '[name*="txtContractor" i]',
        '[id*="txtContractor" i]',
        'input[id*="contractor" i][id*="license" i]',
        'input[id*="contractor" i][id*="number" i]',
      ],
      nameSelectors: [
        '[name*="txtContractorName" i]',
        '[id*="txtContractorName" i]',
        'input[id*="contractor" i][id*="name" i]',
      ],
    },
    owner: {
      licenseSelectors: [],
      nameSelectors: [
        '[name*="txtOwnerName" i]',
        '[id*="txtOwnerName" i]',
        'input[id*="owner" i][id*="name" i]',
      ],
    },
  };

  for (const prof of professionals) {
    const role = (prof.role_on_project || "").toLowerCase();
    const config = roleConfig[role];

    if (config) {
      let filled = false;
      if (config.licenseSelectors.length > 0 && prof.license_number) {
        filled = await fillField(page, config.licenseSelectors, prof.license_number);
      }
      if (config.nameSelectors.length > 0 && prof.professional_name) {
        await fillField(page, config.nameSelectors, prof.professional_name);
      }
      results.push({ role, name: prof.professional_name, filled });
    } else {
      const genericLicenseSelectors = [
        `input[name*="${role}" i]`,
        `input[id*="${role}" i]`,
      ];
      const filled = await fillField(page, genericLicenseSelectors, prof.license_number);
      results.push({ role, name: prof.professional_name, filled });
    }
  }

  return { step: "professional_identification", success: true, professionals: results };
}

async function fillConstructionCost(page, filingData) {
  console.log("  [MoCo Filer] Step 5: Construction Cost");

  const costSelectors = [
    '[name*="txtCost"]',
    '[name*="txtConstructionCost"]',
    '[name*="txtEstimatedCost"]',
    '[name*="txtValue"]',
    '[id*="txtCost"]',
    '[id*="txtConstructionCost"]',
    'input[id*="cost" i]',
    'input[name*="cost" i]',
    'input[id*="value" i][id*="construct" i]',
    'input[placeholder*="cost" i]',
    'input[type="number"][id*="cost" i]',
  ];

  const costValue = filingData.construction_value || filingData.estimated_fee || "";
  const filled = await fillField(page, costSelectors, String(costValue));

  if (filingData.property_type) {
    const propertyTypeSelectors = [
      '[name*="ddlPropertyType"]',
      '[id*="ddlPropertyType"]',
      'select[id*="property" i][id*="type" i]',
      'select[name*="property" i]',
    ];
    await selectDropdown(page, propertyTypeSelectors, filingData.property_type);
  }

  return { step: "construction_cost", success: filled };
}

async function uploadDocuments(page, filingData) {
  console.log("  [MoCo Filer] Step 6: Document Upload");

  const documents = filingData.documents || [];
  const results = [];

  if (documents.length === 0) {
    console.log("  [MoCo Filer] No documents to upload");
    return { step: "document_upload", success: true, documents: [] };
  }

  const sortedDocs = [...documents].sort(
    (a, b) => (a.upload_order || 999) - (b.upload_order || 999)
  );

  for (const doc of sortedDocs) {
    console.log(`  [MoCo Filer] Uploading: ${doc.document_name} (${doc.document_type})`);

    if (doc.document_type) {
      const docTypeSelectors = [
        '[name*="ddlDocumentType"]',
        '[id*="ddlDocumentType"]',
        'select[id*="document" i][id*="type" i]',
        'select[name*="document" i]',
      ];
      await selectDropdown(page, docTypeSelectors, doc.document_type);
    }

    const fileInputSelectors = [
      'input[type="file"]',
      '[name*="fileUpload"]',
      '[id*="fileUpload"]',
      'input[accept*="pdf"]',
      'input[accept*="image"]',
    ];

    let uploaded = false;
    for (const sel of fileInputSelectors) {
      const fileInput = await page.$(sel);
      if (fileInput) {
        if (doc.file_url && doc.file_url.startsWith("/")) {
          try {
            await fileInput.setInputFiles(doc.file_url);
            uploaded = true;
            console.log(`  [MoCo Filer] File input set for: ${doc.document_name}`);
          } catch (err) {
            console.log(`  [MoCo Filer] File upload failed: ${err.message}`);
          }
        } else if (doc.file_url) {
          console.log(`  [MoCo Filer] Remote file URL — manual upload may be needed: ${doc.file_url}`);
          uploaded = false;
        }
        break;
      }
    }

    if (uploaded) {
      const uploadBtnSelectors = [
        '[name*="btnUpload"]',
        '[name*="cmdUpload"]',
        '[id*="btnUpload"]',
        'input[value="Upload"]',
        'input[value="Add"]',
        'button:has-text("Upload")',
        'button:has-text("Add")',
      ];
      await clickAspNetButton(page, uploadBtnSelectors);
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
  console.log("  [MoCo Filer] Step 7: Review & Submit (STOP — do NOT submit)");

  const reviewIndicators = [
    '[id*="review" i]',
    '[id*="summary" i]',
    '[class*="review" i]',
    '[class*="summary" i]',
    'h1:has-text("Review")',
    'h2:has-text("Review")',
    'h3:has-text("Review")',
    'h1:has-text("Summary")',
    'h2:has-text("Summary")',
    '[name*="btnSubmit"]',
    '[name*="cmdSubmit"]',
    'input[value="Submit"]',
    'button:has-text("Submit")',
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
        'input[value="Submit"], button:not([disabled]):is([type="submit"]), [name*="btnSubmit"], [name*="cmdSubmit"]'
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

async function montgomeryFile(sessionToken, filingData, supabase) {
  console.log("  [MoCo Filer] Starting Montgomery County form filing automation");
  console.log(`  [MoCo Filer] Filing ID: ${filingData.filing_id}`);
  console.log(`  [MoCo Filer] Address: ${filingData.property_address}`);

  const session = getMontgomerySession(sessionToken);
  if (!session) {
    return {
      success: false,
      error: "session_not_found",
      message: "Montgomery County session not found or expired. Re-authenticate first.",
    };
  }

  const page = session.page;
  const screenshots = [];
  const stepResults = [];
  const fieldAudits = {};

  try {
    console.log("  [MoCo Filer] Navigating to application page...");
    const applyUrl = session.baseUrl || MONTGOMERY_BASE_URL;
    const applicationUrl = `${applyUrl}/DPS/onlineservices/PermitApplication.aspx`;
    await page.goto(applicationUrl, {
      waitUntil: "networkidle",
      timeout: WIZARD_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`  [MoCo Filer] Landed on: ${currentUrl}`);

    if (
      currentUrl.toLowerCase().includes("login") ||
      currentUrl.toLowerCase().includes("sessionexpired") ||
      currentUrl.toLowerCase().includes("timeout")
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
      'a:has-text("Apply")',
      'a:has-text("Start Application")',
      'a:has-text("New Permit")',
      'button:has-text("New Application")',
      'button:has-text("Apply")',
      'button:has-text("Start")',
      '[name*="btnNewApplication"]',
      '[name*="cmdNewApplication"]',
      '[id*="btnNewApplication"]',
      '[data-action="new-application"]',
    ];

    for (const sel of newAppSelectors) {
      const btn = await page.$(sel);
      if (btn && (await btn.isVisible().catch(() => false))) {
        console.log(`  [MoCo Filer] Clicking: ${sel}`);
        await btn.click();
        await waitForPostback(page);
        break;
      }
    }

    const initialScreenshot = await takeStepScreenshot(page, "initial_navigation", "montgomery_filing");
    if (initialScreenshot) screenshots.push(initialScreenshot);

    const stepHandlers = [
      { name: "address_lookup", handler: fillAddressLookup },
      { name: "permit_type_selection", handler: fillPermitTypeSelection },
      { name: "scope_of_work", handler: fillScopeOfWork },
      { name: "professional_identification", handler: fillProfessionalIdentification },
      { name: "construction_cost", handler: fillConstructionCost },
      { name: "document_upload", handler: uploadDocuments },
      { name: "review_and_submit", handler: verifyReviewPage },
    ];

    for (let i = 0; i < stepHandlers.length; i++) {
      const step = stepHandlers[i];
      console.log(`\n  [MoCo Filer] === Step ${i + 1}/${stepHandlers.length}: ${step.name} ===`);

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
          "montgomery_filing"
        );
        if (stepScreenshot) {
          stepScreenshot.field_audit = fieldAudits[step.name];
          screenshots.push(stepScreenshot);
        }

        if (step.name === "review_and_submit") {
          console.log("  [MoCo Filer] Reached review page — stopping before submit");
          break;
        }

        const clicked = await clickNextButton(page);
        if (!clicked) {
          console.log(`  [MoCo Filer] No Next button found after step ${step.name} — trying to continue`);
        }
      } catch (stepErr) {
        console.error(`  [MoCo Filer] Error in step ${step.name}: ${stepErr.message}`);
        stepResults.push({
          step: step.name,
          success: false,
          error: stepErr.message,
        });

        const errorScreenshot = await takeStepScreenshot(
          page,
          `${step.name}_error`,
          "montgomery_filing"
        );
        if (errorScreenshot) screenshots.push(errorScreenshot);
      }
    }

    if (supabase && filingData.filing_id) {
      try {
        await supabase
          .from("permit_filings")
          .update({
            filing_status: "review_ready",
            updated_at: new Date().toISOString(),
          })
          .eq("id", filingData.filing_id);
        console.log("  [MoCo Filer] Updated permit_filings: status=review_ready");
      } catch (err) {
        console.log(`  [MoCo Filer] Failed to update permit_filings: ${err.message}`);
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

    console.log("  [MoCo Filer] Form filing automation complete");

    return {
      success: true,
      steps_completed: stepResults,
      screenshots,
      field_audits: fieldAudits,
      stopped_at: "review_and_submit",
      message: "Montgomery County form filled — awaiting human review before submission",
    };
  } catch (err) {
    console.error(`  [MoCo Filer] Fatal error: ${err.message}`);

    const errorScreenshot = await takeStepScreenshot(page, "fatal_error", "montgomery_filing").catch(() => null);
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
      steps_completed: stepResults,
      screenshots,
    };
  }
}

module.exports = {
  montgomeryFile,
  fillAddressLookup,
  fillPermitTypeSelection,
  fillScopeOfWork,
  fillProfessionalIdentification,
  fillConstructionCost,
  uploadDocuments,
  verifyReviewPage,
  WIZARD_STEPS,
};
