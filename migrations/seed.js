const bcrypt = require('bcryptjs');
const pool = require('../config/db');
require('dotenv').config();

async function seed() {
  try {
    // Check if admin already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@cdms.com']);
    if (existing.rows.length > 0) {
      console.log('Admin user already exists, skipping seed.');
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash('Admin@123', 12);
    const adminRole = await pool.query('SELECT id FROM roles WHERE name = $1', ['admin']);
    const engDept = await pool.query('SELECT id FROM departments WHERE name = $1', ['Engineering']);

    await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, department_id)
       VALUES ($1, $2, $3, $4, $5)`,
      ['System Admin', 'admin@cdms.com', passwordHash, adminRole.rows[0].id, engDept.rows[0].id]
    );

    console.log('✅ Seed complete — admin@cdms.com / Admin@123');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();
