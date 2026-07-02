const supabase = require('../config/supabaseClient');
const fs = require('fs');
const path = require('path');
const { readLocalNotifications } = require('./notificationStorage');

const runCleanupTask = async (io) => {
  try {
    console.log('[CleanupService] Running automatic document cleanup task...');

    // Cutoff time is 15 days ago
    const fifteenDaysAgoLimit = Date.now() - 15 * 24 * 60 * 60 * 1000;

    // Fetch all soft-deleted documents
    const { data: deletedDocs, error: docError } = await supabase
      .from('documents')
      .select('id, file_url, title, user_id, deleted_at, created_at')
      .eq('is_deleted', true);

    if (docError) {
      console.error('[CleanupService] Error fetching soft-deleted documents:', docError);
      return;
    }

    if (!deletedDocs || deletedDocs.length === 0) {
      console.log('[CleanupService] No soft-deleted documents found.');
      return;
    }

    // Load local notifications
    const localNotifs = readLocalNotifications();

    // Fetch DB notifications for restore requests
    const { data: dbNotifs, error: notifError } = await supabase
      .from('notifications')
      .select('*')
      .eq('type', 'document_restore_request');

    const dbNotifDocIds = new Set();
    if (!notifError && dbNotifs) {
      dbNotifs.forEach(n => {
        if (n.doc_id) {
          dbNotifDocIds.add(n.doc_id);
        } else if (n.message && n.message.includes('|||doc_id:')) {
          const docId = n.message.split('|||doc_id:')[1];
          if (docId) dbNotifDocIds.add(docId);
        }
      });
    }

    const localNotifDocIds = new Set();
    localNotifs.forEach(n => {
      if (n.type === 'document_restore_request' && n.doc_id) {
        localNotifDocIds.add(n.doc_id);
      }
    });

    let purgedCount = 0;

    for (const doc of deletedDocs) {
      const delTimeStr = doc.deleted_at || doc.created_at;
      if (!delTimeStr) continue;

      const delDate = new Date(delTimeStr);
      const isOlderThan15Days = delDate.getTime() < fifteenDaysAgoLimit;

      if (!isOlderThan15Days) {
        continue;
      }

      // Skip if there's a restore request
      const hasRestoreRequest = dbNotifDocIds.has(doc.id) || localNotifDocIds.has(doc.id);
      if (hasRestoreRequest) {
        console.log(`[CleanupService] Skipping document "${doc.title}" (${doc.id}) because there is an active restore request.`);
        continue;
      }

      console.log(`[CleanupService] Purging document "${doc.title}" (${doc.id}) soft-deleted at ${delTimeStr}...`);

      // 1. Delete dependent data first to satisfy foreign key constraints
      try {
        await supabase.from('document_comments').delete().eq('document_id', doc.id);
      } catch (e) {
        console.warn(`[CleanupService] Failed to delete comments for document ${doc.id}:`, e.message);
      }

      try {
        await supabase.from('document_annotations').delete().eq('document_id', doc.id);
      } catch (e) {
        console.warn(`[CleanupService] Failed to delete annotations for document ${doc.id}:`, e.message);
      }

      try {
        await supabase.from('flashcard_decks').update({ document_id: null }).eq('document_id', doc.id);
      } catch (e) {
        console.warn(`[CleanupService] Failed to nullify document_id on flashcard_decks for document ${doc.id}:`, e.message);
      }

      try {
        await supabase.from('quizzes').update({ document_id: null }).eq('document_id', doc.id);
      } catch (e) {
        console.warn(`[CleanupService] Failed to nullify document_id on quizzes for document ${doc.id}:`, e.message);
      }

      // 2. Delete physical file
      if (doc.file_url) {
        const relativePath = doc.file_url.startsWith('/') ? doc.file_url.slice(1) : doc.file_url;
        const filePath = path.join(__dirname, '..', relativePath);

        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[CleanupService] Deleted physical file: ${filePath}`);
          } else {
            console.log(`[CleanupService] File not found on disk: ${filePath}`);
          }
        } catch (fileErr) {
          console.error(`[CleanupService] Failed to delete file ${filePath}:`, fileErr);
        }
      }

      // 3. Mark the document as purged and clear heavy content so it cannot be restored,
      // but keep the database record so that it is still counted in the landing page stats.
      const { error: updateErr } = await supabase
        .from('documents')
        .update({
          file_url: null,
          content: null,
          summary: 'Tài liệu đã bị xóa vĩnh viễn sau 15 ngày.',
          tags: []
        })
        .eq('id', doc.id);

      if (updateErr) {
        console.error(`[CleanupService] Failed to purge db record for document ${doc.id}:`, updateErr);
      } else {
        console.log(`[CleanupService] Successfully purged db record for document ${doc.id}`);
        purgedCount++;

        // Emit socket deletion update to active clients
        if (io) {
          io.emit('document_deleted', { id: doc.id });
        }
      }
    }

    console.log(`[CleanupService] Cleanup task finished. Purged ${purgedCount} document(s).`);

    // Check and notify user when their PRO subscription is expiring in <= 3 days
    await checkProExpirationNotifications(io);
  } catch (err) {
    console.error('[CleanupService] Unexpected error in cleanup task:', err);
  }
};

const checkProExpirationNotifications = async (io) => {
  try {
    console.log('[CleanupService] Checking for user PRO plans about to expire (within 3 days)...');

    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Fetch users who are pro and have pro_expires_at
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, email, name, pro_expires_at')
      .eq('is_pro', true)
      .not('pro_expires_at', 'is', null);

    if (userError) {
      console.error('[CleanupService] Error fetching pro users for expiration check:', userError);
      return;
    }

    if (!users || users.length === 0) {
      console.log('[CleanupService] No active PRO users with expiration dates found.');
      return;
    }

    const { createNotification } = require('./notificationService');

    let notifiedCount = 0;

    for (const user of users) {
      const expiresAt = new Date(user.pro_expires_at);

      // Expiring in next 3 days and hasn't expired yet
      if (expiresAt > now && expiresAt <= threeDaysFromNow) {
        const dateString = expiresAt.toLocaleDateString('vi-VN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });

        // Check if we already notified this user about this specific expiration date
        const uniqueMsgPart = `ngày ${dateString}`;

        const { data: existingNotifs, error: checkError } = await supabase
          .from('notifications')
          .select('id')
          .eq('recipient_id', user.id)
          .eq('type', 'pro_expiration_warning')
          .like('message', `%${uniqueMsgPart}%`)
          .limit(1);

        if (checkError) {
          console.error(`[CleanupService] Error checking existing notifications for user ${user.email}:`, checkError);
          continue;
        }

        if (existingNotifs && existingNotifs.length > 0) {
          // Already notified for this expiration date
          continue;
        }

        // Send notification
        console.log(`[CleanupService] Sending pro expiration warning to user ${user.email} (expires on ${dateString})`);

        await createNotification({ io }, {
          recipientId: user.id,
          isForAdmin: false,
          type: 'pro_expiration_warning',
          title: 'Gói PRO sắp hết hạn / PRO plan expiring soon',
          message: `Gói PRO của bạn sẽ hết hạn vào ngày ${dateString}. Vui lòng gia hạn để duy trì hạn mức và các tính năng Premium. / Your PRO plan will expire on ${dateString}. Please renew to maintain limits and Premium features.`,
        });

        notifiedCount++;
      }
    }

    console.log(`[CleanupService] Finished checking PRO expirations. Sent ${notifiedCount} warning notification(s).`);
  } catch (err) {
    console.error('[CleanupService] Unexpected error in PRO expiration check task:', err);
  }
};

const startCleanupInterval = (io) => {
  // Run once on startup after 10 seconds to allow everything to initialize
  setTimeout(() => {
    runCleanupTask(io);
  }, 10000);

  // Schedule to run every 24 hours
  setInterval(() => {
    runCleanupTask(io);
  }, 24 * 60 * 60 * 1000);
};

module.exports = {
  runCleanupTask,
  startCleanupInterval
};
