# Point 7 Implementation: Supabase pgvector Document Ingestion + Grounded AI Responses

## Goal

Add a generic, project-based document ingestion and grounded AI response workflow.

When a user uploads project documents, especially permit plan PDFs, Permit Pilot should ingest those documents into searchable chunks. Then, when generating a response to a reviewer comment, the AI should retrieve relevant uploaded project-document evidence and generate a grounded response with citations.

This must work for any project. Do not hardcode the McDonald’s/DOB test files, project name, permit number, reviewers, sheet numbers, or filenames.

## Context

Points 1–6 are already implemented:

- Manual projects sync with global active project context.
- Projects page, sidebar, Comment Review, and Response Matrix use consistent project resolution.
- Document upload mismatch protection exists.
- Uploaded comment letters are saved to `project_documents`.
- Parsed comments can link to `source_document_id`.
- Manual comment parser supports full PDF/DOCX extraction and structured DOB-style parsing.
- Response Matrix still uses the old `generate-response`, which only drafts from comment text and does not read uploaded plans.

## Strict Scope

Do not remove or replace the existing `generate-response` flow yet.

Do not break current Auto-Draft behavior.

Do not touch scraper-service.

Do not change ProjectDox/Accela login, waits, sessions, scraping, or portal flows.

Do not break portal “Reload from portal.”

Do not refactor unrelated code.

Add the grounded workflow safely alongside the existing response workflow.

Use Supabase Postgres + pgvector. Do not introduce Pinecone, Weaviate, Chroma, or another vector DB.

---

## 1. Database: pgvector + document chunk storage

Add a new migration.

Enable vector extension if not already enabled:

```sql
create extension if not exists vector;
```

Add a new table such as `document_chunks` or `project_document_chunks`.

Required fields:

