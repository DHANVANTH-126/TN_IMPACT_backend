const pool = require('../config/db');
const es = require('../config/elasticsearch');

exports.search = async (req, res) => {
  try {
    const { q, department, status, tags, page = 1, limit = 20 } = req.query;

    // Try Elasticsearch first
    if (es.isAvailable() && q) {
      try {
        const must = [];
        const filter = [];

        if (q) {
          must.push({
            multi_match: {
              query: q,
              fields: ['title^3', 'description^2', 'tags', 'owner_name', 'department'],
              fuzziness: 'AUTO',
            },
          });
        }
        if (department) filter.push({ term: { department } });
        if (status) filter.push({ term: { status } });
        if (tags) {
          const tagList = tags.split(',').map(t => t.trim().toLowerCase());
          filter.push({ terms: { tags: tagList } });
        }

        const esResult = await es.getClient().search({
          index: 'documents',
          body: {
            from: (page - 1) * limit,
            size: parseInt(limit),
            query: { bool: { must, filter } },
            highlight: {
              fields: { title: {}, description: {} },
              pre_tags: ['<mark>'],
              post_tags: ['</mark>'],
            },
          },
        });

        const hits = esResult.hits.hits.map(hit => ({
          id: parseInt(hit._id),
          ...hit._source,
          highlights: hit.highlight || {},
          score: hit._score,
        }));

        return res.json({
          results: hits,
          total: esResult.hits.total.value,
          source: 'elasticsearch',
        });
      } catch (esErr) {
        console.warn('ES search failed, falling back to PG:', esErr.message);
      }
    }

    // PostgreSQL fallback
    let query = `
      SELECT d.id, d.title, d.description, d.status, d.created_at, d.file_type,
        u.name as owner_name, dep.name as department_name,
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

    if (q) {
      query += ` AND (d.title ILIKE $${paramIdx} OR d.description ILIKE $${paramIdx})`;
      params.push(`%${q}%`);
      paramIdx++;
    }
    if (department) {
      query += ` AND dep.name = $${paramIdx++}`;
      params.push(department);
    }
    if (status) {
      query += ` AND d.status = $${paramIdx++}`;
      params.push(status);
    }

    query += ` ORDER BY d.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const result = await pool.query(query, params);
    res.json({ results: result.rows, total: result.rows.length, source: 'postgresql' });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
