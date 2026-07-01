-- Allow legacy Word .DOC uploads in project-documents bucket (Comment Review).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
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
