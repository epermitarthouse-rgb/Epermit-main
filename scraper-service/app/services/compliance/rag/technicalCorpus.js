"use strict";

const fs = require("fs");
const path = require("path");
const { measurementIsProven } = require("./drawingStructureV2.js");

/**
 * License gate for the Code RAG index.
 * Model-code books (ICC, NFPA, ASHRAE) are not stored unless the row declares
 * a license that permits storage. Official adoption URLs and section ids may
 * be stored as locators. Section text is never invented.
 */
const MODEL_TEXT_LICENSES = new Set([
  "public_domain",
  "open_license",
  "publisher_api_licensed",
]);

const FAMILY_PATTERNS = [
  ["ICC A117.1", /\bicc\s*a\s*117\.1\b|\ba117\.1\b/i],
  ["ASHRAE 90.1", /\bashrae\s*90\.1\b/i],
  ["NEC", /\bnec\b|\bnfpa\s*70\b/i],
  ["IBC", /\bibc\b/i],
  ["IRC", /\birc\b/i],
  ["IEBC", /\biebc\b/i],
  ["IFC", /\bifc\b/i],
  ["IMC", /\bimc\b/i],
  ["IPC", /\bipc\b/i],
  ["IFGC", /\bifgc\b/i],
  ["IECC", /\biecc\b/i],
  ["IgCC", /\bigcc\b/i],
];

/** Review element to the model-code family that ordinarily states it. */
const ELEMENT_FAMILY = {
  egress_path: "IBC",
  door: "IBC",
  stair: "IBC",
  guard: "IBC",
  handrail: "IBC",
  accessible_route: "IBC",
  toilet_clearance: "IBC",
  accessory: "IBC",
  counter: "IBC",
  travel_distance: "IBC",
  occupant_load: "IBC",
  fire_rated_assembly: "IBC",
  glazing: "IBC",
  seating: "IBC",
  exit_sign: "IBC",
  structural_framing: "IBC",
  special_inspection: "IBC",
  emergency_lighting: "NEC",
  gfci: "NEC",
  grounding: "NEC",
  fire_command_center: "IBC",
  sprinkler: "IFC",
  fdc: "IFC",
  grease_interceptor: "IPC",
  mixing_valve: "IPC",
  floor_drain: "IPC",
  cleanout: "IPC",
  water_hammer: "IPC",
  backflow: "IPC",
  piping: "IPC",
  ventilation: "IMC",
  duct: "IMC",
  exhaust_hood: "IMC",
  insulation: "IMC",
  rooftop_equipment: "IMC",
  fire_damper: "IMC",
  energy_compliance: "IECC",
};

const PROPERTY_WORDS = {
  width: ["width", "wide"],
  height: ["height", "high", "aff"],
  clearance: ["clearance", "clear", "turning"],
  capacity: ["capacity", "rated"],
  flow: ["flow", "gpm", "cfm"],
  riser_tread: ["riser", "tread", "rise"],
  rating: ["rating", "hour"],
  distance: ["distance", "travel"],
  thickness: ["thick"],
  illumination: ["illumination", "candle"],
  duration: ["duration", "hour", "minute"],
};

function canonicalFamily(value) {
  const compact = String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
  if (compact === "nec" || compact === "nfpa70") return "nec";
  if (compact === "icca117.1" || compact === "a117.1") return "icc-a117.1";
  if (compact === "ashrae90.1" || compact === "ashrae901") return "ashrae-90.1";
  return compact;
}

function familiesMatch(left, right) {
  if (!left || !right) return false;
  return canonicalFamily(left) === canonicalFamily(right);
}

function isCopyrightedModelBook(provision) {
  const family = canonicalFamily(provision?.codeBook);
  if (!family) return false;
  if (family.startsWith("nfpa") || family.startsWith("icc") || family.startsWith("ashrae")) return true;
  return ["ibc", "irc", "iebc", "ifc", "imc", "ipc", "ifgc", "iecc", "igcc", "nec"].includes(family);
}

function storageLicenseAllows(licenseStatus) {
  return MODEL_TEXT_LICENSES.has(String(licenseStatus || ""));
}

function editionList(provision) {
  return [provision?.edition, provision?.baseCodeEdition, provision?.jurisdictionCodeEdition]
    .filter(Boolean)
    .map(String);
}

function yearsIn(value) {
  return [...String(value || "").matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => match[1]);
}

