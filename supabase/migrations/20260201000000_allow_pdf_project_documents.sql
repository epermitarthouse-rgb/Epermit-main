-- Allow both images and PDFs for project-documents bucket (compliance analysis).
-- Fixes: "400 Invalid MIME type. Only image types are supported" when uploading PDFs.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/dwg',
  'application/dxf',
  'application/zip',
  'application/x-zip-compressed'
]
WHERE id = 'project-documents';
