-- Raise project-documents storage bucket limit for large plan sets (e.g. 90+ page PDFs).
UPDATE storage.buckets
SET file_size_limit = 262144000 -- 250MB
WHERE id = 'project-documents';
