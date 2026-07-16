#!/usr/bin/env python3
"""
PermitPilot D2.2 — Electric service territory ingestion.

Official source (verified 2026-07-17):
  EIA / HIFLD Electric Retail Service Territories
  https://services3.arcgis.com/OYP7N6mAJJCyH6hd/ArcGIS/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0

Archived fallback (explicit only):
  NASA HIFLD Open snapshot (Sept 2024 vintage)
  https://maps.nccs.nasa.gov/mapping/rest/services/hifld_open/energy/FeatureServer/26
"""

from __future__ import annotations

import argparse
import hashlib
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EIA_OFFICIAL_LAYER_URL = (
    "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/ArcGIS/rest/services/"
    "Electric_Retail_Service_Territories_HIFLD/FeatureServer/0"
)
HIFLD_FALLBACK_LAYER_URL = (
    "https://maps.nccs.nasa.gov/mapping/rest/services/hifld_open/energy/FeatureServer/26"
)
SCHEMA_VERSION = "d2.2-territory-v1"
SCRIPT_VERSION = "2.0.0"
PAGE_SIZE = 2000

DEFAULT_FOOTPRINT = [
    "DC", "MD", "VA", "WV", "DE", "PA", "NJ", "NY", "CT", "RI",
    "MA", "VT", "NH", "ME", "NC", "SC", "GA", "FL", "OH", "AL", "MS",
]

# Cross-border supplements for states where adjacent-state polygons serve footprint addresses.
CROSS_BORDER_SUPPLEMENTS: dict[str, list[dict[str, str]]] = {
    "MD": [{"where": "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'", "reason": "pepco_dc_serves_md_suburbs"}],
    "VA": [{"where": "STATE = 'DC' AND NAME = 'POTOMAC ELECTRIC POWER CO'", "reason": "pepco_dc_serves_northern_va"}],
}

OUT_FIELDS = "OBJECTID,NAME,STATE,TYPE,HOLDING_CO,CUSTOMERS,REGULATED,SOURCEDATE,SOURCE,YEAR"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def build_ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def http_get_json(url: str, timeout: int = 120) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "PermitPilot-Territory-Ingest/2.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def layer_url(source: str) -> str:
    if source == "fallback":
        return HIFLD_FALLBACK_LAYER_URL
    return EIA_OFFICIAL_LAYER_URL


def query_count(base_url: str, where: str) -> int:
    params = {"where": where, "returnCountOnly": "true", "f": "json"}
    url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
    data = http_get_json(url)
    return int(data.get("count", 0))


def query_features(base_url: str, where: str, with_geometry: bool) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    offset = 0
    total = query_count(base_url, where)
    while offset < total:
        params = {
            "where": where,
            "outFields": OUT_FIELDS,
            "returnGeometry": "true" if with_geometry else "false",
            "outSR": "4326",
            "f": "geojson" if with_geometry else "json",
            "resultOffset": str(offset),
            "resultRecordCount": str(PAGE_SIZE),
        }
        url = f"{base_url}/query?{urllib.parse.urlencode(params)}"
        data = http_get_json(url)
        if with_geometry:
            batch = data.get("features", [])
            if not isinstance(batch, list):
                raise ValueError("Invalid GeoJSON features array")
            features.extend(batch)
        else:
            batch = data.get("features", [])
            if not isinstance(batch, list):
                raise ValueError("Invalid JSON features array")
            features.extend(batch)
        if not batch:
            break
        offset += len(batch)
        time.sleep(0.35)
    return features


