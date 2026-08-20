"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATES_ROOT = path.resolve(__dirname, "../../../../uci/load-templates");
const OVERSIZED_ELECTRIC_AMPS = 800;
const STANDARD_AMP_SIZES = [100, 200, 400, 600, 800, 1000, 1200, 1600, 2000, 2500, 3000];

const GAS_LINE_TABLE = [
  { maxCfh: 150, size: "1\"", rating: "150 cfh @ 7\" wc" },
  { maxCfh: 250, size: "1.25\"", rating: "250 cfh @ 7\" wc" },
  { maxCfh: 400, size: "1.5\"", rating: "400 cfh @ 7\" wc" },
  { maxCfh: 600, size: "2\"", rating: "600 cfh @ 7\" wc" },
  { maxCfh: 1100, size: "2.5\"", rating: "1100 cfh @ 7\" wc" },
  { maxCfh: 99999, size: "3\"", rating: "3\" @ 7\" wc" },
];

const WATER_METER_TABLE = [
  { maxDfu: 20, size: "5/8\"" },
  { maxDfu: 50, size: "3/4\"" },
  { maxDfu: 100, size: "1\"" },
  { maxDfu: 200, size: "1.5\"" },
  { maxDfu: 99999, size: "2\"" },
];

function num(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value.value != null) return num(value.value);
  const n = Number(String(value).replace(/[,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadPrototypeTemplate(project) {
  const portal = project?.portal_data && typeof project.portal_data === "object" ? project.portal_data : {};
  const prototypeId = String(project?.restaurant_prototype || portal.restaurant_prototype || "").trim().toLowerCase();
  if (prototypeId && /mcdonald|mcd/.test(prototypeId)) {
    const mcd = loadJsonIfExists(path.join(TEMPLATES_ROOT, "mcdonalds-standalone.json"));
    if (mcd) {
      return { template: mcd, id: mcd.id || "mcdonalds_standalone", source: "mcdonalds_seed" };
    }
  }
  const named = prototypeId
    ? loadJsonIfExists(path.join(TEMPLATES_ROOT, `${prototypeId.replace(/[^a-z0-9_-]+/g, "-")}.json`))
    : null;
  if (named) {
    return { template: named, id: named.id || prototypeId, source: "named_prototype" };
  }
  const generic = loadJsonIfExists(path.join(TEMPLATES_ROOT, "generic-qsr.json"));
  return {
    template: generic,
    id: generic?.id || "generic_qsr_v1",
    source: "generic_qsr_fallback",
    unrecognized: Boolean(prototypeId) && !named,
  };
}

function nextStandardAmps(amps) {
  const n = Math.ceil(Number(amps) || 0);
  for (const size of STANDARD_AMP_SIZES) {
    if (size >= n) return size;
  }
  return n;
}

function calculated(value, unit, source, extra = {}) {
  if (value == null || value === "") return null;
  return {
    value,
    unit: unit || null,
    source,
    provenance: extra.provenance || source,
    needs_verification: extra.needs_verification === true,
    ...extra,
  };
}

function equipmentKw(row) {
  const kw = num(row.connected_kw || row.kw || row.load_kw);
  if (kw != null) return kw;
  const kva = num(row.kva || row.connected_kva);
  if (kva != null) return kva * 0.9;
  return null;
}

function equipmentBtu(row) {
  return num(row.btu_h || row.btuh || row.btu || row.connected_btu_h);
}

function equipmentDfu(row) {
  return num(row.dfu || row.fixture_units || row.drainage_fixture_units);
}

function computeElectric(params) {
  const { equipment, prototype, verified } = params;
  /** @type {string[]} */
  const needsVerification = [];
  const notes = [];
  let source = "equipment_schedule";

  let connectedKw = 0;
  let counted = 0;
  for (const row of equipment) {
    const kw = equipmentKw(row);
    if (kw != null) {
      connectedKw += kw;
      counted += 1;
    }
  }

  if (counted < 1) {
    const protoKw = num(prototype?.electric?.connected_load_kw);
    if (protoKw != null) {
      connectedKw = protoKw;
      source = "generic_qsr_fallback";
      needsVerification.push("prototype_defaults");
      notes.push("Connected kW taken from generic QSR fallback — needs verification.");
    }
  }

  const verifiedKw = num(verified.connected_load_kw || verified.demand_load_kw);
  if (verifiedKw != null) {
    connectedKw = verifiedKw;
    source = "verified_values";
  }

  const demandFactor = num(prototype?.electric?.demand_factor) || 0.8;
  const demandKw = connectedKw * demandFactor;
  const voltageLabel = String(verified.requested_voltage || verified.service_voltage || prototype?.electric?.voltage || "208/120");
  const volts = /480/.test(voltageLabel) ? 480 : /240/.test(voltageLabel) ? 240 : 208;
  const phase = Number(verified.phase || prototype?.electric?.phase || 3) === 1 ? 1 : 3;
  const pf = num(prototype?.electric?.power_factor) || 0.9;
  const denom = phase === 1 ? volts * pf : volts * Math.sqrt(3) * pf;
  const amps = denom > 0 ? (demandKw * 1000) / denom : 0;
  const serviceAmps = nextStandardAmps(amps);
  const oversized = serviceAmps > OVERSIZED_ELECTRIC_AMPS;
  if (oversized) needsVerification.push("oversized_service");

  const serviceSize = `${serviceAmps}A, ${voltageLabel}V, ${phase === 3 ? "3-phase" : "1-phase"}`;

  return {
    calculated_values: {
      connected_load_kw: calculated(Number(connectedKw.toFixed(2)), "kW", source),
      demand_load_kw: calculated(Number(demandKw.toFixed(2)), "kW", "nec_220_demand_factor", {
        demand_factor: demandFactor,
      }),
      service_amperage: calculated(serviceAmps, "A", "nec_220_service_size"),
      requested_voltage: calculated(voltageLabel, "V", source),
      phase: calculated(phase, null, source),
      service_size: calculated(serviceSize, null, "nec_220_service_size"),
    },
    needs_verification: needsVerification,
    notes,
    oversized,
    method: "nec_220",
  };
}

function computeGas(params) {
  const { equipment, prototype, verified } = params;
  /** @type {string[]} */
  const needsVerification = [];
  const notes = [];
  let source = "equipment_schedule";
  let btu = 0;
  let counted = 0;
  for (const row of equipment) {
    const v = equipmentBtu(row);
    if (v != null) {
      btu += v;
      counted += 1;
    }
  }
  if (counted < 1) {
    const proto = num(prototype?.gas?.connected_btu_h);
    if (proto != null) {
      btu = proto;
      source = "generic_qsr_fallback";
      needsVerification.push("prototype_defaults");
      notes.push("Gas BTU/h taken from generic QSR fallback — needs verification.");
    }
  }
  const verifiedBtu = num(verified.btu_demand || verified.connected_btu_h);
  if (verifiedBtu != null) {
    btu = verifiedBtu;
    source = "verified_values";
  }
  const cfh = btu / 1030;
  const row = GAS_LINE_TABLE.find((r) => cfh <= r.maxCfh) || GAS_LINE_TABLE[GAS_LINE_TABLE.length - 1];
  const serviceSize = `${row.size} line, ${Math.round(cfh)} cfh @ 7" wc`;
  return {
    calculated_values: {
      connected_btu_h: calculated(Math.round(btu), "BTU/h", source),
      gas_cfh: calculated(Number(cfh.toFixed(1)), "cfh", "gas_btu_to_cfh"),
      gas_line_size: calculated(row.size, "in", "gas_line_table"),
      service_size: calculated(serviceSize, null, "gas_line_table"),
    },
    needs_verification: needsVerification,
    notes,
    oversized: false,
    method: "gas_btu_aggregate",
  };
}

function computeWaterSewer(params) {
  const { equipment, prototype, verified, utilityType } = params;
  /** @type {string[]} */
  const needsVerification = [];
  const notes = [];
  let source = "equipment_schedule";
  let dfu = 0;
  let counted = 0;
  for (const row of equipment) {
    const v = equipmentDfu(row);
    if (v != null) {
      dfu += v;
      counted += 1;
    }
  }
  if (counted < 1) {
    const proto = num(prototype?.[utilityType]?.fixture_dfu || prototype?.water?.fixture_dfu);
    if (proto != null) {
      dfu = proto;
      source = "generic_qsr_fallback";
      needsVerification.push("prototype_defaults");
      notes.push("Fixture DFU taken from generic QSR fallback — needs verification.");
    }
  }
  const verifiedDfu = num(verified.dfu || verified.gpm_or_dfu || verified.fixture_units_or_flow);
  if (verifiedDfu != null) {
    dfu = verifiedDfu;
    source = "verified_values";
  }
  const gpm = dfu * 0.5;
  const meter = WATER_METER_TABLE.find((r) => dfu <= r.maxDfu) || WATER_METER_TABLE[WATER_METER_TABLE.length - 1];
  return {
    calculated_values: {
      fixture_dfu: calculated(Math.round(dfu), "DFU", source),
      demand_gpm: calculated(Number(gpm.toFixed(1)), "gpm", "dfu_to_gpm"),
      water_meter_size: calculated(meter.size, "in", "meter_size_table"),
      service_size: calculated(`${meter.size} meter`, null, "meter_size_table"),
    },
    needs_verification: needsVerification,
    notes,
    oversized: false,
    method: "dfu_meter_table",
  };
}

function computeTelecom(params) {
  const { prototype, verified } = params;
  const drops = num(verified.service_count) || num(prototype?.telecom?.drops) || 1;
  const needsVerification = num(verified.service_count) == null ? ["prototype_defaults"] : [];
  return {
    calculated_values: {
      service_count: calculated(drops, "drops", needsVerification.length ? "generic_qsr_fallback" : "verified_values"),
      service_type: calculated(prototype?.telecom?.service_type || "fiber", null, "generic_qsr_fallback"),
    },
    needs_verification: needsVerification,
    notes: needsVerification.length ? ["Telecom drop count uses generic QSR fallback."] : [],
    oversized: false,
    method: "telecom_drops",
  };
}

/**
 * Build calculated load_summary values with explicit provenance.
 * Square footage is never converted directly into amps.
 *
 * @param {object} params
 */
function computeLoadEngine(params) {
  const utilityType = String(params.utilityType || "").toLowerCase();
  const project = params.project || {};
  const equipment = Array.isArray(params.equipment) ? params.equipment : [];
  const verified =
    params.verifiedValues && typeof params.verifiedValues === "object" ? params.verifiedValues : {};
  const proto = loadPrototypeTemplate(project);
  const prototype = proto.template;

  /** @type {{ calculated_values: Record<string, unknown>, needs_verification: string[], notes: string[], oversized: boolean, method: string }} */
  let result;
  if (utilityType === "electric") result = computeElectric({ equipment, prototype, verified });
  else if (utilityType === "gas") result = computeGas({ equipment, prototype, verified });
  else if (utilityType === "water" || utilityType === "sewer") {
    result = computeWaterSewer({ equipment, prototype, verified, utilityType });
  } else if (utilityType === "telecom") result = computeTelecom({ equipment, prototype, verified });
  else {
    result = {
      calculated_values: {},
      needs_verification: ["unrecognized_utility_type"],
      notes: [],
      oversized: false,
      method: "none",
    };
  }

  if (proto.source === "generic_qsr_fallback") {
    result.needs_verification = [...new Set(["generic_qsr_fallback", ...result.needs_verification])];
  }
  if (proto.unrecognized) {
    result.needs_verification = [...new Set(["unrecognized_prototype", ...result.needs_verification])];
  }

  return {
    ...result,
    template_id: proto.id,
    template_source: proto.source,
    template_is_mcdonalds_official: proto.source === "mcdonalds_seed",
    oversized_threshold_amps: OVERSIZED_ELECTRIC_AMPS,
  };
}

module.exports = {
  OVERSIZED_ELECTRIC_AMPS,
  loadPrototypeTemplate,
  computeLoadEngine,
  nextStandardAmps,
};
