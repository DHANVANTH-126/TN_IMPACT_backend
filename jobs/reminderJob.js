const cron = require('node-cron');
const pool = require('../config/db');
const { sendMail, smtpConfigured } = require('../config/mailer');

function startReminderJob() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('🔔 Running approval reminder check...');
    try {
      const result = await pool.query(
        `SELECT ast.id, ast.approver_id, u.name as approver_name, u.email as approver_email,
          d.title as document_title, aw.created_at as workflow_created
         FROM approval_steps ast
         JOIN approval_workflows aw ON ast.workflow_id = aw.id
         JOIN documents d ON aw.document_id = d.id
         JOIN users u ON ast.approver_id = u.id
         WHERE ast.status = 'pending'
           AND ast.reminder_sent = false
           AND ast.created_at < NOW() - INTERVAL '48 hours'`
      );

      if (result.rows.length > 0) {
        console.log(`📧 ${result.rows.length} overdue approval(s) found:`);
        for (const row of result.rows) {
          console.log(`   → ${row.approver_name} (${row.approver_email}) — "${row.document_title}"`);
          const workflowAgeHours = Math.max(
            1,
            Math.round((Date.now() - new Date(row.workflow_created).getTime()) / (1000 * 60 * 60))
          );

          const mailResult = await sendMail({
            to: row.approver_email,
            subject: `Reminder: Pending approval for \"${row.document_title}\"`,
            text: `Hello ${row.approver_name},\n\nYou have a pending document approval: \"${row.document_title}\".\nThis workflow has been pending for about ${workflowAgeHours} hour(s).\n\nPlease review and take action in CDMS.`,
          });

          if (mailResult.skipped) {
            console.log('   SMTP not configured, reminder email skipped.');
          }

          // Mark reminder sent
          await pool.query('UPDATE approval_steps SET reminder_sent = true WHERE id = $1', [row.id]);
        }
      } else {
        console.log('   No overdue approvals.');
      }
    } catch (err) {
      console.error('Reminder job error:', err);
    }
  });

  console.log('📅 Reminder cron job scheduled (daily at 9:00 AM)');
  if (!smtpConfigured) {
    console.log('ℹ️  SMTP is not configured. Reminder emails will be skipped.');
  }
}

module.exports = startReminderJob;
