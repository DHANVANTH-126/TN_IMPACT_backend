const pool = require('../config/db');

exports.create = async (req, res) => {
  try {
    const { document_id, approver_ids } = req.body;
    if (!document_id || !approver_ids || !approver_ids.length) {
      return res.status(400).json({ error: 'document_id and approver_ids are required' });
    }

    // Verify document exists
    const doc = await pool.query('SELECT * FROM documents WHERE id = $1 AND is_deleted = false', [document_id]);
    if (doc.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    // Verify all approvers are managers or admins
    const approverCheck = await pool.query(
      `SELECT u.id, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ANY($1::int[])`,
      [approver_ids]
    );
    const validApprovers = approverCheck.rows.filter(u => u.role === 'manager' || u.role === 'admin');
    if (validApprovers.length !== approver_ids.length) {
      return res.status(400).json({ error: 'All approvers must have a Manager or Admin role' });
    }

    // Create workflow
    const wfResult = await pool.query(
      `INSERT INTO approval_workflows (document_id, created_by) VALUES ($1, $2) RETURNING *`,
      [document_id, req.user.id]
    );
    const workflow = wfResult.rows[0];

    // Create approval steps
    for (let i = 0; i < approver_ids.length; i++) {
      await pool.query(
        `INSERT INTO approval_steps (workflow_id, approver_id, step_order) VALUES ($1, $2, $3)`,
        [workflow.id, approver_ids[i], i + 1]
      );
    }

    // Update document status to pending
    await pool.query('UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2', ['pending', document_id]);

    // Return workflow with steps
    const steps = await pool.query(
      `SELECT a.*, u.name as approver_name, u.email as approver_email
       FROM approval_steps a JOIN users u ON a.approver_id = u.id
       WHERE a.workflow_id = $1 ORDER BY a.step_order`,
      [workflow.id]
    );

    res.status(201).json({ ...workflow, steps: steps.rows });
  } catch (err) {
    console.error('Create workflow error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.list = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `
      SELECT aw.*, d.title as document_title, d.status as document_status,
        u.name as created_by_name,
        (SELECT json_agg(
          json_build_object(
            'id', ast.id, 'step_order', ast.step_order, 'status', ast.status,
            'comments', ast.comments, 'actioned_at', ast.actioned_at,
            'approver_id', ast.approver_id, 'approver_name', au.name
          ) ORDER BY ast.step_order
        ) FROM approval_steps ast JOIN users au ON ast.approver_id = au.id WHERE ast.workflow_id = aw.id) as steps
      FROM approval_workflows aw
      JOIN documents d ON aw.document_id = d.id
      JOIN users u ON aw.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (status) {
      query += ` AND aw.status = $${paramIdx++}`;
      params.push(status);
    }

    // Non-admin: only see own workflows or ones where user is an approver
    if (req.user.role !== 'admin') {
      query += ` AND (aw.created_by = $${paramIdx++} OR EXISTS (SELECT 1 FROM approval_steps ast WHERE ast.workflow_id = aw.id AND ast.approver_id = $${paramIdx++}))`;
      params.push(req.user.id, req.user.id);
    }

    query += ` ORDER BY aw.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json({ workflows: result.rows });
  } catch (err) {
    console.error('List workflows error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT aw.*, d.title as document_title, d.status as document_status, d.file_url,
        u.name as created_by_name,
        (SELECT json_agg(
          json_build_object(
            'id', ast.id, 'step_order', ast.step_order, 'status', ast.status,
            'comments', ast.comments, 'actioned_at', ast.actioned_at,
            'approver_id', ast.approver_id, 'approver_name', au.name, 'approver_email', au.email
          ) ORDER BY ast.step_order
        ) FROM approval_steps ast JOIN users au ON ast.approver_id = au.id WHERE ast.workflow_id = aw.id) as steps
      FROM approval_workflows aw
      JOIN documents d ON aw.document_id = d.id
      JOIN users u ON aw.created_by = u.id
      WHERE aw.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get workflow error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.action = async (req, res) => {
  try {
    const { id, stepId } = req.params;
    const { action, comments } = req.body;

    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approved" or "rejected"' });
    }

    // Verify step exists and belongs to current user
    const step = await pool.query(
      `SELECT * FROM approval_steps WHERE id = $1 AND workflow_id = $2`,
      [stepId, id]
    );
    if (step.rows.length === 0) return res.status(404).json({ error: 'Step not found' });

    const currentStep = step.rows[0];
    if (currentStep.approver_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to action this step' });
    }
    if (currentStep.status !== 'pending') {
      return res.status(400).json({ error: 'Step already actioned' });
    }

    // Check previous steps are completed (sequential logic)
    if (currentStep.step_order > 1) {
      const prevSteps = await pool.query(
        `SELECT * FROM approval_steps WHERE workflow_id = $1 AND step_order < $2 AND status = 'pending'`,
        [id, currentStep.step_order]
      );
      if (prevSteps.rows.length > 0) {
        return res.status(400).json({ error: 'Previous steps must be completed first' });
      }
    }

    // Update step
    await pool.query(
      `UPDATE approval_steps SET status = $1, comments = $2, actioned_at = NOW() WHERE id = $3`,
      [action, comments || '', stepId]
    );

    if (action === 'rejected') {
      // Reject entire workflow
      await pool.query('UPDATE approval_workflows SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', id]);
      const wf = await pool.query('SELECT document_id FROM approval_workflows WHERE id = $1', [id]);
      await pool.query('UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', wf.rows[0].document_id]);
    } else {
      // Check if all steps are approved
      const pendingSteps = await pool.query(
        `SELECT COUNT(*) FROM approval_steps WHERE workflow_id = $1 AND status = 'pending'`,
        [id]
      );
      if (parseInt(pendingSteps.rows[0].count) === 0) {
        // All approved
        await pool.query('UPDATE approval_workflows SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', id]);
        const wf = await pool.query('SELECT document_id FROM approval_workflows WHERE id = $1', [id]);
        await pool.query('UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', wf.rows[0].document_id]);
      }
    }

    res.json({ message: `Step ${action}` });
  } catch (err) {
    console.error('Action error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.myPending = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ast.*, aw.document_id, d.title as document_title, d.status as document_status,
        u.name as requester_name
       FROM approval_steps ast
       JOIN approval_workflows aw ON ast.workflow_id = aw.id
       JOIN documents d ON aw.document_id = d.id
       JOIN users u ON aw.created_by = u.id
       WHERE ast.approver_id = $1 AND ast.status = 'pending'
       ORDER BY ast.created_at ASC`,
      [req.user.id]
    );
    res.json({ pending: result.rows });
  } catch (err) {
    console.error('My pending error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
