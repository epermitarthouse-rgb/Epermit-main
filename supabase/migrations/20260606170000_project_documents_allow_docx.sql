-- Allow DOCX uploads in project-documents bucket (Comment Review comment letters, AI ingestion).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
