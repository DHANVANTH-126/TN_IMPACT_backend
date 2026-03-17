-- Migrate legacy firebase_url columns to file_url

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_url TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'firebase_url'
  ) THEN
    UPDATE documents
    SET file_url = COALESCE(file_url, firebase_url)
    WHERE file_url IS NULL
      AND firebase_url IS NOT NULL;
  END IF;
END $$;

ALTER TABLE document_versions
  ADD COLUMN IF NOT EXISTS file_url TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_versions'
      AND column_name = 'firebase_url'
  ) THEN
    UPDATE document_versions
    SET file_url = COALESCE(file_url, firebase_url)
    WHERE file_url IS NULL
      AND firebase_url IS NOT NULL;
  END IF;
END $$;

ALTER TABLE documents
  DROP COLUMN IF EXISTS firebase_url;

ALTER TABLE document_versions
  DROP COLUMN IF EXISTS firebase_url;