def validate_geojson_feature(feature: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    geom = feature.get("geometry")
    props = feature.get("properties", {})
    if not geom:
        errors.append("missing_geometry")
        return errors
    gtype = geom.get("type")
    if gtype not in ("Polygon", "MultiPolygon"):
        errors.append(f"unsupported_geometry_type:{gtype}")
    name = props.get("NAME") or props.get("name")
    if not name or not str(name).strip():
        errors.append("missing_utility_name")
    return errors


def dedupe_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties", feature.get("attributes", {}))
        oid = str(props.get("OBJECTID", ""))
        name = str(props.get("NAME", ""))
        state = str(props.get("STATE", ""))
        key = f"{oid}|{name}|{state}"
        if key in seen:
            continue
        seen.add(key)
        out.append(feature)
    return out


def utilities_from_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties", feature.get("attributes", {}))
        rows.append({
            "name": props.get("NAME") or props.get("name"),
            "type": props.get("TYPE") or props.get("type"),
            "holding_co": props.get("HOLDING_CO") or props.get("holding_co"),
            "customers": props.get("CUSTOMERS") or props.get("customers") or 0,
            "state": props.get("STATE") or props.get("state"),
            "source_date": props.get("SOURCEDATE") or props.get("SOURCEDATE"),
            "supplement_reason": props.get("_supplement_reason"),
        })
    rows.sort(key=lambda r: (-(r.get("customers") or 0), str(r.get("name") or "")))
    return rows


def reconcile_names_with_node(rows: list[Any], repo_root: Path) -> dict[str, Any]:
    script = repo_root / "scraper-service/scripts/reconcile-territory-provider-names.js"
    if not script.exists():
        return {"skipped": True, "reason": "reconcile_script_missing"}

    names: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            name = row.get("name")
        else:
            name = row
        if name:
            names.append(str(name))

    import subprocess

    payload = json.dumps(names)
    proc = subprocess.run(
        ["node", str(script)],
        input=payload,
        text=True,
        capture_output=True,
        cwd=str(repo_root / "scraper-service"),
        check=False,
    )
    if proc.returncode != 0:
        return {"skipped": True, "reason": "reconcile_failed", "stderr": proc.stderr}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"skipped": True, "reason": "invalid_reconcile_output", "stdout": proc.stdout}


def ingest_state(state: str, base_url: str, output_dir: Path, dry_run: bool) -> dict[str, Any]:
    state = state.upper()
    where = f"STATE = '{state}'"
    attr_features = query_features(base_url, where, with_geometry=False)
    geo_features = query_features(base_url, where, with_geometry=True)

    supplements = CROSS_BORDER_SUPPLEMENTS.get(state, [])
    for supplement in supplements:
        sup_where = supplement["where"]
        reason = supplement["reason"]
        sup_attrs = query_features(base_url, sup_where, with_geometry=False)
        sup_geo = query_features(base_url, sup_where, with_geometry=True)
        for f in sup_attrs:
            attrs = f.get("attributes") if isinstance(f.get("attributes"), dict) else {}
            props = f.setdefault("properties", {})
            for key, value in attrs.items():
                if key not in props:
                    props[key] = value
            props["_supplement_reason"] = reason
        for f in sup_geo:
            attrs = f.get("attributes") if isinstance(f.get("attributes"), dict) else {}
            props = f.setdefault("properties", {})
            for key, value in attrs.items():
                if key not in props:
                    props[key] = value
            props["_supplement_reason"] = reason
        attr_features.extend(sup_attrs)
        geo_features.extend(sup_geo)

    attr_features = dedupe_features(attr_features)
    geo_features = dedupe_features(geo_features)

    validation_errors: list[str] = []
    for feature in geo_features:
        validation_errors.extend(validate_geojson_feature(feature))

    if not geo_features:
        validation_errors.append("empty_state_results")

    geojson = {"type": "FeatureCollection", "features": geo_features}
    utilities = utilities_from_features(attr_features)

    geo_path = output_dir / f"territories_{state}.geojson"
    result = {
        "state": state,
        "feature_count": len(geo_features),
        "utility_count": len(utilities),
        "validation_errors": validation_errors,
        "utilities": [u.get("name") for u in utilities],
        "supplements_applied": [s.get("reason") for s in supplements],
    }

    if dry_run:
        result["dry_run"] = True
        return result

    geo_bytes = json.dumps(geojson).encode("utf-8")
    geo_path.write_bytes(geo_bytes)
    result["geojson_path"] = str(geo_path)
    result["checksum_sha256"] = sha256_bytes(geo_bytes)
    result["file_size_bytes"] = len(geo_bytes)
    return result


def write_utilities_by_state(output_dir: Path, states_payload: dict[str, Any], source_meta: dict[str, Any]) -> None:
    path = output_dir / "utilities_by_state.json"
    path.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": SCHEMA_VERSION,
        **source_meta,
        "states": states_payload,
    }, indent=2))


