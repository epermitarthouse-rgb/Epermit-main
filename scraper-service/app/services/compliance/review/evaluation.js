"use strict";

/**
 * One evaluation record per substantive check. The verifier, the cross-sheet search, and the
 * evidence gate all ask the same question through this module: does this passage state this
 * attribute of this building element? A number or a keyword elsewhere on a sheet is not that.
 */

const DIMENSION_SOURCE =
  String.raw`\b\d+\s*['′]\s*-?\s*\d+(?:\s+\d\/\d+)?\s*["″]?|\b\d+(?:\.\d+)?\s*(?:["″]|in(?:ch(?:es)?)?\.?(?![a-z])|ft\.?(?![a-z])|feet\b|'(?!s))`;
const DIMENSION_RE = new RegExp(DIMENSION_SOURCE, "i");

/**
 * A dimension within a few words of a cue naming what it measures. Next to a cue, OCR's
 * mark-less feet-inches ("3-6 MIN HEIGHT" for 3'-6") also counts.
 */
function cuedDimension(cue, notFollowedBy = null) {
  const value = `(?:${DIMENSION_SOURCE}|\\b\\d{1,2}\\s*-\\s*\\d{1,2}(?![\\d/.]))`;
  const guard = notFollowedBy ? `(?![^.;]{0,14}\\b(?:${notFollowedBy})\\b)` : "";
  return new RegExp(`(?:\\b(?:${cue})(?=\\W|$)[^.;]{0,32}?${value}${guard})|(?:${value}${guard}[^.;]{0,24}?\\b(?:${cue})(?=\\W|$))`, "i");
}
const LOCATION_RE =
  /\b(?:located|location|at\s+(?:each|all|every|the|top|bottom|head|base|underside|ceiling|floor)|mounted\s+(?:at|on|above)|see\s+(?:sheet|detail|plan)|refer\s+to)\b/i;
const MATERIAL_RE =
  /\b(?:a\d{3}|astm\s*[a-z]?\d+|bolt(?:ed|s)?|weld(?:ed|s)?|screws?|copper|steel|sch(?:edule)?\.?\s*\d+|c?pvc|galvanized|cast\s+iron|ductile\s+iron|pex|abs|type\s+[klm])\b/i;
/** A span that specifies the element: a requirement, a type, a measured value, a place, a material. */
const SPEC_CUE_RE = new RegExp(
  `\\b(?:shall|provide[ds]?|install(?:ed)?|type\\s+[a-z0-9]|model|listed|per\\s+(?:detail|sheet|spec\\w*|code)|refer\\s+to|see\\s+(?:sheet|detail|spec\\w*))\\b|${DIMENSION_SOURCE}|${LOCATION_RE.source}|${MATERIAL_RE.source}`,
  "i",
);

