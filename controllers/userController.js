const pool = require('../config/db');

exports.list = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.created_at, r.name as role, d.name as department_name, u.department_id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_active, u.created_at, u.department_id, u.avatar_url,
        r.name as role, d.name as department_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, department_id, is_active, name } = req.body;

    let roleId = null;
    if (role) {
      const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role.toLowerCase()]);
      if (roleResult.rows.length === 0) return res.status(400).json({ error: 'Invalid role' });
      roleId = roleResult.rows[0].id;
    }

    const result = await pool.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        role_id = COALESCE($2, role_id),
        department_id = COALESCE($3, department_id),
        is_active = COALESCE($4, is_active),
        updated_at = NOW()
       WHERE id = $5 RETURNING id, name, email`,
      [name, roleId, department_id, is_active, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.dashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    // Document stats
    let statsQuery = `
      SELECT
        COUNT(*) as total_documents,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_documents,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_documents,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_documents
      FROM documents
      WHERE is_deleted = false
    `;
    const statsParams = [];
    if (!isAdmin) {
      statsQuery += `
        AND (
          owner_id = $1
          OR department_id = (SELECT department_id FROM users WHERE id = $1)
          OR status = 'approved'
        )
      `;
      statsParams.push(userId);
    }
    const stats = await pool.query(statsQuery, statsParams);

    // Pending approvals for current user
    const pendingApprovals = await pool.query(
      `SELECT ast.*, aw.document_id, d.title as document_title, u.name as requester_name
       FROM approval_steps ast
       JOIN approval_workflows aw ON ast.workflow_id = aw.id
       JOIN documents d ON aw.document_id = d.id
       JOIN users u ON aw.created_by = u.id
       WHERE ast.approver_id = $1 AND ast.status = 'pending'
       ORDER BY ast.created_at ASC LIMIT 10`,
      [userId]
    );

    // Recent documents
    let recentQuery = `
      SELECT d.id, d.title, d.status, d.updated_at, d.file_type, u.name as owner_name, dep.name as department_name
      FROM documents d
      JOIN users u ON d.owner_id = u.id
      LEFT JOIN departments dep ON d.department_id = dep.id
      WHERE d.is_deleted = false
    `;
    if (!isAdmin) {
      recentQuery += `
        AND (
          d.owner_id = $1
          OR d.department_id = (SELECT department_id FROM users WHERE id = $1)
          OR d.status = 'approved'
        )
      `;
    }
    recentQuery += ` ORDER BY d.updated_at DESC LIMIT 10`;
    const recentDocs = isAdmin
      ? await pool.query(recentQuery)
      : await pool.query(recentQuery, [userId]);

    // Department breakdown
    const deptBreakdown = await pool.query(
      `SELECT dep.name as department, COUNT(d.id) as count
       FROM departments dep
       LEFT JOIN documents d ON d.department_id = dep.id AND d.is_deleted = false
       GROUP BY dep.id, dep.name ORDER BY count DESC`
    );

    res.json({
      stats: stats.rows[0],
      pendingApprovals: pendingApprovals.rows,
      recentDocuments: recentDocs.rows,
      departmentBreakdown: deptBreakdown.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.approvers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.department_id, d.name as department_name, r.name as role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.is_active = true
         AND r.name IN ('manager', 'admin')
       ORDER BY u.name ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('List approvers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