- `id uuid primary key`
- `project_id uuid not null references projects(id) on delete cascade`
- `document_id uuid not null references project_documents(id) on delete cascade`
- `user_id uuid not null`
- `file_name text`
- `document_type text`
- `page_number integer`
- `sheet_label text`
- `sheet_title text`
- `chunk_index integer`
- `chunk_text text not null`
- `embedding vector(1536)` using `text-embedding-3-small`, unless the project already uses a different embedding model/dimension
- `metadata jsonb default '{}'::jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Add indexes:

- project/document lookup index
- `(project_id, document_id, page_number)` index
- vector index if safe

Add RLS policies:

- Users can select/insert/update/delete only chunks where `user_id = auth.uid()`.
- Keep policies consistent with `project_documents`.

Add nullable ingestion-status fields to `project_documents` if not already present:

- `ai_ingestion_status text` default `not_started`
- `ai_ingested_at timestamptz`
- `ai_ingestion_error text`
- `ai_chunk_count integer`

Use nullable/backward-compatible columns only. No destructive migrations.

---

## 2. Edge function: `ingest-project-document`

Add a new Supabase edge function named:

```text
ingest-project-document
```

Input:

```json
{
  "project_id": "...",
  "document_id": "..."
}
```

Responsibilities:

1. Validate authenticated user.
2. Confirm the document belongs to the user and project.
3. Download the file from Supabase Storage using the existing `project_documents` storage path field.
4. Extract text from supported files:
   - PDF: full document, page by page
   - DOCX: full document text if feasible
   - images: optional skip for now unless safe
   - unsupported types: mark as unsupported, do not crash
5. For PDFs, preserve page numbers.
6. Detect weak/sparse extracted-text pages and mark them in metadata as `low_text: true`.
7. Infer `sheet_label` and `sheet_title` where possible from page text.

Generic sheet-label regex should detect examples like:

- `A-1.04`
- `A-1.05`
- `EQ-2.00`
- `EQ-2.01`
- `S-201.00`
- `EN-1.00`
- `P-1.4`
- `E-4.1`

Do not hardcode these exact values.

For `sheet_title`, use nearby uppercase title text when reliable. If unreliable, leave null.

8. Chunk extracted text:
   - page-level chunks are acceptable for first version
   - if page text is long, split into smaller chunks with overlap
   - keep metadata: page number, sheet label, sheet title, source file
9. Generate embeddings for each chunk.
   - Prefer existing OpenAI setup/env if present.
   - Otherwise use `text-embedding-3-small` with vector dimension `1536`.
10. Before inserting chunks for a document, delete existing chunks for that same `document_id` to avoid duplicates.
11. Insert chunks into the new document-chunk table.
12. Update `project_documents.ai_ingestion_status`:
   - `processing`
   - `completed`
   - `failed`
13. Store `ai_chunk_count`, `ai_ingested_at`, and `ai_ingestion_error`.

Cost/safety rule:

Do not run GPT vision/OCR on every plan page in this phase. Use text extraction + embeddings first. For scanned/low-text pages, mark them as `low_text` / OCR needed. OCR fallback can be a later phase.

---

## 3. Frontend: “Prepare for AI”

Add a visible action in the project documents area:

```text
Prepare for AI
```

Supported document types for this phase:

- PDF
- DOCX
- any text-based document already safely extractable

Where to add:

- `ProjectDocumentsSection`
- document row/card actions
- project detail Docs tab

On click:

- call `ingest-project-document`
- show status:
  - Not prepared
  - Processing
  - Ready for AI
  - Failed
  - OCR needed / low text detected, if available

Prefer manual ingestion button over automatic ingestion for this phase, so testing/debugging is easier.

---

## 4. Retrieval helper / RPC

Add vector search filtered by project and user.

Given:

```json
{
  "project_id": "...",
  "query": "reviewer comment text",
  "limit": 8
}
```

Return top matching chunks from the same `project_id` and authenticated `user_id` only.

Return:

- chunk id
- document id
- file name
- document type
- page number
- sheet label
- sheet title
- chunk text / evidence snippet
- similarity score
- metadata

Preferred implementation:

- SQL RPC function such as `match_document_chunks(project_id, query_embedding, match_count)` if safe.
- Otherwise direct pgvector query inside the edge function.

Project isolation is mandatory. Project B must never retrieve Project A chunks.

---

## 5. Edge function: `generate-grounded-response`

Add a new Supabase edge function named:

```text
generate-grounded-response
```

Input:

```json
{
  "project_id": "...",
  "comment_id": "...",
  "comment_text": "...",
  "discipline": "...",
  "code_reference": "...",
  "reviewer_name": "...",
  "comment_number": "..."
}
```

Responsibilities:

1. Validate authenticated user.
2. Embed the reviewer comment text.
3. Retrieve relevant chunks from the document-chunk table filtered by `project_id` and user.
4. If no chunks exist, return a clear status/error:

```text
No AI-prepared documents found for this project. Prepare project documents for AI first.
```

Do not silently generate a generic response.

5. If chunks exist but evidence is weak, return best effort with low confidence and explain missing evidence.
6. Build prompt with:
   - reviewer comment
   - discipline
   - code references
   - retrieved evidence chunks with file/page/sheet metadata
7. Instruct AI:
   - Use only uploaded project-document evidence and reviewer comment text.
   - Do not invent sheet references.
   - If evidence is not found, say so clearly.
   - Do not claim compliance unless supported by evidence.
   - Return structured JSON only.

Required JSON response:

```json
{
  "suggested_response": "string",
  "required_action": "string",
  "missing_info_or_risk": "string",
  "confidence": "high|medium|low",
  "evidence": [
    {
      "document_id": "uuid",
      "file_name": "string",
      "page_number": 12,
      "sheet_label": "A-1.04",
      "sheet_title": "1ST FLOOR EGRESS / SEATING PLAN",
      "snippet": "short quoted or paraphrased evidence",
      "relevance": "high|medium|low"
    }
  ]
}
```

Rules:

- If no matching evidence is found, `evidence` should be empty.
- `missing_info_or_risk` should explain what was not found.
- Suggested response should be professional and ready for architect/engineer review.
- Use “Please confirm/revise” when evidence is incomplete.
- Do not present the AI as final code authority.
- Do not use placeholders like “See Sheet ___” unless evidence is missing and the sheet is genuinely unknown.

---

## 6. Response Matrix UI integration

Update Response Matrix safely.

Keep old Auto-Draft available as fallback.

Add a separate button/action first:

```text
Grounded Draft
```

When clicked:

1. Call `generate-grounded-response`.
2. Save `suggested_response` into existing `response_text` if that is current behavior.
3. Save related sheet/page into `sheet_reference` if available.
4. If new columns are needed, add nullable fields to `parsed_comments`:
   - `grounded_evidence jsonb`
   - `required_action text`
   - `missing_info_or_risk text`
   - `grounded_confidence text`
   - `grounded_generated_at timestamptz`
5. Display evidence/citations in row expanded view or a small evidence panel:
   - file name
   - page number
   - sheet label/title
   - snippet
6. If no prepared documents exist, show:

```text
No AI-prepared documents found for this project. Go to Project Documents and click Prepare for AI on the plan set.
```

Do not remove existing response fields.

---

## 7. Project/document readiness indicator

Add a small readiness indicator if easy:

- number of uploaded docs
- number of AI-prepared docs
- number of chunks
- last prepared timestamp

Keep this in Project Documents section. Do not overbuild.

---

## Acceptance Criteria

### A. Document ingestion

- Upload a plan PDF under a manual project.
- Click “Prepare for AI.”
- `project_documents.ai_ingestion_status` becomes `completed`.
- Document chunks are created with correct `project_id`, `document_id`, page numbers, file name, and chunk text.
- Some sheet labels are inferred where text allows.

### B. Project isolation

- Prepare docs for Project A.
- Generate grounded response for Project B.
- Project B must not retrieve Project A chunks.

### C. Grounded drafting

- Parse/approve a comment letter.
- In Response Matrix, click “Grounded Draft.”
- AI retrieves chunks from the uploaded plan set.
- Response includes evidence citations.

### D. Missing evidence behavior

- For a comment where no relevant plan evidence is found, AI says evidence was not found.
- It does not invent sheet references.

### E. UI

- User can see evidence: file, page, sheet, snippet.
- User can still use existing old Auto-Draft if needed.
- Existing Response Matrix still loads old comments.

### F. No regressions

- Portal “Reload from portal” still works.
- Existing image/PDF/DOCX comment parsing remains unchanged.
- Scraper-service untouched.
- Accela/ProjectDox login/wait/session behavior untouched.

---

## Manual Test Scenario: McDonald’s Files

After implementation, provide manual test steps for this scenario:

1. Create/select manual project “McDonald’s 75 New York Ave NE.”
2. Upload the 91-page revised permit plan set as Permit Drawing or Submittal Package.
3. Click “Prepare for AI.”
4. Upload/parse the DOB comment letter.
5. Approve comments.
6. Go to Response Matrix.
7. For Fire seating comment, click “Grounded Draft.” Expected: retrieved evidence should likely include egress/seating plan pages if text extraction captured them.
8. For bulk oil comment, click “Grounded Draft.” Expected: retrieved evidence should likely include equipment plan/schedule pages if text extraction captured them.
9. For insulation comment, click “Grounded Draft.” Expected: if no clear R-value evidence is found, AI should say missing/unclear instead of inventing.

---

## Return After Implementation

Return:

### What Changed

List exact behavior changes.

### Files Modified

List frontend/backend/database files changed.

### Database Changes

List migrations and new tables/columns/RPC functions.

### Edge Functions Added/Changed

List new functions and required deploy commands.

### Document Ingestion Logic

Explain supported file types, extraction, chunking, embeddings, sheet detection, low-text handling.

### Grounded Response Logic

Explain retrieval, prompt, output schema, evidence citations, missing evidence behavior.

### Manual Test Steps

Detailed test flow.

### Notes / Remaining Gaps

Mention whether OCR/vision fallback for low-text/scanned plan pages is not fully implemented.

Mention that old Auto-Draft remains as fallback.

Mention that this is generic for any project, not hardcoded to McDonald’s/DOB.
