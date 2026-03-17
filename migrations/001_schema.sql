-- Centralized Document Management System - Database Schema

-- Roles
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id INTEGER REFERENCES roles(id) DEFAULT 3,
  department_id INTEGER REFERENCES departments(id),
  avatar_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  department_id INTEGER REFERENCES departments(id),
  owner_id INTEGER REFERENCES users(id),
  current_version INTEGER DEFAULT 1,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','archived')),
  file_name VARCHAR(255),
  file_type VARCHAR(50),
  file_size BIGINT,
  file_url TEXT,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Document versions
CREATE TABLE IF NOT EXISTS document_versions (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_name VARCHAR(255),
  file_type VARCHAR(50),
  file_size BIGINT,
  file_url TEXT,
  changelog TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL
);

-- Document–Tag junction
CREATE TABLE IF NOT EXISTS document_tags (
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

-- Approval workflows
CREATE TABLE IF NOT EXISTS approval_workflows (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Approval steps
CREATE TABLE IF NOT EXISTS approval_steps (
  id SERIAL PRIMARY KEY,
  workflow_id INTEGER REFERENCES approval_workflows(id) ON DELETE CASCADE,
  approver_id INTEGER REFERENCES users(id),
  step_order INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  comments TEXT,
  reminder_sent BOOLEAN DEFAULT false,
  actioned_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver ON approval_steps(approver_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_workflow ON approval_steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id);

-- Insert default roles
INSERT INTO roles (name) VALUES ('admin'), ('manager'), ('employee')
  ON CONFLICT (name) DO NOTHING;

-- Insert default departments
INSERT INTO departments (name, description) VALUES
  ('Engineering', 'Software development and technical operations'),
  ('Human Resources', 'Employee management and recruitment'),
  ('Finance', 'Financial planning and accounting'),
  ('Marketing', 'Brand management and campaigns'),
  ('Legal', 'Legal compliance and contracts')
  ON CONFLICT (name) DO NOTHING;