def write_manifest(output_dir: Path, source: str, states_info: dict[str, Any], reconcile_report: dict[str, Any], errors: list[str]) -> None:
    source_url = layer_url(source)
    meta = http_get_json(f"{source_url}?f=pjson")
    source_date = None
    if meta.get("editingInfo", {}).get("dataLastEditDate"):
        source_date = datetime.fromtimestamp(meta["editingInfo"]["dataLastEditDate"] / 1000, tz=timezone.utc).date().isoformat()

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "ingestion_script_version": SCRIPT_VERSION,
        "dataset_version": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_name": "EIA Energy Atlas" if source == "official" else "NASA HIFLD Open (archived fallback)",
        "source_url": source_url,
        "layer_id": "0",
        "source_vintage": source_date,
        "fallback_used": source == "fallback",
        "fallback_reason": "Explicit --source fallback requested" if source == "fallback" else None,
        "states": states_info,
        "reconcile_report": reconcile_report,
        "errors": errors,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest electric service territory datasets for PermitPilot D2.2")
    parser.add_argument("--state", help="Single state code, e.g. MD")
    parser.add_argument("--states", help="Comma-separated state codes, e.g. MD,DC,VA")
    parser.add_argument("--all", action="store_true", help="Ingest the configured footprint states")
    parser.add_argument("--output-dir", default="scraper-service/data/territory/electric", help="Output directory")
    parser.add_argument("--source", choices=["official", "fallback"], default="official", help="Data source")
    parser.add_argument("--dry-run", action="store_true", help="Validate queries without writing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.all:
        states = DEFAULT_FOOTPRINT
    elif args.states:
        states = [s.strip().upper() for s in args.states.split(",") if s.strip()]
    elif args.state:
        states = [args.state.strip().upper()]
    else:
        print("Specify --state, --states, or --all", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir)
    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    base_url = layer_url(args.source)
    states_info: dict[str, Any] = {}
    utilities_by_state: dict[str, Any] = {}
    all_errors: list[str] = []
    all_names: list[dict[str, Any]] = []

    for state in states:
        print(f"Ingesting {state} from {args.source} ...")
        try:
            result = ingest_state(state, base_url, output_dir, args.dry_run)
        except urllib.error.HTTPError as exc:
            all_errors.append(f"{state}:http_{exc.code}")
            print(f"  ERROR HTTP {exc.code} for {state}")
            continue
        except Exception as exc:  # noqa: BLE001
            all_errors.append(f"{state}:{exc}")
            print(f"  ERROR {exc}")
            continue

        print(f"  features={result.get('feature_count')} utilities={result.get('utility_count')}")
        if result.get("validation_errors"):
            print(f"  validation_errors={result['validation_errors']}")
            all_errors.extend([f"{state}:{e}" for e in result["validation_errors"]])

        if not args.dry_run:
            states_info[state] = {
                "feature_count": result.get("feature_count"),
                "utility_count": result.get("utility_count"),
                "checksum_sha256": result.get("checksum_sha256"),
                "file_size_bytes": result.get("file_size_bytes"),
                "file": f"territories_{state}.geojson",
                "supplements_applied": result.get("supplements_applied", []),
            }
            utilities_by_state[state] = [
                {
                    "name": name,
                    "type": None,
                    "holding_co": None,
                    "customers": 0,
                    "state": state,
                    "source_date": None,
                    "supplement_reason": None,
                }
                for name in result.get("utilities", [])
            ]
            all_names.extend([u.get("name") for u in utilities_by_state[state] if u.get("name")])

    repo_root = Path(__file__).resolve().parents[2]
    reconcile_report = reconcile_names_with_node(all_names, repo_root)

    if not args.dry_run and utilities_by_state:
        write_utilities_by_state(output_dir, utilities_by_state, {
            "source_name": "EIA Energy Atlas" if args.source == "official" else "NASA HIFLD Open (archived fallback)",
            "source_url": base_url,
            "fallback_used": args.source == "fallback",
        })
        write_manifest(output_dir, args.source, states_info, reconcile_report, all_errors)
        unresolved_path = output_dir / "unresolved_providers.json"
        unresolved_path.write_text(json.dumps(reconcile_report, indent=2))
        print(f"Wrote manifest.json and unresolved_providers.json to {output_dir}")

    return 0 if not all_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
