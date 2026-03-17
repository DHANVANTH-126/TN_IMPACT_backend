-- Widen file_type column from VARCHAR(50) to TEXT
-- Needed to accommodate long MIME types like:
-- application/vnd.openxmlformats-officedocument.wordprocessingml.document (73 chars)
-- application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
-- application/vnd.openxmlformats-officedocument.presentationml.presentation

ALTER TABLE documents
  ALTER COLUMN file_type TYPE TEXT,
  ALTER COLUMN file_name TYPE TEXT;

ALTER TABLE document_versions
  ALTER COLUMN file_type TYPE TEXT,
  ALTER COLUMN file_name TYPE TEXT;
