import {
  isPgcEphemeralPortalFileUrl,
  isSupabaseStorageUrl,
  resolvePgcPortalFileOpenUrl,
} from "./pgcPortalFileUrl";

const SUPABASE =
  "https://abc.supabase.co/storage/v1/object/public/project-drawings/drawings/x/pgc/property.pdf";
const ACTIVE_X =
  "https://eplans.princegeorgescountymd.gov/ProjectDox/ActiveXViewer.aspx?FileID=12345";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  }
}

assert(isSupabaseStorageUrl(SUPABASE), "supabase url detected");
assert(isPgcEphemeralPortalFileUrl(ACTIVE_X), "ActiveXViewer is ephemeral");
assert(
  resolvePgcPortalFileOpenUrl({
    publicUrl: SUPABASE,
    viewUrl: ACTIVE_X,
  }) === SUPABASE,
  "prefers supabase publicUrl over portal viewUrl",
);
assert(
  resolvePgcPortalFileOpenUrl({
    viewUrl: ACTIVE_X,
    downloadStatus: "failed",
  }) === null,
  "failed files have no open url",
);
assert(
  resolvePgcPortalFileOpenUrl({ viewUrl: ACTIVE_X }) === null,
  "ephemeral-only viewUrl yields no link",
);

if (failed) {
  process.exit(1);
}
console.log("pgcPortalFileUrl.selftest: PASS");