const ATTRIBUTES = {
  rating: {
    claim: /\bfire[\s-]*(?:rating|resist\w*|rated|separation)|\bhour\s+rating|\brated\b|\bfire\s+(?:barrier|partition)s?\b/i,
    value: /\b\d\s*-?\s*(?:hr|hour)s?\b|\bone[\s-]+hours?\b|\b[1-4]\s*h\b|\bul\s*(?:design\s*)?(?:no\.?\s*)?[a-z]?-?\d{3}\b|\b\d{2,3}\s*-?\s*min(?:ute)?s?\b|\bnon[\s-]*rated\b/i,
  },
  // A dimension states an attribute only next to a word naming that attribute: "3"x4" VENT CAP"
  // near an RTU is not a clearance, and "44" STAIR WIDTH" is a width.
  width: { claim: /\bwidths?\b|\bwide\b/i, value: cuedDimension(String.raw`widths?|wide|clear|w\.?`, String.raw`length|long|deep|depth|heights?|high`) },
  height: { claim: /\bheights?\b|\ba\.?\s*f\.?\s*f\.?\b|\bmounting\b/i, value: cuedDimension(String.raw`heights?|high|a\.?\s*f\.?\s*f\.?|above|t\.\s*o\.|top\s+of|mounted|max\.?|min\.?`) },
  clearance: { claim: /\bclearances?\b|\bclear\s+floor\s+space\b|\bmaneuvering\b|\bturning\s+space\b/i, value: cuedDimension(String.raw`clear(?:ance)?s?|min\.?|minimum|from|away|turning|maneuvering|space`) },
  riser_tread: { claim: /\brisers?\b|\btreads?\b/i, value: cuedDimension(String.raw`risers?|treads?|rise|run|r\s*=|t\s*=`) },
  opening: { claim: /\bopenings?\b(?=[^.]{0,40}\b(?:limit|size|sphere|diameter|pass))|\b4[\s-]*inch\s+(?:diameter\s+)?sphere\b/i, value: cuedDimension(String.raw`sphere|dia\.?|diameter|openings?|passage`) },
  distance: { claim: /\bdistances?\b|\bcommon\s+path\b|\bdead[\s-]*end\b/i, value: cuedDimension(String.raw`distances?|travel|path|dead\s*end|length|max\.?|<`) },
  signature: { claim: /\bsignatures?\b|\bsigned\b|\b(?:professional|engineer'?s?|architect'?s?|design professional'?s?)\s+(?:seal|stamp)\b|\b(?:sealed|stamped)\s+(?:and\s+signed\s+)?by\b|\bstamp(?:ed)?\b/i, value: /\bsigned\s+by\b|\bsignature\s*:\s*\S/i },
  thickness: { claim: /\bthickness(?:es)?\b/i, value: cuedDimension(String.raw`thick(?:ness)?|thk\.?|fiberglass|elastomeric|mineral\s+wool|insulation\s+shall\s+be|insulated\s+with`) },
  obstruction: { claim: /\bobstruct\w*|\bunobstructed\b|\bclear\s+(?:path|passage)\b|\bheadroom\b/i, value: /\bclear\s+(?:space|path|width|passage|headroom)\b|\bunobstructed\b|\bobstructions?\b|\bheadroom\b/i },
  occupant_load: { claim: /\boccupant\s+loads?\b|\bcapacity\b(?=[^.]{0,30}\begress)|\begress\s+capacit/i, value: /\b\d+\s*(?:occ(?:upants)?|persons?|people)\b|\boccupant\s+load\s*[:=]?\s*\d+/i },
  flow: { claim: /\bflow\s+rates?\b|\bgpm\b|\bairflow\b|\bcfm\b/i, value: /\b\d+(?:\.\d+)?\s*(?:gpm|cfm)\b/i },
  // A design flow ("FLOW RATE USED TO SELECT ...: 75 GPM") is not the equipment's rated capacity.
  capacity: {
    claim: /\bcapacity\b|\bsizing\b|\bsized?\b|\brated\s+(?:flow|capacity)\b/i,
    value: /\b(?:rated(?:\s+flow)?|capacity|cap\.)\s*(?:of\s*)?[:=]?\s*\d+(?:\.\d+)?\s*(?:gpm|gal(?:lons?)?\.?|lbs?|kva|kw|amps?|cfm)\b|\b\d+(?:\.\d+)?\s*(?:gpm|gal(?:lons?)?\.?|lbs?)\s+(?:rated|capacity)\b/i,
  },
  setpoint: { claim: /\bset\s*points?\b|\btemperature\b|°\s*f\b/i, value: /\b\d{2,3}\s*°?\s*f\b/i },
  duration: { claim: /\bduration\b|\b\d+(?:\.\d+)?\s*hours?\b(?=[^.]{0,40}\b(?:illuminat|battery|inverter))|\bbattery\b|\binverter\b/i, value: /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|min)\b/i },
  illumination: { claim: /\bfoot[\s-]*candles?\b|\billumination\b|\blux\b/i, value: /\b\d+(?:\.\d+)?\s*(?:foot[\s-]*candles?|fc|lux)\b/i },
  count: { claim: /\bnumber\s+of\b|\bcounts?\b|\b\d+%\b|\bpercent\b/i, value: /\b\d+\s+(?:ada|accessible|wheelchair)\b|\b(?:ada|accessible)\s+(?:seats?|spaces?)\s*[:=]?\s*\d+/i },
  location: { claim: /\blocations?\b|\bplacements?\b|\bplaced\b|\blocated\b|\bwhere\b/i, value: LOCATION_RE },
  material: { claim: /\bmaterials?\b|\bfasteners?\b|\bbolts?\b|\banchors?\b|\bpipe\s+(?:type|spec\w*)\b/i, value: MATERIAL_RE },
  listing: { claim: /\bul\s*\d+|\blisted\b|\blisting\b|\bnfpa\s*\d+|\bnsf\b|\bcertif\w*\b/i, value: /\bul\s*\d+|\blisted\b|\bnfpa\s*\d+|\bnsf\b|\bcertif\w*\b/i },
  edition: { claim: /\b(?:19|20)\d{2}\b|\bedition\b|\bcode\s+(?:reference|version)\b/i, value: /\b(?:19|20)\d{2}\b/ },
};

/** Attributes any element can carry. */
const UNIVERSAL_ATTRIBUTES = new Set(["listing", "material", "signature"]);
/**
 * Attributes extracted text can neither confirm nor rule out: a seal or signature is a stamp, and
 * whether a path is obstructed is shown by linework, not by a note.
 */
const NOT_TEXT_ATTRIBUTES = new Set(["signature", "obstruction"]);

/**
 * Building elements. `claim` finds the element in a finding; `mention` finds it on a drawing.
 * Order matters: the first element named in a finding title wins, so specific elements come first.
 */
const ELEMENTS = [
  { id: "grease_interceptor", label: "grease interceptor", claim: /\bgrease\s+(?:interceptor|trap)s?\b/i, owners: ["P"], attributes: ["flow", "capacity", "location"] },
  { id: "mixing_valve", label: "thermostatic mixing valve", claim: /\b(?:thermostatic\s+)?mixing\s+valves?\b|\btmv\b/i, owners: ["P"], attributes: ["setpoint", "location"] },
  { id: "floor_drain", label: "floor drain", claim: /\bfloor\s+drains?\b/i, owners: ["P"], attributes: ["location"] },
  { id: "cleanout", label: "cleanout", claim: /\b(?:wall\s+)?clean[\s-]*outs?\b/i, owners: ["P"], attributes: ["location"] },
  { id: "water_hammer", label: "water hammer arrester", claim: /\bwater[\s-]*hammer/i, owners: ["P"], attributes: ["location"] },
  { id: "backflow", label: "backflow preventer", claim: /\bbackflow\b|\brpz\b/i, owners: ["P"], attributes: ["location"] },
  { id: "draft_stop", label: "draft stop", claim: /\bdraft[\s-]*stop/i, owners: ["P", "A", "M", "E"], attributes: ["location"] },
  { id: "firestopping", label: "firestopping", claim: /\bfire[\s-]*stop(?:ping|s)?\b|\bpenetration\s+(?:seal|firestop)/i, owners: ["P", "M", "E", "A", "FP"], attributes: ["listing", "location"] },
  { id: "fire_damper", label: "fire damper", claim: /\b(?:fire|smoke)(?:\/smoke)?\s+dampers?\b/i, owners: ["M"], attributes: ["location", "rating"] },
  { id: "exhaust_hood", label: "kitchen exhaust hood", claim: /\b(?:kitchen\s+|exhaust\s+|type\s+i\s+)?hoods?\b/i, owners: ["M", "EQ"], attributes: ["listing", "clearance", "location"] },
  { id: "ventilation", label: "ventilation", claim: /\bventilation\b|\boutdoor\s+air\b|\bairflow\b/i, owners: ["M"], attributes: ["flow"] },
  { id: "rooftop_equipment", label: "rooftop equipment", claim: /\brooftop\b|\brtu\b|\broof\s+(?:equipment|opening|curb)s?\b|\bmechanical\s+equipment\s+clearances?\b/i, owners: ["M", "S"], attributes: ["clearance", "location"] },
  { id: "duct", label: "ductwork", claim: /\bduct(?:work|s)?\b/i, owners: ["M"], attributes: ["location"] },
  { id: "insulation", label: "pipe or duct insulation", claim: /\binsulat(?:ion|ed)\b/i, owners: ["M", "P"], attributes: ["thickness"] },
  { id: "piping", label: "piping", claim: /\bpip(?:e|es|ing)\b/i, owners: ["P", "M", "FP"], attributes: ["material", "location"] },
  { id: "emergency_lighting", label: "emergency lighting", claim: /\bemergency\s+light\w*|\begress\s+light\w*|\binverter\b/i, owners: ["E"], attributes: ["location", "duration", "illumination"] },
  { id: "exit_sign", label: "exit sign", claim: /\bexit\s+signs?\b/i, owners: ["E", "A"], attributes: ["location"] },
  { id: "gfci", label: "GFCI protection", claim: /\bgfci\b|\bground[\s-]*fault\b/i, owners: ["E"], attributes: ["location"] },
  { id: "grounding", label: "equipment grounding conductor", claim: /\bgrounding\b|\bground(?:ing)?\s+conductors?\b/i, owners: ["E"], attributes: [] },
  { id: "sprinkler", label: "sprinkler system", claim: /\bsprinklers?\b|\bhydraulic\b/i, owners: ["FP"], attributes: ["location", "flow"] },
  { id: "fdc", label: "fire department connection", claim: /\bfire\s+department\s+connections?\b|\bfdc\b/i, owners: ["FP", "A"], attributes: ["location"] },
  { id: "special_inspection", label: "special inspections", claim: /\bspecial\s+inspections?\b/i, owners: ["S", "G"], attributes: [] },
  { id: "energy_compliance", label: "energy code compliance", claim: /\benergy\s+(?:code|compliance|conservation)\b|\biecc\b|\bcomcheck\b/i, owners: ["EN", "G", "A", "M", "E"], attributes: ["edition"] },
  { id: "guard", label: "guard", claim: /\bguard(?:\s*rail)?s?\b|\bguardrails?\b/i, owners: ["A"], attributes: ["height", "opening"] },
  { id: "handrail", label: "handrail", claim: /\bhandrails?\b/i, owners: ["A"], attributes: ["height"] },
  { id: "stair", label: "stair", claim: /\bstairs?(?:\s+tower|way)?\b|\brisers?\b|\btreads?\b/i, owners: ["A"], attributes: ["riser_tread", "width"] },
  { id: "seating", label: "accessible seating", claim: /\b(?:ada|accessible|wheelchair)\s+seat(?:s|ing)?\b|\bseating\s+plan\b/i, owners: ["A"], attributes: ["count", "location"] },
  { id: "toilet_clearance", label: "toilet room clear floor space", claim: /\bwater\s+closets?\b|\btoilet\s+rooms?\b|\bclear\s+floor\s+space\b/i, owners: ["A"], attributes: ["clearance"] },
  { id: "accessory", label: "toilet accessory", claim: /\bmirrors?\b|\bgrab\s*bars?\b|\bdispensers?\b|\baccessor(?:y|ies)\b|\bcoat\s*hooks?\b/i, owners: ["A"], attributes: ["height"] },
  { id: "counter", label: "counter", claim: /\bcounters?\b|\bwork\s*surfaces?\b/i, owners: ["A", "EQ"], attributes: ["height", "clearance"] },
  { id: "travel_distance", label: "travel distance", claim: /\btravel\s+distances?\b|\bcommon\s+path\b|\bdead[\s-]*end/i, owners: ["A"], attributes: ["distance"] },
  { id: "occupant_load", label: "occupant load and egress capacity", claim: /\boccupant\s+loads?\b|\begress\s+capacit\w*|\boccupancy\s+calculations?\b|\bsignage\b(?=[^.]{0,30}\boccupant)/i, owners: ["A"], attributes: ["occupant_load", "width"] },
  { id: "fire_rated_assembly", label: "fire-rated wall or partition", claim: /\bfire[\s-]*(?:rated|rating|resist\w*|separation)\b(?=[^.]{0,60}\b(?:partitions?|walls?|assembl\w+|barriers?|separations?|structural|components?|elements?)\b)|\b(?:partitions?|walls?)\b(?=[^.]{0,40}\bfire[\s-]*(?:rat|resist|separation))|\bfire\s+(?:barriers?|partitions?|walls?|separations?)\b|\brated\s+(?:partitions?|walls?|assembl\w+)\b|\b(?:hour|hr)[\s-]*rated\s+partitions?\b/i, mention: /\bpartitions?\b|\bwalls?\b(?![\s-]*(?:mount\w*|hung|packs?|sconces?|cabinets?|sections?)\b)|\bwall\s+types?\b|\bassembl(?:y|ies)\b|\bfire\s+barriers?\b|\bfire\s+separations?\b/i, owners: ["A", "G"], attributes: ["rating", "location"] },
  { id: "egress_path", label: "egress path", claim: /\begress(?:\s+(?:path|route|width))?\b|\bmeans\s+of\s+egress\b|\bexit\s+access\b|\bcorridors?\b|\baisles?\b|\bexit\s+(?:path|route|discharge)\b/i, owners: ["A"], attributes: ["width", "clearance", "location", "obstruction"] },
  { id: "glazing", label: "glazing", claim: /\bglaz(?:ing|ed)\b|\bsafety\s+glass\b|\btempered\s+glass\b/i, owners: ["A"], attributes: ["height", "location", "listing"] },
  { id: "door", label: "door", claim: /\bdoors?(?:way)?s?\b/i, owners: ["A"], attributes: ["width", "clearance", "rating"] },
  { id: "accessible_route", label: "accessible route", claim: /\baccessib(?:le|ility)\b|\bada\b/i, mention: /\baccessible\s+(?:routes?|paths?|entrances?|parking|means\s+of\s+egress)\b|\bada\s+(?:routes?|paths?|entrances?)\b/i, owners: ["A"], attributes: ["width", "clearance"] },
  { id: "structural_framing", label: "structural framing and connections", claim: /\bconnections?\b|\bbeams?\b|\bcolumns?\b|\bjoists?\b|\bframing\b|\bstructural\s+(?:details?|notes?|elements?|components?)\b|\bfootings?\b/i, owners: ["S"], attributes: [] },
];

for (const element of ELEMENTS) {
  if (!element.mention) element.mention = new RegExp(element.claim.source.replace(/\(\?=[^)]*\)/g, ""), "i");
}

