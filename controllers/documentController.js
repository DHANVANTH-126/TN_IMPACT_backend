const pool = require('../config/db');
const { cloudinary, cloudinaryConfigured } = require('../config/cloudinary');
const es = require('../config/elasticsearch');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

async function uploadToCloudinary(file) {
  if (!cloudinaryConfigured) return null;

  const mime = (file.mimetype || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const resourceType = isImage ? 'image' : 'raw';

  const parsed = path.parse(file.originalname || 'file');
  const base = (parsed.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '-');

  const uploadWithPublicId = (publicId) => new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'documents',
        resource_type: resourceType,
        type: 'upload',
        access_mode: 'public',
        public_id: publicId,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );

    uploadStream.end(file.buffer);
  });

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidatePublicId = `${base}${suffix}`;
    try {
      return await uploadWithPublicId(candidatePublicId);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const alreadyExists = msg.includes('already exists') || msg.includes('conflict');
      if (!alreadyExists || attempt === 9) throw err;
    }
  }

  return null;
}

async function saveLocally(file) {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const fileName = `${uuidv4()}_${file.originalname}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return `/uploads/${fileName}`;
}

async function indexInElasticsearch(docId, data) {
  if (!es.isAvailable()) return;
  try {
    await es.getClient().index({
      index: 'documents',
      id: String(docId),
      body: data,
    });
  } catch (err) {
    console.warn('ES indexing failed:', err.message);
  }
}

exports.upload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { title, description, department_id, tags } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Upload file
    let fileUrl = await uploadToCloudinary(req.file);
    if (!fileUrl) fileUrl = await saveLocally(req.file);

    // Insert document
    const result = await pool.query(
      `INSERT INTO documents (title, description, department_id, owner_id, file_name, file_type, file_size, file_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description || '', department_id || req.user.department_id, req.user.id,
       req.file.originalname, req.file.mimetype, req.file.size, fileUrl]
    );
    const doc = result.rows[0];

    // Insert first version
    await pool.query(
      `INSERT INTO document_versions (document_id, version_number, file_name, file_type, file_size, file_url, uploaded_by, changelog)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'Initial upload')`,
      [doc.id, req.file.originalname, req.file.mimetype, req.file.size, fileUrl, req.user.id]
    );

    // Handle tags
    if (tags) {
      const tagList = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      for (const tagName of tagList) {
        if (!tagName) continue;
        const tagResult = await pool.query(
          `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id`,
          [tagName.toLowerCase()]
        );
        await pool.query(
          `INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [doc.id, tagResult.rows[0].id]
        );
      }
    }

    // Index in Elasticsearch
    const ownerResult = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    const deptResult = department_id
      ? await pool.query('SELECT name FROM departments WHERE id = $1', [department_id])
      : { rows: [] };

    await indexInElasticsearch(doc.id, {
      title, description: description || '',
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim().toLowerCase()) : tags) : [],
      department: deptResult.rows[0]?.name || '',
      owner_name: ownerResult.rows[0]?.name || '',
      status: 'draft',
      created_at: doc.created_at,
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.list = async (req, res) => {
  try {
    const { department_id, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `
      SELECT d.*, u.name as owner_name, dep.name as department_name,
        COALESCE(
          (SELECT json_agg(t.name) FROM document_tags dt JOIN tags t ON dt.tag_id = t.id WHERE dt.document_id = d.id),
          '[]'
        ) as tags
      FROM documents d
      JOIN users u ON d.owner_id = u.id
      LEFT JOIN departments dep ON d.department_id = dep.id
      WHERE d.is_deleted = false
    `;
    const params = [];
    let paramIdx = 1;

    if (department_id) {
      query += ` AND d.department_id = $${paramIdx++}`;
      params.push(department_id);
    }
    if (status) {
      query += ` AND d.status = $${paramIdx++}`;
      params.push(status);
    }

    // Non-admin users see only their department or own documents
    if (req.user.role !== 'admin') {
      query += ` AND (d.owner_id = $${paramIdx++} OR d.department_id = $${paramIdx++})`;
      params.push(req.user.id, req.user.department_id);
    }

    query += ` ORDER BY d.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Count total
    let countQuery = `SELECT COUNT(*) FROM documents d WHERE d.is_deleted = false`;
    const countParams = [];
    let countIdx = 1;
    if (department_id) { countQuery += ` AND d.department_id = $${countIdx++}`; countParams.push(department_id); }
    if (status) { countQuery += ` AND d.status = $${countIdx++}`; countParams.push(status); }
    if (req.user.role !== 'admin') {
      countQuery += ` AND (d.owner_id = $${countIdx++} OR d.department_id = $${countIdx++})`;
      countParams.push(req.user.id, req.user.department_id);
    }
    const countResult = await pool.query(countQuery, countParams);

    let documents = result.rows;

    // Employees can only see status, not file URLs
    if (req.user.role === 'employee') {
      documents = documents.map(d => ({ ...d, file_url: null }));
    }

    res.json({
      documents,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit),
    });
  } catch (err) {
    console.error('List docs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.download = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Download request for document ${id}`);
    
    const result = await pool.query('SELECT file_url, file_name, file_type FROM documents WHERE id = $1 AND is_deleted = false', [id]);
    if (result.rows.length === 0) {
      console.warn(`Document ${id} not found`);
      return res.status(404).json({ error: 'Document not found' });
    }

    const { file_url, file_name, file_type } = result.rows[0];
    console.log(`File URL: ${file_url}, Type: ${file_type}, Name: ${file_name}`);

    if (file_url.startsWith('/uploads/')) {
      // It's a local file
      const localPath = path.join(__dirname, '..', file_url);
      console.log(`Serving local file: ${localPath}`);
      try {
        fs.accessSync(localPath);
        const stats = fs.statSync(localPath);
        console.log(`Local file size: ${stats.size} bytes`);
        res.set('Content-Type', file_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${file_name || 'file'}"`);
        res.set('Content-Length', stats.size);
        return res.sendFile(localPath);
      } catch (err) {
        console.error(`Local file error: ${err.message}`);
        return res.status(404).json({ error: 'File not found' });
      }
    } else if (file_url.startsWith('http')) {
      // It's a remote file (Cloudinary)
      console.log(`Fetching remote file from: ${file_url}`);
      try {
        const response = await fetch(file_url);
        console.log(`Remote fetch status: ${response.status}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        console.log(`Remote file size: ${buffer.byteLength} bytes`);
        
        if (buffer.byteLength === 0) {
          console.warn(`Empty buffer received from: ${file_url}`);
          return res.status(404).json({ error: 'File is empty' });
        }
        
        // Prioritize file_type from database over Cloudinary headers
        const contentType = file_type || response.headers.get('content-type') || 'application/octet-stream';
        console.log(`Setting Content-Type: ${contentType}`);
        
        res.set('Content-Type', contentType);
        res.set('Content-Disposition', `inline; filename="${file_name || 'file'}"`);
        res.set('Content-Length', buffer.byteLength);
        return res.send(Buffer.from(buffer));
      } catch (err) {
        console.error(`Remote fetch error: ${err.message}`);
        return res.status(500).json({ error: `Failed to retrieve file: ${err.message}` });
      }
    } else {
      console.warn(`Invalid file URL: ${file_url}`);
      return res.status(404).json({ error: 'File not found or invalid URL' });
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const docResult = await pool.query(
      `SELECT d.*, u.name as owner_name, u.email as owner_email, dep.name as department_name
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       LEFT JOIN departments dep ON d.department_id = dep.id
       WHERE d.id = $1 AND d.is_deleted = false`,
      [id]
    );
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docResult.rows[0];

    // Get versions
    const versions = await pool.query(
      `SELECT dv.*, u.name as uploaded_by_name FROM document_versions dv
       JOIN users u ON dv.uploaded_by = u.id
       WHERE dv.document_id = $1 ORDER BY dv.version_number DESC`,
      [id]
    );

    // Get tags
    const tags = await pool.query(
      `SELECT t.name FROM document_tags dt JOIN tags t ON dt.tag_id = t.id WHERE dt.document_id = $1`,
      [id]
    );

    // Get approval workflow
    const workflows = await pool.query(
      `SELECT aw.*, 
        (SELECT json_agg(
          json_build_object(
            'id', ast.id, 'step_order', ast.step_order, 'status', ast.status,
            'comments', ast.comments, 'actioned_at', ast.actioned_at,
            'approver_id', ast.approver_id, 'approver_name', au.name, 'approver_email', au.email
          ) ORDER BY ast.step_order
        ) FROM approval_steps ast JOIN users au ON ast.approver_id = au.id WHERE ast.workflow_id = aw.id) as steps
       FROM approval_workflows aw WHERE aw.document_id = $1 ORDER BY aw.created_at DESC`,
      [id]
    );

    const response = { ...doc, versions: versions.rows, tags: tags.rows.map(t => t.name), workflows: workflows.rows };

    // Employees can only see status/stages, not file URLs
    if (req.user.role === 'employee') {
      response.file_url = null;
      response.versions = response.versions.map(v => ({ ...v, file_url: null }));
    }

    res.json(response);
  } catch (err) {
    console.error('Get doc error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, department_id, tags } = req.body;

    const existing = await pool.query('SELECT * FROM documents WHERE id = $1 AND is_deleted = false', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const doc = existing.rows[0];
    if (doc.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this document' });
    }

    const result = await pool.query(
      `UPDATE documents SET title = COALESCE($1, title), description = COALESCE($2, description),
       department_id = COALESCE($3, department_id), updated_at = NOW() WHERE id = $4 RETURNING *`,
      [title, description, department_id, id]
    );

    // Update tags if provided
    if (tags) {
      await pool.query('DELETE FROM document_tags WHERE document_id = $1', [id]);
      const tagList = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
      for (const tagName of tagList) {
        if (!tagName) continue;
        const tagResult = await pool.query(
          `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id`,
          [tagName.toLowerCase()]
        );
        await pool.query(
          `INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, tagResult.rows[0].id]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update doc error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const { changelog } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const existing = await pool.query('SELECT * FROM documents WHERE id = $1 AND is_deleted = false', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    let fileUrl = await uploadToCloudinary(req.file);
    if (!fileUrl) fileUrl = await saveLocally(req.file);

    const newVersion = existing.rows[0].current_version + 1;

    await pool.query(
      `INSERT INTO document_versions (document_id, version_number, file_name, file_type, file_size, file_url, uploaded_by, changelog)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, newVersion, req.file.originalname, req.file.mimetype, req.file.size, fileUrl, req.user.id, changelog || '']
    );

    const result = await pool.query(
      `UPDATE documents SET current_version = $1, file_url = $2, file_name = $3, file_type = $4, file_size = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [newVersion, fileUrl, req.file.originalname, req.file.mimetype, req.file.size, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Version upload error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE documents SET is_deleted = true, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    // Remove from ES
    if (es.isAvailable()) {
      try { await es.getClient().delete({ index: 'documents', id: String(id) }); } catch (e) {}
    }

    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('Delete doc error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