/**
 * A companion code may use a different year than the selected base edition
 * (NEC 2014 under an IBC 2015 adoption, or under the 2017 local edition).
 * A selected year that is not itself adopted does not pull another edition's text.
 */
function editionInScope(provision, selectedEdition, adoptedCodes) {
  if (!selectedEdition) return true;
  const editions = editionList(provision);
  if (!editions.length) return true;
  const selected = String(selectedEdition);
  if (editions.includes(selected)) return true;
  const years = yearsIn(selected);
  if (years.some((year) => editions.includes(year))) return true;
  const adopted = Array.isArray(adoptedCodes) ? adoptedCodes : [];
  const selectedIsAdopted = adopted.some((code) =>
    selected === String(code.edition) || years.includes(String(code.edition)),
  );
  if (!selectedIsAdopted) return false;
  return adopted.some((code) =>
    (familiesMatch(code.family, provision.codeBook) || familiesMatch(code.family, provision.baseCodeFamily))
    && editions.includes(String(code.edition)),
  );
}

function gateProvision(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isCopyrightedModelBook(raw)) return { ...raw };
  const text = String(raw.text || "").trim();
  if (storageLicenseAllows(raw.licenseStatus) && raw.exactTextStored === true && text.length >= 12) {
    return { ...raw };
  }
  return {
    ...raw,
    text: null,
    quote: null,
    requirement: null,
    thresholds: [],
    exceptions: [],
    exactTextStored: false,
    authoritative: false,
    supportsConfirmedViolation: false,
    sourceStatus: "locator_only",
    coverageClass: "unverified_reference",
    licenseStatus: raw.licenseStatus || "model_code_not_licensed_for_storage",
    inCorpus: ["section id", "edition", "source URL"].filter((item, index) => [raw.section, raw.edition, raw.sourceUrl][index]),
    notInCorpus: ["section text", "thresholds", "exceptions", "amendments"],
  };
}