const ABBREVIATION_RE =
  /\b(?:min|max|typ|no|dia|approx|exist|req|mfr|sim|std|thk|ga|ft|in|hr|hrs|ea|eq|w|h|o\.c|a\.f\.f|t\.o|v\.i\.f|u\.n\.o)\.(?=\s*[^\s\d])/gi;

const RELATION_BEFORE_RE =
  /\b(?:at|of|through|thru|in|into|within|on|onto|above|below|beneath|under|over|behind|near|adjacent\s+to|next\s+to|from|for|to|with|penetrat\w*)\s+(?:all\s+|each\s+|the\s+|any\s+|new\s+|existing\s+)?(?:[a-z0-9"'\-./]+\s+){0,3}$/i;
function claimText(issue) {
  return [
    issue?.diagnostics?.originalTitle || issue?.title,
    issue?.diagnostics?.originalDescription || issue?.description,
  ].filter(Boolean).join(". ").replace(/\s*[—-]\s*verification required/gi, "");
}

/** The element a finding is about: named in its title first, then in its description. */
function claimElement(issue) {
  const title = String(issue?.diagnostics?.originalTitle || issue?.title || "").replace(/\s*[—-]\s*verification required/gi, "");
  const body = claimText(issue);
  return ELEMENTS.find((element) => element.claim.test(title))
    || ELEMENTS.find((element) => element.claim.test(body))
    || null;
}

const MISSING_RE =
  /\b(?:not\s+(?:shown|provided|indicated|labeled|labelled|specified|visible|dimensioned|annotated|noted|marked|depicted|clearly\s+\w+)|missing|absent|does\s+not\s+(?:show|specify|provide|indicate|include|display|identify|contain|have)|lacks?|lacking|no\s+(?:clear\s+)?(?:details?|information|indication|specification|dimensions?)|unclear|without)\b/i;
const DEFICIENCY_RE =
  /\b(?:does\s+not\s+meet|non-?complian\w*|insufficient|inadequate|too\s+narrow|below\s+(?:the\s+)?minimum|exceeds?|less\s+than|greater\s+than|obstruct\w*|conflicts?|discrepanc\w*|inconsisten\w*|fails?\s+to)\b/i;
const NORMATIVE_RE = /\b(?:must|should|shall|ensure|needs?\s+to|required\s+to|requires?\s+(?:verification|confirmation|coordination))\b/i;

/**
 * What the finding claims: the element, the attributes at issue, and whether it says the
 * information is missing, says a value is deficient, or only restates a requirement.
 */
function parseClaim(issue) {
  const text = claimText(issue);
  const element = claimElement(issue);
  const attributes = Object.entries(ATTRIBUTES)
    .filter(([id, attribute]) => attribute.claim.test(text) && (!element || element.attributes.includes(id) || UNIVERSAL_ATTRIBUTES.has(id)))
    .map(([id]) => id);
  const findingType = String(issue?.findingType || "").toLowerCase();
  const kind = MISSING_RE.test(text) || findingType === "missing_information" && !DEFICIENCY_RE.test(text) && !NORMATIVE_RE.test(text)
    ? "missing"
    : DEFICIENCY_RE.test(text)
      ? "deficiency"
      : NORMATIVE_RE.test(text)
        ? "reminder"
        : findingType === "missing_information" || findingType === "unverified" ? "missing" : "concern";
  const values = [...text.matchAll(new RegExp(DIMENSION_SOURCE, "gi"))].map((match) => match[0].trim());
  return { element, attributes, kind, values, text };
}

/**
 * Clauses: notes, lines, and sentences. A numbered note ("3. ALL ...") starts a clause. A decimal
 * point or a drafting abbreviation ("40" MIN. 6'-0" MIN.", "16" O.C.") does not end one.
 */
function clauses(text) {
  const original = String(text || "");
  const masked = original.replace(ABBREVIATION_RE, (match) => match.replace(/\./g, "\u2024"));
  const out = [];
  const re = /[^\n.;]+(?:\.(?=\d)[^\n.;]*)*[.;]?/g;
  let match;
  while ((match = re.exec(masked))) {
    const value = original.slice(match.index, match.index + match[0].length);
    if (value.trim()) out.push({ text: value, start: match.index });
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function mentions(text, regex) {
  const re = new RegExp(regex.source, "gi");
  const out = [];
  let match;
  while ((match = re.exec(text))) {
    out.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

/**
 * Spans of text that are about this element: from the mention to the next other element,
 * within one clause. A mention that only qualifies another element ("firestopping at rated
 * walls", "hood 18 inches above the counter") is not about this element.
 */
function elementSpans(text, element) {
  const spans = [];
  for (const clause of clauses(text)) {
    const own = mentions(clause.text, element.mention);
    if (!own.length) continue;
    const all = ELEMENTS
      .filter((other) => other.id !== element.id)
      .flatMap((other) => mentions(clause.text, other.mention).map((hit) => ({ ...hit, id: other.id })))
      .filter((hit) => !own.some((mine) => hit.start < mine.end && mine.start < hit.end));
    const follows = (mine, hit) => hit.start >= mine.end && /^[\s-]{0,2}$/.test(clause.text.slice(mine.end, hit.start));
    // In a compound the last noun is the head: "EGRESS DOOR WIDTH" is a door, so "egress" there
    // only modifies it. A trailing generic wall noun names this element's kind ("DRAFT STOP WALLS").
    const others = all.filter((hit) => !(hit.id === "fire_rated_assembly" && own.some((mine) => follows(mine, hit))));
    for (const mine of own) {
      if (others.some((hit) => follows(mine, hit))) continue;
      const before = others.filter((hit) => hit.end <= mine.start);
      const after = others.filter((hit) => hit.start >= mine.end);
      const lead = clause.text.slice(Math.max(0, mine.start - 40), mine.start);
      if (before.length && RELATION_BEFORE_RE.test(lead)) continue;
      const from = Math.max(before.length ? before[before.length - 1].end : 0, mine.start - 60);
      const to = Math.min(after.length ? after[0].start : clause.text.length, mine.end + 90);
      spans.push({ text: clause.text.slice(from, to).trim(), start: clause.start + from });
    }
  }
  return spans;
}

const SCALE_RE = /\bscale\s*:?|\b\d+(?:[-\s]?\d+)?(?:\/\d+)?\s*["″]\s*=\s*1\s*['′]\s*-?\s*0\s*["″]?|\bn\.?\s*t\.?\s*s\.?(?=\s|$)/gi;

/** Drawing scales ("3/4" = 1'-0"") are not dimensions of anything drawn. */
function withoutScales(text) {
  return String(text || "").replace(SCALE_RE, " ");
}

/**
 * The quote that states this attribute of this element, or null. With no attribute, a span that
 * specifies the element (a requirement, a type, a dimension) counts.
 */
function boundEvidence(text, claim) {
  if (!claim?.element || !text) return null;
  const wanted = claim.attributes.filter((id) => claim.element.attributes.includes(id) || UNIVERSAL_ATTRIBUTES.has(id));
  for (const span of elementSpans(withoutScales(text), claim.element)) {
    if (!wanted.length) {
      if (SPEC_CUE_RE.test(span.text)) return { quote: span.text.slice(0, 220), attribute: null };
      continue;
    }
    const attribute = wanted.find((id) => ATTRIBUTES[id].value.test(span.text));
    if (attribute) return { quote: span.text.slice(0, 220), attribute };
  }
  return null;
}

/**
 * Per-attribute evidence across several sources. A claim about three attributes is answered only
 * when all three are stated; a claim that names no attribute is answered by a specifying span.
 * @param {Array<{ text: string; sheet?: string | null }>} sources
 */
function attributeEvidence(sources, claim) {
  if (!claim?.element) return { found: {}, missing: [], answered: false };
  const wanted = claim.attributes.length ? claim.attributes : [null];
  const found = {};
  for (const attribute of wanted) {
    if (NOT_TEXT_ATTRIBUTES.has(attribute)) continue;
    for (const source of sources || []) {
      const bound = boundEvidence(source.text, { ...claim, attributes: attribute ? [attribute] : [] });
      if (!bound) continue;
      found[attribute || "specification"] = { quote: bound.quote, sheet: source.sheet || null };
      break;
    }
  }
  const missing = wanted.filter((attribute) => !found[attribute || "specification"]).map((attribute) => attribute || "specification");
  return { found, missing, answered: missing.length === 0 };
}

const GRAPHIC_ONLY_ATTRIBUTES = new Set(["location", "clearance", "width", "riser_tread", "distance", "opening", "height"]);

function graphicUnread(ctx) {
  const status = String(ctx?.graphicalReadStatus || "");
  if (/ocr_unavailable|unreadable/.test(status)) return true;
  return (ctx?.regions || []).some((region) =>
    region && /ocr_unavailable/i.test(String(region.limitations || region.status || "")));
}

/** Discipline letter from a sheet name (A, S, M, P, E, EQ, FP, EN, G); "" when none. */
function sheetDiscipline(record) {
  const name = `${record?.fileName || ""} ${record?.sheetNumber || ""}`.toUpperCase();
  const prefix = (name.match(/(?:^|[\s/])([A-Z]{1,3})[-.\s]?\d/) || [])[1] || "";
  if (prefix === "FP" || prefix === "F") return "FP";
  if (prefix === "EN") return "EN";
  if (prefix === "EQ" || prefix === "K" || prefix === "FS") return "EQ";
  if (prefix === "LS") return "A";
  if (/^(G|CV|T|GI|GN)$/.test(prefix)) return "G";
  if (/^(MD|M)$/.test(prefix)) return "M";
  if (/^(PD|P)$/.test(prefix)) return "P";
  if (/^(ED|E)$/.test(prefix)) return "E";
  if (/^(AD|A|DM|D|ID|I)$/.test(prefix)) return "A";
  return prefix.slice(0, 1);
}

/** The sheet's discipline normally states this element. */
function ownsElement(ctx, element) {
  const own = sheetDiscipline({ fileName: ctx?.fileName || ctx?.sheetTitle, sheetNumber: ctx?.sheetNumber });
  return Boolean(own && element?.owners?.includes(own));
}

function recordSource(record) {
  return {
    sheet: record?.fileName || record?.sheetNumber || record?.title || "another sheet",
    text: [record?.text, record?.excerpt, record?.fullText, ...(record?.observations || []).map((item) => item?.quote || "")]
      .filter(Boolean).join("\n"),
  };
}

/**
 * Other sheets that may answer a claim about this element: the same discipline, a general or
 * cover sheet, or a discipline that owns the element. An unrelated discipline is not evidence.
 */
function relatedSources(claim, ctx) {
  if (!claim?.element) return [];
  const current = String(ctx?.fileName || ctx?.sheetTitle || "").trim().toLowerCase();
  const own = sheetDiscipline({ fileName: ctx?.fileName || ctx?.sheetTitle, sheetNumber: ctx?.sheetNumber });
  const seen = new Set();
  const ranked = [];
  for (const record of [...(ctx?.drawingRecords || []), ...(ctx?.sheetIndex || [])]) {
    const name = String(record?.fileName || "").trim().toLowerCase();
    if (!record || (name && name === current) || seen.has(name)) continue;
    const rank = answerRank(claim, own, record);
    if (rank < 0) continue;
    const source = recordSource(record);
    if (!source.text.trim()) continue;
    seen.add(name);
    ranked.push({ source, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.source);
}

/**
 * Whether a record's discipline may answer a claim about this element: 0 owner, 1 same
 * discipline, 2 general sheet, -1 not at all. A claim that names no attribute is answered only
 * where the element is specified; a cover-sheet scope line ("PROVIDE A NEW SPRINKLER SYSTEM") is not that.
 */
function answerRank(claim, ownDiscipline, record) {
  const theirs = sheetDiscipline(record);
  if (claim.element.owners.includes(theirs)) return 0;
  if (theirs && theirs === ownDiscipline) return 1;
  if (theirs === "G" && claim.attributes.length > 0) return 2;
  return -1;
}

/**
 * Present, absent after adequate review, unreadable, or not relevant. Absence is never inferred
 * when the graphic content of the sheet was not read and the fact could be drawn rather than written.
 */
function evidenceState(claim, ctx) {
  const pageText = String(ctx?.pageText || "");
  const own = ctx?.fileName || ctx?.sheetTitle || null;
  const onSheet = attributeEvidence([{ text: pageText, sheet: own }], claim);
  const firstQuote = Object.values(onSheet.found)[0]?.quote || null;
  if (onSheet.answered) return { state: "present", source: "sheet_text", quote: firstQuote, found: onSheet.found, missing: [] };
  const modelQuotes = (ctx?.observedEvidence ? [].concat(ctx.observedEvidence) : []).filter((item) => typeof item === "string");
  const modelRead = attributeEvidence([{ text: modelQuotes.join("\n"), sheet: own }], claim);
  if (modelRead.answered) {
    return { state: "present", source: "model_graphic_read", quote: Object.values(modelRead.found)[0]?.quote || null, found: modelRead.found, missing: [], uncorroborated: true };
  }
  if (!claim?.element) return { state: "not_assessed", source: null, quote: null, found: {}, missing: [] };
  const named = elementSpans(pageText, claim.element).length > 0;
  const missing = onSheet.missing;
  const drawable = missing.some((id) => id === "specification" || GRAPHIC_ONLY_ATTRIBUTES.has(id));
  if (graphicUnread(ctx) && (drawable || !named)) {
    return { state: "unreadable", source: null, quote: firstQuote, found: onSheet.found, missing, reason: "graphic_content_unread" };
  }
  if (!named && !ownsElement(ctx, claim.element)) {
    return { state: "not_relevant", source: null, quote: null, found: {}, missing, reason: "element_not_on_this_discipline_sheet" };
  }
  // Extracted text loses a table's row and column order, so a named schedule may hold the value.
  const spans = elementSpans(pageText, claim.element);
  const tabular = spans.some((span) => TABLE_RE.test(span.text));
  const stamped = missing.some((id) => NOT_TEXT_ATTRIBUTES.has(id));
  // Every mention is an existing element ("EXISTING RISERS, TREADS"): whether the work alters it,
  // and so whether new-work dimensions are required, is the open premise.
  const drawn = spans.filter((span) => !DRAWING_TITLE_RE.test(span.text));
  const existing = drawn.length > 0 && drawn.every((span) => EXISTING_RE.test(span.text));
  // The sheet prints a value of this attribute that text cannot tie to a drawn element (a
  // dimension string beside linework): absence is not established.
  const unbound = missing.some((id) => ATTRIBUTES[id] && ATTRIBUTES[id].value.test(withoutScales(pageText)));
  return {
    state: "absent",
    source: "sheet_text",
    quote: firstQuote,
    found: onSheet.found,
    missing,
    named,
    adequate: graphicReadComplete(ctx) && !tabular && !stamped && !existing && !unbound,
    reason: stamped ? "graphic_evidence_unavailable"
      : tabular ? "schedule_values_not_bound"
        : existing ? "existing_element_scope"
          : unbound ? "value_not_bound_to_element"
            : null,
  };
}

const EXISTING_RE = /\bexist(?:ing|\.)?(?=\W|$)|\b\(e\)/i;
const DRAWING_TITLE_RE = /\b(?:sections?|details?|elevations?|plans?)\s*(?:@|at)\s|\bscale\b|=\s*1\s*'/i;

const TABLE_RE = /\b(?:schedule|table|calculations?|legend)\b/i;

/**
 * The sheet's graphic text was read (or it had none), so a fact not found is absent, not unread.
 * "text-layer" means graphic OCR was skipped: drawn labels were not read, so absence is not inferred.
 */
function graphicReadComplete(ctx) {
  return /^(?:recognized|no_graphic_text)$/.test(String(ctx?.graphicalReadStatus || ""));
}

const NORMATIVE_NOTE_RE = /\b(?:shall|provide[ds]?|must|required|install)\b/i;

/** Every quote only restates a requirement ("PROVIDE X AT EACH Y") and states no measured value. */
function onlyRequirementNotes(found) {
  const quotes = Object.values(found || {}).map((item) => String(item.quote || ""));
  return quotes.length > 0 && quotes.every((quote) => NORMATIVE_NOTE_RE.test(quote) && !DIMENSION_RE.test(quote)
    && !ATTRIBUTES.rating.value.test(quote) && !ATTRIBUTES.flow.value.test(quote));
}

/* ---------------------------- calculations ---------------------------- */

const UNIT_SOURCE = String.raw`gpm|cfm|psi|gal(?:lons?)?\.?|persons?|occupants?|sf|sq\.?\s*ft|minutes?|min|in\.?|inches|ft|feet|w|watts|kw|amps?|%`;
const LABELLED_VALUE_RE = new RegExp(String.raw`([A-Z][A-Z0-9 ,()\-\/.&]{2,90}?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*(${UNIT_SOURCE})\b`, "gi");
const METHOD_RE =
  /([A-Z][A-Z \-]{2,60}?)\s*=\s*\(?\s*(LESSER|SMALLER|MINIMUM|GREATER|LARGER|MAXIMUM)\s+OF\s+(.{3,80}?)\s+AND\s+(.{3,80}?)\s*\)/i;
const STOP_LABEL = new Set(["the", "of", "and", "by", "to", "a", "for", "rate", "flow", "size"]);

function labelWords(label) {
  return String(label || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => !STOP_LABEL.has(word)) || [];
}

function labelledValues(text) {
  const out = [];
  for (const match of String(text || "").matchAll(LABELLED_VALUE_RE)) {
    out.push({ label: match[1].replace(/\s+/g, " ").trim(), value: Number(match[2]), unit: match[3].toLowerCase().replace(/\.$/, ""), raw: match[0].trim() });
  }
  return out;
}

function matchOperand(operand, values, unit, context) {
  const words = labelWords(operand);
  const scored = values
    .filter((item) => !unit || item.unit === unit)
    .map((item) => {
      const label = labelWords(item.label);
      return { item, score: words.filter((word) => label.includes(word)).length };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored.filter((entry) => entry.score === scored[0].score).map((entry) => entry.item);
  if (top.length === 1) return top[0];
  // Several labelled variants ("2-MINUTE", "1-MINUTE"): the one matching a stated design parameter.
  const chosen = top.find((item) => context.some((param) => item.label.toLowerCase().includes(`${param.value}-${param.unit.replace(/s$/, "")}`)));
  return chosen || null;
}

/**
 * Reconcile the values a finding compares with the calculation printed on the sheet. Values
 * connected by a stated method (lesser of, greater of) are not a discrepancy.
 */
function reconcileCalculation(issue, text) {
  const claim = claimText(issue);
  const claimed = [...claim.matchAll(/\b(\d+(?:\.\d+)?)\s*(gpm|cfm|psi|gal|persons?|occupants?|watts|w|kw)\b/gi)].map((match) => Number(match[1]));
  const distinct = [...new Set(claimed)];
  if (distinct.length < 2) return null;
  const source = String(text || "");
  const values = labelledValues(source);
  const printed = distinct.filter((value) => values.some((item) => item.value === value));
  if (printed.length < 2) return null;
  const method = source.match(METHOD_RE);
  const record = {
    values: values.filter((item) => distinct.includes(item.value)).map((item) => ({ label: item.label, value: item.value, unit: item.unit })),
    method: null,
    governing: null,
    explained: false,
    summary: "",
  };
  if (!method) {
    record.summary = `The sheet prints ${printed.join(" and ")} but states no method connecting them.`;
    return record;
  }
  const unit = values.find((item) => item.value === printed[0])?.unit || null;
  const params = values.filter((item) => /minutes?|min/.test(item.unit));
  const first = matchOperand(method[3], values, unit, params);
  const second = matchOperand(method[4], values, unit, params);
  if (!first || !second) {
    record.summary = `The sheet states "${method[0].trim()}" but its operands could not both be matched to printed values.`;
    return record;
  }
  const lesser = /LESSER|SMALLER|MINIMUM/i.test(method[2]);
  const governing = lesser ? Math.min(first.value, second.value) : Math.max(first.value, second.value);
  const accounted = new Set([first.value, second.value, governing]);
  const alternates = values.filter((item) => item.unit === unit && labelWords(item.label).some((word) => labelWords(second.label).includes(word)));
  for (const item of alternates) accounted.add(item.value);
  record.method = {
    statement: method[0].replace(/\s+/g, " ").trim(),
    rule: lesser ? "lesser" : "greater",
    target: method[1].trim(),
    operands: [first, second].map((item) => ({ label: item.label, value: item.value, unit: item.unit })),
  };
  record.governing = { label: method[1].trim(), value: governing, unit };
  record.explained = printed.every((value) => accounted.has(value));
  record.summary = record.explained
    ? `${method[1].trim()} is the ${lesser ? "lesser" : "greater"} of ${first.label} (${first.value} ${unit}) and ${second.label} (${second.value} ${unit}), so ${governing} ${unit} governs. The printed values are consistent with the stated method.`
    : `The stated method gives ${governing} ${unit}, but ${printed.filter((value) => !accounted.has(value)).join(", ")} is not explained by it.`;
  return record;
}

const COMPARISON_RE =
  /(\d+\s*['′]\s*-?\s*\d+(?:\s*\d\/\d)?\s*["″]?|\d+(?:\.\d+)?\s*(?:ft|feet|'|in|"|gpm|persons|occupants))\s*(<=|>=|≤|≥|<|>)\s*(\d+\s*['′]\s*-?\s*\d+(?:\s*\d\/\d)?\s*["″]?|\d+(?:\.\d+)?\s*(?:ft|feet|'|in|"|gpm|persons|occupants)?)/gi;

function toNumber(value) {
  const text = String(value || "").trim();
  const feetInches = text.match(/^(\d+)\s*['′]\s*-?\s*(\d+)?(?:\s*(\d)\/(\d))?/);
  if (feetInches) {
    const inches = Number(feetInches[2] || 0) + (feetInches[3] ? Number(feetInches[3]) / Number(feetInches[4]) : 0);
    return Number(feetInches[1]) + inches / 12;
  }
  const inch = text.match(/^(\d+(?:\.\d+)?)\s*(?:in|")$/i);
  if (inch) return Number(inch[1]) / 12;
  const plain = text.match(/^(\d+(?:\.\d+)?)/);
  return plain ? Number(plain[1]) : NaN;
}

/** Comparisons printed on a sheet ("32'-2" < 200 FT") checked arithmetically. */
function statedComparisons(text) {
  const out = [];
  for (const match of String(text || "").matchAll(COMPARISON_RE)) {
    const left = toNumber(match[1]);
    const right = toNumber(match[3]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const op = match[2];
    const holds = op === "<" ? left < right
      : op === ">" ? left > right
        : op === "<=" || op === "≤" ? left <= right
          : left >= right;
    out.push({ statement: match[0].replace(/\s+/g, " ").trim(), holds });
  }
  return out;
}

/* ---------------------------- the record ---------------------------- */

const OUTCOMES = ["published", "open_check", "resolved_by_evidence", "not_applicable", "correctly_rejected", "reconsider"];

const NOT_APPLICABLE = new Set([
  "residential_requirement_on_commercial", "accessible_route_outside_discipline", "egress_outside_discipline",
  "egress_outside_energy_certificate", "egress_width_outside_sheet", "exit_sign_on_wall_section", "wrong_sheet_for_element",
  "element_not_on_sheet", "outside_sheet_scope", "explicit_general_ibc", "corridor_width_not_on_equipment_plan",
  "element_not_on_this_discipline_sheet",
]);
const RESOLVED = new Set([
  "cross_sheet_answers_question", "cross_sheet_supplies_fact", "dimension_answered_on_other_sheet",
  "special_inspection_documented", "information_present", "calculation_reconciled",
]);
const OPEN = new Set([
  "cross_sheet_owner", "requirement_reminder", "detail_unreadable", "rated_assembly_unconfirmed",
  "documented_design_provision", "requirement_already_on_sheet", "requirement_already_specified", "already_noted",
  "special_inspection_retrieval_unavailable", "drawing_retrieval_unavailable", "claim_not_tied_to_evidence",
  "incomplete_question", "graphic_evidence_unavailable", "resolution_not_element_bound", "fact_not_found",
  "calculation_unresolved", "model_reported_present", "schedule_values_not_bound", "existing_element_scope",
  "value_not_bound_to_element", "element_not_established", "rated_assembly_not_established",
  "requirement_note_not_measurement",
  "governing_code_unverified",
]);

/** Why a check stays open, in the words a reviewer uses. */
const OPEN_REASON = {
  graphic_evidence_unavailable: "evidence_unavailable",
  drawing_retrieval_unavailable: "evidence_unavailable",
  special_inspection_retrieval_unavailable: "evidence_unavailable",
  detail_unreadable: "evidence_unavailable",
  model_reported_present: "evidence_unavailable",
  schedule_values_not_bound: "evidence_unavailable",
  value_not_bound_to_element: "evidence_unavailable",
  resolution_not_element_bound: "reconsider",
  fact_not_found: "fact_not_found",
  cross_sheet_owner: "fact_not_found",
  requirement_reminder: "fact_not_found",
  claim_not_tied_to_evidence: "fact_not_found",
  incomplete_question: "fact_not_found",
  rated_assembly_unconfirmed: "premise_unconfirmed",
  rated_assembly_not_established: "premise_unconfirmed",
  element_not_established: "premise_unconfirmed",
  requirement_note_not_measurement: "premise_unconfirmed",
  governing_code_unverified: "requirement_unverified",
  existing_element_scope: "premise_unconfirmed",
  calculation_unresolved: "calculation_unresolved",
  documented_design_provision: "requirement_unverified",
  requirement_already_on_sheet: "requirement_unverified",
  requirement_already_specified: "requirement_unverified",
  already_noted: "requirement_unverified",
};

function outcomeForReason(reason, userVisible) {
  if (userVisible) return "published";
  if (NOT_APPLICABLE.has(reason)) return "not_applicable";
  if (RESOLVED.has(reason)) return "resolved_by_evidence";
  if (OPEN.has(reason)) return "open_check";
  return "correctly_rejected";
}

function codeStatus(issue, ctx) {
  const legal = ctx?.legalApplicability || null;
  const provision = issue?.provenance?.codeProvisionId || null;
  return {
    citation: issue?.codeReference || null,
    selectedEdition: legal?.selectedEdition || ctx?.codeYear || null,
    adoptedEdition: legal?.adoptedEdition || null,
    legalStatus: legal?.status || "unverified",
    reviewScope: legal?.reviewScope || "reference_only",
    amendmentsEnforced: Boolean(ctx?.jurisdictionScope?.amendmentsEnforced),
    provisionId: provision,
    textStatus: issue?.provenance?.codeSourceStatus === "authoritative" ? "verified_text" : provision ? "unverified_text" : "no_text",
    citationSupported: issue?.provenance?.codeSourceStatus === "authoritative",
    coverageClass: issue?.provenance?.coverageClass
      || (issue?.provenance?.codeSourceStatus === "authoritative" ? "verified_requirement" : "missing_coverage"),
    technicalComparison: issue?.provenance?.technicalComparison || null,
  };
}

/**
 * The structured record for one candidate after the verifier decided. It carries what was
 * checked, the evidence for it, and why it was published, kept open, or closed.
 * @param {Record<string, unknown>} issue  candidate after applyDecision
 * @param {Record<string, unknown>} ctx    verifier context (pageText, drawingRecords, regions, legalApplicability, ...)
 */
function buildEvaluation(issue, ctx = {}) {
  const claim = parseClaim(issue);
  const observed = evidenceState(claim, ctx);
  const reason = String(issue?.validationReason || "");
  const visible = issue?.userVisible === true;
  const related = [];
  for (const source of relatedSources(claim, ctx)) {
    const bound = boundEvidence(source.text, claim);
    if (!bound) continue;
    related.push({ sheet: source.sheet, quote: bound.quote, attribute: bound.attribute, why: `States the ${bound.attribute || "specification"} of the ${claim.element.label}.` });
    if (related.length >= 3) break;
  }
  const calculation = reconcileCalculation(issue, ctx.pageText);
  let outcome = outcomeForReason(reason, visible);
  let reconsidered = null;
  if (outcome === "resolved_by_evidence" && claim.element && reason !== "special_inspection_documented" && reason !== "calculation_reconciled") {
    const supports = reason === "information_present" ? observed.state === "present" : related.length > 0;
    if (!supports) {
      reconsidered = { originalReason: reason, why: `No related sheet states the ${claim.attributes.join(" or ") || "specification"} of the ${claim.element.label}; the resolving passage was about a different element or attribute.` };
      outcome = "reconsider";
    }
  }
  const openReason = outcome === "open_check" ? OPEN_REASON[reason] || "fact_not_found" : outcome === "reconsider" ? "reconsider" : null;
  return {
    requirement: {
      element: claim.element?.id || null,
      elementLabel: claim.element?.label || null,
      attributes: claim.attributes,
      claimKind: claim.kind,
      ...codeStatus(issue, ctx),
    },
    applicability: NOT_APPLICABLE.has(reason) ? "not_applicable" : claim.element ? "applicable" : "undetermined",
    expected: claim.attributes.length
      ? `${claim.element?.label || "The element"}: ${claim.attributes.join(", ")} stated on the drawings`
      : claim.element ? `${claim.element.label} specified on the drawings` : null,
    observed: {
      state: observed.state,
      source: observed.source || null,
      quote: observed.quote || null,
      uncorroborated: Boolean(observed.uncorroborated),
      reason: observed.reason || null,
    },
    evidenceLocation: { sheet: ctx.fileName || ctx.sheetTitle || null, regions: (ctx.regions || []).filter((region) => region?.readable && region?.quote).length },
    related,
    calculation,
    verification: {
      outcome,
      reason,
      detail: issue?.validationDetail || null,
      openReason,
      reconsidered,
    },
    publication: visible
      ? "Published as a verification question; it is not a confirmed violation unless a verified provision and measured evidence agree."
      : outcome === "open_check"
        ? "Withheld from findings and kept as an unresolved check. Withholding it is not proof of compliance."
        : outcome === "reconsider"
          ? "Withheld, but the suppression is not supported by element-bound evidence; a reviewer should reconsider it."
          : "Closed: not published as a finding.",
  };
}

module.exports = {
  ELEMENTS,
  ATTRIBUTES,
  NOT_TEXT_ATTRIBUTES,
  OUTCOMES,
  parseClaim,
  claimElement,
  elementSpans,
  boundEvidence,
  attributeEvidence,
  evidenceState,
  sheetDiscipline,
  ownsElement,
  relatedSources,
  answerRank,
  graphicUnread,
  graphicReadComplete,
  onlyRequirementNotes,
  reconcileCalculation,
  statedComparisons,
  labelledValues,
  buildEvaluation,
  outcomeForReason,
};
