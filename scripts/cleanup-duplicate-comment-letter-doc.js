/**
 * Read-only inspection + optional cleanup for duplicate comment letter uploads.
 * Usage:
 *   export $(grep -E '^VITE_SUPABASE_' .env | xargs)
 *   node scripts/cleanup-duplicate-comment-letter-doc.js --inspect
 *   node scripts/cleanup-duplicate-comment-letter-doc.js --delete DUPLICATE_ID
 */
const { createClient } = require("@supabase/supabase-js");

const FILE_NAME = "260130 - DOB CRL McDonalds New York Ave.doc";
const DOC_IDS = [
  "274afc22-fa0c-4524-b38b-74cd5c7f125d",
  "e4209570-b437-41f2-bc60-480361a1c18a",
];

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const sb = createClient(url, key);
  const inspect = process.argv.includes("--inspect");
  const deleteId = process.argv.includes("--delete")
    ? process.argv[process.argv.indexOf("--delete") + 1]
    : null;

  const { data: docs, error: docsError } = await sb
    .from("project_documents")
    .select("id, project_id, file_name, file_path, file_size, created_at, description")
    .in("id", DOC_IDS);
  if (docsError) throw docsError;

  const { data: comments, error: commentsError } = await sb
    .from("parsed_comments")
    .select("id, source_document_id, ingest_source")
    .in("source_document_id", DOC_IDS);
  if (commentsError) throw commentsError;

  const commentCounts = DOC_IDS.reduce((acc, id) => {
    acc[id] = (comments ?? []).filter((row) => row.source_document_id === id).length;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        fileName: FILE_NAME,
        documents: docs,
        commentCounts,
        storagePaths: (docs ?? []).map((d) => d.file_path),
      },
      null,
      2,
    ),
  );

  if (inspect || !deleteId) return;

  const duplicate = (docs ?? []).find((d) => d.id === deleteId);
  if (!duplicate) {
    console.error("Document not found:", deleteId);
    process.exit(1);
  }
  if ((commentCounts[deleteId] ?? 0) > 0) {
    console.error("Refusing to delete document with linked parsed_comments:", deleteId);
    process.exit(1);
  }

  const { error: storageError } = await sb.storage
    .from("project-documents")
    .remove([duplicate.file_path]);
  if (storageError) {
    console.error("Storage delete failed:", storageError.message);
    process.exit(1);
  }

  const { error: dbError } = await sb
    .from("project_documents")
    .delete()
    .eq("id", deleteId);
  if (dbError) {
    console.error("DB delete failed:", dbError.message);
    process.exit(1);
  }

  console.log("Deleted duplicate document:", deleteId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