function loadSuppliedTechnicalProvisions() {
  const candidates = [
    path.join(__dirname, "../../../../../shared/code-registry/technical-provisions.json"),
    path.join(__dirname, "bundled-registry/technical-provisions.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(found, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function countsAsStoredRequirement(provision) {
  if (!provision || provision.authoritative !== true || provision.supportsConfirmedViolation !== true) return false;
  if (provision.sourceStatus === "locator_only" || provision.exactTextStored === false) return false;
  if (String(provision.text || provision.quote || "").trim().length < 12) return false;
  if (isCopyrightedModelBook(provision) && !storageLicenseAllows(provision.licenseStatus)) return false;
  if (provision.sourceStatus && provision.sourceStatus !== "verified_text") return false;
  return true;
}

function isEnforceable(provision) {
  if (!provision || provision.authoritative !== true || provision.supportsConfirmedViolation !== true) return false;
  if (provision.sourceStatus !== "verified_text" || !provision.section) return false;
  if (provision.exactTextStored === false) return false;
  if (String(provision.text || provision.quote || "").trim().length < 12) return false;
  if (isCopyrightedModelBook(provision) && !storageLicenseAllows(provision.licenseStatus)) return false;
  return true;
}

function familyCoverage(record, provisions) {
  if (!record) return [];
  const codes = [...(record.baseCodes || []), ...(record.referencedStandards || [])];
  const seen = new Set();
  const families = [];
  for (const code of codes) {
    const key = `${canonicalFamily(code.family)}:${code.edition}`;
    if (!code.family || !code.edition || seen.has(key)) continue;
    seen.add(key);
    const textStored = (provisions || []).some((provision) =>
      isEnforceable(provision)
      && familiesMatch(provision.codeBook, code.family)
      && editionList(provision).includes(String(code.edition)),
    );
    families.push({
      family: code.family,
      edition: String(code.edition),
      discipline: code.discipline || null,
      coverageClass: textStored ? "verified_requirement" : "unverified_reference",
      textStored,
      sourceUrl: record.officialSourceUrl || null,
      licenseStatus: textStored ? "stored_under_declared_license" : "model_code_not_licensed_for_storage",
      inCorpus: textStored
        ? ["adoption", "edition", "licensed section text"]
        : ["adoption", "edition", "official source URL"],
      notInCorpus: textStored ? [] : ["section text", "thresholds", "exceptions", "amendments"],
    });
  }
  return families;
}

function parseCitation(citation) {
  const text = String(citation || "");
  let family = null;
  let rest = text;
  for (const [name, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(text)) {
      family = name;
      rest = text.replace(pattern, " ");
      break;
    }
  }
  if (!family) {
    const nfpa = text.match(/\bnfpa\s*(\d+(?:\.\d+)?)\b/i);
    if (nfpa && nfpa[1] !== "70") {
      family = `NFPA ${nfpa[1]}`;
      rest = text.replace(nfpa[0], " ");
    }
  }
  const year = rest.match(/\b((?:19|20)\d{2})\b/);
  const dotted = [...rest.matchAll(/\b(\d+\.\d+(?:\.\d+)*)\b/g)].map((match) => match[1]);
  const section = dotted.sort((a, b) => b.length - a.length)[0]
    || [...rest.matchAll(/\b(\d{1,4})\b/g)].map((match) => match[1]).find((number) => number !== year?.[1]);
  return { family, section: section || null, year: year?.[1] || null };
}

function sectionInText(citation, section) {
  const value = String(section || "");
  if (!value) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9.])${escaped}(?![0-9.])`).test(String(citation || ""));
}

function citationNamesBook(citation, provision) {
  const book = String(provision?.codeBook || "");
  if (!book) return true;
  const compact = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
  if (compact(citation).includes(compact(book))) return true;
  return familiesMatch(provision.baseCodeFamily, parseCitation(citation).family)
    || familiesMatch(provision.codeBook, parseCitation(citation).family);
}

function citationMatchesProvision(citation, provision) {
  if (!provision?.section || !sectionInText(citation, provision.section)) return false;
  return citationNamesBook(citation, provision);
}

function adoptedFamily(adoptedCodes, family, year) {
  const codes = Array.isArray(adoptedCodes) ? adoptedCodes : [];
  const matches = codes.filter((code) => familiesMatch(code.family, family));
  if (!matches.length) return null;
  if (!year) return matches[0];
  const exact = matches.find((code) => String(code.edition) === String(year));
  if (exact) return exact;
  // "NEC 2015" under an IBC 2015 / 2017 local package names the package year,
  // not a different NEC edition. A year outside the package stays unmatched.
  const yearBelongsToPackage = codes.some((code) => String(code.edition) === String(year));
  return yearBelongsToPackage ? matches[0] : null;
}

function locatorFor(legal, family, edition, section) {
  return {
    codeBook: family,
    edition: edition || null,
    section: section || null,
    sourceUrl: legal?.officialSourceUrl || null,
    sourceLocator: [family, edition, section].filter(Boolean).join(" "),
    licenseStatus: "model_code_not_licensed_for_storage",
    inCorpus: ["code family", "edition", "section id", "official adoption URL"].filter((item) =>
      item !== "section id" || section,
    ),
    notInCorpus: ["section text", "thresholds", "exceptions", "amendments"],
  };
}

function provisionsFrom(ctx) {
  const out = [];
  for (const list of [ctx?.authoritativeCode, ctx?.codeProvisions, ctx?.provisions]) {
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}

function classifyRequirement(issue, ctx) {
  const legal = ctx?.legalApplicability || null;
  const selected = legal?.selectedEdition || ctx?.codeYear || null;
  const adoptedCodes = legal?.adoptedCodes || [];
  const citation = `${issue?.codeReference || ""} ${issue?.citationBook || ""}`.trim();
  const provisions = provisionsFrom(ctx).filter((provision) =>
    editionInScope(provision, selected, adoptedCodes)
    && (!legal?.registryRecordId || !provision.registryRecordId || provision.registryRecordId === legal.registryRecordId),
  );
  const cited = citation ? provisions.filter((provision) => citationMatchesProvision(citation, provision)) : [];
  const enforceable = cited.find(isEnforceable);
  if (enforceable) {
    return { coverageClass: "verified_requirement", provision: gateProvision(enforceable), locator: null };
  }
  const stored = cited.find((provision) =>
    provision.exactTextStored !== false
    && provision.sourceStatus === "verified_text"
    && String(provision.text || provision.quote || "").trim().length >= 12
    && !isCopyrightedModelBook(provision),
  );
  if (stored) {
    return { coverageClass: "verified_nonrequirement", provision: stored, locator: null };
  }
  const parsed = parseCitation(citation);
  if (parsed.family) {
    const adopted = adoptedFamily(adoptedCodes, parsed.family, parsed.year);
    if (adopted) {
      return {
        coverageClass: "unverified_reference",
        provision: null,
        locator: locatorFor(legal, adopted.family, adopted.edition, parsed.section),
      };
    }
    if (parsed.section || parsed.family) {
      return { coverageClass: "missing_coverage", provision: null, locator: null };
    }
  }
  const claim = ctx?.claim || null;
  const byElement = provisions.find((provision) =>
    isEnforceable(provision)
    && claim?.element
    && (provision.elementTypes || provision.applicability?.elementTypes || []).includes(claim.element.id),
  );
  if (byElement) return { coverageClass: "verified_requirement", provision: byElement, locator: null };
  const family = claim?.element ? ELEMENT_FAMILY[claim.element.id] : null;
  const adopted = family ? adoptedFamily(adoptedCodes, family, null) : null;
  if (adopted) {
    return {
      coverageClass: "unverified_reference",
      provision: null,
      locator: locatorFor(legal, adopted.family, adopted.edition, null),
    };
  }
  return { coverageClass: "missing_coverage", provision: null, locator: null };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function applicabilityDecision(provision, ctx, claim) {
  const app = provision?.applicability || {};
  const workScopes = asList(app.workScopes).filter((scope) => scope && scope !== "any");
  if (workScopes.length) {
    const scope = ctx?.legalApplicability?.permitFacts?.workScope || ctx?.projectContext?.workScope || null;
    if (!scope) return "unresolved";
    if (!workScopes.includes(scope)) return "not_applicable";
  }
  const occupancies = asList(app.occupancies);
  if (occupancies.length) {
    const occ = `${ctx?.projectType || ""} ${ctx?.projectContext?.occupancy || ""}`.trim().toLowerCase();
    if (!occ) return "unresolved";
    if (!occupancies.some((item) => occ.includes(String(item).toLowerCase()))) return "not_applicable";
  }
  const buildingTypes = asList(app.buildingTypes);
  if (buildingTypes.length) {
    const type = String(ctx?.projectType || ctx?.projectContext?.buildingType || "").trim().toLowerCase();
    if (!type) return "unresolved";
    if (!buildingTypes.some((item) => type.includes(String(item).toLowerCase()))) return "not_applicable";
  }
  const disciplines = asList(app.disciplines);
  if (disciplines.length && ctx?.discipline && !disciplines.includes(ctx.discipline)) return "not_applicable";
  const elementTypes = asList(provision?.elementTypes || app.elementTypes);
  if (elementTypes.length && claim?.element && !elementTypes.includes(claim.element.id)) return "not_applicable";
  return "applies";
}

function canonicalUnit(unit) {
  const value = String(unit || "").trim().toLowerCase();
  if (!value) return null;
  if (["in", "inch", "inches", "\""].includes(value)) return "in";
  if (["ft", "foot", "feet", "'"].includes(value)) return "ft";
  return value;
}

function convert(value, fromUnit, toUnit) {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (!Number.isFinite(value)) return null;
  if (!to || !from || from === to) return { value, unit: to || from };
  if (from === "ft" && to === "in") return { value: value * 12, unit: "in" };
  if (from === "in" && to === "ft") return { value: value / 12, unit: "ft" };
  return null;
}

function numericFromText(text) {
  const source = String(text || "");
  const feet = source.match(/(\d+)\s*['′]\s*-?\s*(\d+)?(?:\s*(\d)\/(\d+))?\s*["″]?/);
  if (feet) {
    const inches = Number(feet[2] || 0) + (feet[3] ? Number(feet[3]) / Number(feet[4]) : 0);
    return { value: Number(feet[1]) * 12 + inches, unit: "in" };
  }
  const plain = source.match(/(\d+(?:\.\d+)?)/);
  if (!plain) return null;
  const unit = source.match(/\b(in(?:ch(?:es)?)?|ft|feet|gpm|cfm|hr|hour)\b/i);
  return { value: Number(plain[1]), unit: unit ? unit[1] : null };
}

function headerMatches(header, property) {
  if (!property) return true;
  const words = PROPERTY_WORDS[property] || [String(property).replace(/_/g, " ")];
  const text = String(header || "").toLowerCase();
  return words.some((word) => text.includes(word));
}

function elementIdsFor(doc, claim) {
  const elements = (doc?.elements || []).filter((element) => !claim?.element || element.type === claim.element.id);
  return { elements, ids: new Set(elements.map((element) => element.id)) };
}

function pushFact(facts, fact) {
  if (!fact || !Number.isFinite(fact.value)) return;
  facts.push(fact);
}

function factsFromDocument(doc, claim, threshold, crossSheet, sheet) {
  const facts = [];
  if (!doc || doc.extraction?.status === "failed") return facts;
  const { elements, ids } = elementIdsFor(doc, claim);
  if (claim?.element && !elements.length) return facts;
  for (const dimension of doc.dimensions || []) {
    if (!measurementIsProven(dimension, ids.size ? ids : new Set(dimension.related_element_ids || []))) continue;
    if (threshold.property && dimension.property && dimension.property !== threshold.property && dimension.role !== threshold.property) {
      continue;
    }
    const value = Number(dimension.value_numeric);
    const parsed = Number.isFinite(value) ? { value, unit: dimension.unit || null } : numericFromText(dimension.original_content);
    if (!parsed) continue;
    pushFact(facts, {
      kind: crossSheet ? "cross_sheet" : "bound_dimension",
      value: parsed.value,
      unit: parsed.unit,
      sheet,
    });
  }
  for (const element of elements) {
    for (const row of element.properties?.schedule_rows || []) {
      if (row.association_status === "candidate") continue;
      for (const cell of row.cells || []) {
        if (["candidate", "unreadable", "empty"].includes(cell.status)) continue;
        if (!headerMatches(cell.header, threshold.property)) continue;
        const parsed = numericFromText(cell.original_content || cell.text);
        if (!parsed) continue;
        pushFact(facts, { kind: crossSheet ? "cross_sheet" : "schedule_cell", value: parsed.value, unit: parsed.unit, sheet });
      }
    }
    const calculation = element.properties?.calculation;
    const governing = calculation?.governing;
    if (!calculation || calculation.association_status === "candidate" || !governing) continue;
    const operands = Array.isArray(calculation.operands) ? calculation.operands : [];
    if (operands.some((operand) => Number(operand.value) === Number(governing.value))) continue;
    if (threshold.property && governing.property && governing.property !== threshold.property && threshold.property !== "capacity" && threshold.property !== "flow") {
      continue;
    }
    const value = Number(governing.value);
    if (!Number.isFinite(value)) continue;
    pushFact(facts, {
      kind: crossSheet ? "cross_sheet" : "calculation",
      value,
      unit: governing.unit || null,
      sheet,
    });
  }
  return facts;
}

function documentsFor(ctx) {
  const docs = [];
  if (ctx?.structuredDrawing) docs.push({ doc: ctx.structuredDrawing, crossSheet: false, sheet: ctx.fileName || null });
  for (const record of ctx?.drawingRecords || []) {
    const doc = record?.structuredDrawing || (Array.isArray(record?.dimensions) ? record : null);
    if (!doc || doc === ctx.structuredDrawing) continue;
    docs.push({ doc, crossSheet: true, sheet: record.fileName || record.sheetNumber || null });
  }
  return docs;
}

function thresholdFails(operator, measured, required) {
  const op = String(operator || "min").toLowerCase();
  if (op === "min" || op === ">=" || op === "minimum") return measured < required;
  if (op === ">") return measured <= required;
  if (op === "max" || op === "<=" || op === "maximum") return measured > required;
  if (op === "<") return measured >= required;
  if (op === "eq" || op === "=" || op === "==") return measured !== required;
  return null;
}

function compareRequirementToFacts(provision, ctx, issue, claim) {
  if (!isEnforceable(provision)) {
    return { outcome: "not_comparable", detail: null };
  }
  const applicability = applicabilityDecision(provision, ctx, claim);
  if (applicability === "not_applicable") {
    return { outcome: "not_applicable", detail: "The verified provision does not apply to this occupancy, work scope, discipline, or element." };
  }
  if (applicability === "unresolved") {
    return { outcome: "not_applicable", detail: "The verified provision's applicability cannot be confirmed from the project facts." };
  }
  if (asList(provision.exceptions).length && issue?.exceptionsChecked !== true) {
    return { outcome: "exceptions_unresolved", detail: "The verified provision has exceptions, and those exceptions were not checked." };
  }
  const thresholds = asList(provision.thresholds).filter((item) => item && Number.isFinite(Number(item.value)));
  if (!thresholds.length) return { outcome: "not_comparable", detail: null };
  const docs = documentsFor(ctx);
  if (!docs.length) {
    return {
      outcome: "insufficient_drawing_evidence",
      detail: "A verified technical provision is in the corpus, but no bound measurement, schedule cell, governing calculation, or cross-sheet fact was available to compare. This is missing drawing evidence, not missing code text.",
    };
  }
  let sawFact = false;
  let incomparable = false;
  let unmatched = 0;
  for (const threshold of thresholds) {
    const requiredElement = threshold.element || null;
    if (requiredElement && claim?.element && requiredElement !== claim.element.id) continue;
    const scopedClaim = requiredElement && !claim?.element
      ? { ...(claim || {}), element: { id: requiredElement } }
      : claim;
    const facts = docs.flatMap((entry) => factsFromDocument(entry.doc, scopedClaim, threshold, entry.crossSheet, entry.sheet));
    if (!facts.length) {
      unmatched += 1;
      continue;
    }
    sawFact = true;
    for (const fact of facts) {
      const measured = convert(fact.value, fact.unit, threshold.unit);
      if (!measured) {
        incomparable = true;
        continue;
      }
      const fails = thresholdFails(threshold.operator, measured.value, Number(threshold.value));
      if (fails === null) {
        incomparable = true;
        continue;
      }
      const label = `${provision.codeBook || "Code"} ${provision.section || ""}`.trim();
      if (fails) {
        return {
          outcome: "violation",
          detail: `Bound ${fact.kind.replace(/_/g, " ")} ${measured.value} ${measured.unit || ""} does not satisfy ${threshold.operator || "min"} ${threshold.value} ${threshold.unit || ""} in ${label}.`.replace(/\s+/g, " ").trim(),
          fact,
          threshold,
        };
      }
    }
  }
  if (!sawFact) {
    return {
      outcome: "insufficient_drawing_evidence",
      detail: "A verified technical provision is in the corpus, but no bound measurement, schedule cell, governing calculation, or cross-sheet fact is tied to this element. Unbound values, calculation operands, and candidate proximity are not measurements. This is missing drawing evidence, not missing code text.",
    };
  }
  if (unmatched) {
    return {
      outcome: "insufficient_drawing_evidence",
      detail: "A verified technical provision is in the corpus, but bound evidence does not cover every numeric threshold. Unbound values, calculation operands, and candidate proximity are not measurements. This is missing drawing evidence, not missing code text.",
    };
  }
  if (incomparable) return { outcome: "not_comparable", detail: null };
  return {
    outcome: "compliant",
    detail: "The bound drawing evidence meets every numeric threshold in the verified requirement. It is not a violation.",
  };
}

function formatCodeRetrieval(bundle) {
  const families = bundle?.coverage?.families || [];
  const enforceable = (bundle?.provisions || []).filter(isEnforceable);
  const lines = ["CODE FAMILY COVERAGE. A locator is not section text and is not a compliance decision."];
  if (!families.length) {
    lines.push("No adopted code family is verified for this run.");
  }
  for (const family of families) {
    lines.push(`- ${family.family} ${family.edition}${family.discipline ? ` (${family.discipline})` : ""}: ${family.coverageClass}. In corpus: ${(family.inCorpus || []).join(", ")}. Not in corpus: ${(family.notInCorpus || []).join(", ") || "none"}. Source: ${family.sourceUrl || "none"}.`);
  }
  if (enforceable.length) {
    lines.push("VERIFIED REQUIREMENTS. Compare these only to bound measurements, schedule cells, governing calculations, or cross-sheet facts.");
    for (const provision of enforceable.slice(0, 12)) {
      lines.push(`- ${provision.codeBook} ${provision.edition || ""} ${provision.section}: ${String(provision.text).slice(0, 400)}`);
    }
  } else {
    lines.push("No verified technical requirement text is in the corpus. A section number without that text is an unverified reference or missing coverage. It is not compliance and it is not a confirmed violation.");
  }
  return lines.join("\n");
}

module.exports = {
  MODEL_TEXT_LICENSES,
  canonicalFamily,
  familiesMatch,
  editionInScope,
  gateProvision,
  loadSuppliedTechnicalProvisions,
  isEnforceable,
  countsAsStoredRequirement,
  familyCoverage,
  parseCitation,
  citationMatchesProvision,
  classifyRequirement,
  compareRequirementToFacts,
  formatCodeRetrieval,
};
