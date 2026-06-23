const supabase = require('../config/supabaseClient');
const { saveLocalNotification } = require('./notificationStorage');

const createNotification = async (req, { recipientId, isForAdmin, type, title, message, docId }) => {
  try {
    let newNotif = null;
    
    // 1. Try to insert into database
    const { data, error } = await supabase
      .from('notifications')
      .insert([{
        recipient_id: recipientId || null,
        is_for_admin: !!isForAdmin,
        type,
        title,
        message,
        read: false,
        doc_id: docId || null
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        console.warn('[NotificationService] Warning: notifications table does not exist in Supabase. Falling back to local file storage.');
        // Create a local payload and save locally
        const localPayload = {
          id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7),
          recipient_id: recipientId || null,
          is_for_admin: !!isForAdmin,
          type,
          title,
          message,
          read: false,
          created_at: new Date().toISOString(),
          doc_id: docId || null
        };
        newNotif = saveLocalNotification(localPayload);
      } else {
        console.error('[NotificationService] Database Error:', error);
      }
    } else {
      newNotif = data;
    }

    // 2. Fallback payload construction
    const payload = newNotif || {
      id: Date.now().toString(),
      recipient_id: recipientId || null,
      is_for_admin: !!isForAdmin,
      type,
      title,
      message,
      read: false,
      created_at: new Date().toISOString(),
      doc_id: docId || null
    };

    // 3. Emit via socket.io
    if (req.io) {
      if (isForAdmin) {
        console.log('[Socket-Debug] Emitting admin_notification via socket:', payload);
        req.io.emit('admin_notification', payload);
      } else {
        console.log('[Socket-Debug] Emitting user_notification via socket:', payload);
        req.io.emit('user_notification', payload);
      }
    } else {
      console.warn('[NotificationService] req.io is not defined, cannot emit socket.');
    }

    return payload;
  } catch (err) {
    console.error('[NotificationService] Exception:', err);
  }
};

module.exports = { createNotification };
