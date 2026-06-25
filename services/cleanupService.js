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
        if (n.doc_id) dbNotifDocIds.add(n.doc_id);
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
      
      // 3. Delete document record from database
      const { error: deleteErr } = await supabase
        .from('documents')
        .delete()
        .eq('id', doc.id);
        
      if (deleteErr) {
        console.error(`[CleanupService] Failed to delete db record for document ${doc.id}:`, deleteErr);
      } else {
        console.log(`[CleanupService] Successfully deleted db record for document ${doc.id}`);
        purgedCount++;
        
        // Emit socket deletion update
        if (io) {
          io.emit('document_deleted', { id: doc.id });
        }
      }
    }
    
    console.log(`[CleanupService] Cleanup task finished. Purged ${purgedCount} document(s).`);
  } catch (err) {
    console.error('[CleanupService] Unexpected error in cleanup task:', err);
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
