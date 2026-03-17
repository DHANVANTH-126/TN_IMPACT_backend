const pool = require('../config/db');

exports.list = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
        (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) as member_count,
        (SELECT COUNT(*) FROM documents doc WHERE doc.department_id = d.id AND doc.is_deleted = false) as document_count
       FROM departments d ORDER BY d.name`
    );
    res.json({ departments: result.rows });
  } catch (err) {
    console.error('List departments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const dept = await pool.query('SELECT * FROM departments WHERE id = $1', [id]);
    if (dept.rows.length === 0) return res.status(404).json({ error: 'Department not found' });

    const members = await pool.query(
      `SELECT u.id, u.name, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.department_id = $1`,
      [id]
    );

    const documents = await pool.query(
      `SELECT d.id, d.title, d.status, d.created_at, u.name as owner_name
       FROM documents d JOIN users u ON d.owner_id = u.id
       WHERE d.department_id = $1 AND d.is_deleted = false ORDER BY d.updated_at DESC LIMIT 20`,
      [id]
    );

    res.json({ ...dept.rows[0], members: members.rows, documents: documents.rows });
  } catch (err) {
    console.error('Get department error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const result = await pool.query(
      `INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING *`,
      [name, description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    console.error('Create department error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = await pool.query(
      `UPDATE departments SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *`,
      [name, description, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update department error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM departments WHERE id = $1', [id]);
    res.json({ message: 'Department deleted' });
  } catch (err) {
    console.error('Delete department error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
