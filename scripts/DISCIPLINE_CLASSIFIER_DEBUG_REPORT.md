# Discipline classifier classified_count: 0 — Debug report

## 1. Edge function code locations and summary

- **discipline-classifier-agent:** `supabase/functions/discipline-classifier-agent/index.ts`
- **comment-parser-agent:** `supabase/functions/comment-parser-agent/index.ts`

Full code is in the repo at those paths. Summary below.

---

## 2. Database tables

### Table: `parsed_comments`

**Used by:** comment-parser-agent (writes), discipline-classifier-agent (reads and updates).

**Schema (from migrations):**

```sql
-- 20260210100000_parsed_comments.sql
CREATE TABLE public.parsed_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  discipline TEXT NOT NULL,  -- later made nullable (see below)
  code_reference TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Review'
    CHECK (status IN ('Pending Review', 'Pending', 'Approved', 'Rejected', ...)),
  page_number INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260210200000_parsed_comments_response_matrix.sql
ALTER TABLE public.parsed_comments
  ADD COLUMN IF NOT EXISTS response_text TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS sheet_reference TEXT;
-- status check updated to include 'Draft', 'Ready for Review'

-- 20260221000000_parsed_comments_discipline_nullable.sql
ALTER TABLE public.parsed_comments
  ALTER COLUMN discipline DROP NOT NULL;
```

**Current effective schema:**

| Column         | Type      | Nullable | Default           |
|----------------|-----------|----------|-------------------|
| id             | uuid      | NO       | gen_random_uuid() |
| project_id     | uuid      | NO       | -                 |
| original_text  | text      | NO       | -                 |
| discipline     | text      | YES      | -                 |
| code_reference | text      | YES      | -                 |
| status         | text      | NO       | 'Pending Review'  |
| page_number    | integer   | YES      | -                 |
| created_at     | timestamptz | NO     | now()             |
| response_text  | text      | YES      | -                 |
| assigned_to    | text      | YES      | -                 |
| sheet_reference| text      | YES      | -                 |

**Row counts (run in Supabase SQL editor or CLI):**

```sql
-- Total rows in parsed_comments
SELECT COUNT(*) AS parsed_comments_total FROM public.parsed_comments;

-- Rows the discipline-classifier would select (NULL/General/'' + Pending)
SELECT COUNT(*) AS unclassified_pending
FROM public.parsed_comments
WHERE (discipline IS NULL OR discipline = 'General' OR discipline = '')
  AND status = 'Pending';

-- By status
SELECT status, COUNT(*) FROM public.parsed_comments GROUP BY status;

-- By discipline (null, General, empty, other)
SELECT
  CASE
    WHEN discipline IS NULL THEN 'NULL'
    WHEN discipline = '' THEN 'empty'
    WHEN discipline = 'General' THEN 'General'
    ELSE 'other'
  END AS disc_group,
  COUNT(*)
FROM public.parsed_comments
GROUP BY 1;
```

---

## 3. Data flow

### Comment parser

- **Reads from:** `projects.portal_data` (JSONB). Path used: **`portal_data.tabs.reports.pdfs`**.
- **Logic:** For each project, loads `project.portal_data` → `portal_data.tabs?.reports?.pdfs` → filters to PDFs that have non-empty `text`. For each such PDF, splits `pdf.text` into blocks via `splitIntoCommentBlocks()`, sends blocks to LLM for classification, then inserts into `parsed_comments` with `discipline: null`, `status: 'Pending'`, plus `original_text`, `code_reference`, `page_number`.
- **Writes to:** **`parsed_comments`** only (inserts).

### Discipline classifier

- **Reads from:** **`parsed_comments`**.
- **Filter for “needs classification”:** Rows where **discipline** is NULL, `'General'`, or `''` **and** **status = 'Pending'** (and `project_id` in the allowed set, with limit).
- **Writes to:** **`parsed_comments`** (updates `discipline` only).
- **Status/flag:** The **`discipline`** field is the flag: NULL / `'General'` / `''` = unclassified; any other value = classified. **`status`** stays `'Pending'` until something else (e.g. workflow) changes it; the classifier does not change `status`.

---

## 4. Why classified_count might be 0

Possible causes:

1. **No rows match the selection**  
   - `parsed_comments` has no rows with `(discipline IS NULL OR discipline = 'General' OR discipline = '') AND status = 'Pending'`.  
   - Run the `unclassified_pending` query above to confirm.

2. **Status mismatch**  
   - Table default is `'Pending Review'`; comment-parser inserts **`status: 'Pending'`**.  
   - If some rows still have `'Pending Review'`, the classifier (which filters `status = 'Pending'`) will not see them.

3. **RLS**  
   - Both functions use the user’s JWT. If RLS hides some rows from that user, the classifier will see fewer (or zero) rows even if the table has data.

4. **Empty string in PostgREST**  
   - The filter uses `.or("discipline.is.null,discipline.eq.General,discipline.eq.")`. The last part is for `discipline = ''`. If your DB or client represents empty differently, those rows might not match.

5. **Comment parser never ran or didn’t insert**  
   - If `portal_data.tabs.reports.pdfs` has no PDFs with text, the parser returns early and inserts 0 rows, so the classifier has nothing to work on.

---

## 5. Temporary logging added (no business logic changes)

### comment-parser-agent

- Right after building `pdfsWithText`:  
  `[DEBUG] comment-parser data source: portal_data.tabs.reports.pdfs; pdfs with text: N total pdfs in reports: M`
- After the loop:  
  `[DEBUG] comment-parser: comments found to parse (blocks from PDFs): X inserted: Y skipped (dup or error): Z`

### discipline-classifier-agent

- Right before the query:  
  `[DEBUG] discipline-classifier query: table=parsed_comments, filter=(discipline IS NULL OR discipline='General' OR discipline=''), status=Pending, project_id in K projects, limit= L`
- Right after the query:  
  `[DEBUG] discipline-classifier: query returned rows: N`

After deploy, trigger the pipeline and check Supabase function logs for these lines to see how many PDFs/comments the parser sees and how many rows the classifier query returns.

---

## 6. Full code of both functions

See in repo:

- `supabase/functions/comment-parser-agent/index.ts`
- `supabase/functions/discipline-classifier-agent/index.ts`

(No business logic was changed; only the `[DEBUG]` console.log lines above were added.)
