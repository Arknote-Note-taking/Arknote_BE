const supabase = require('../config/supabaseClient');

const getNotifications = async (req, res) => {
  try {
    console.log('[Notification-Debug] getNotifications endpoint hit. User:', req.user.email, 'Role:', req.user.role, 'ID:', req.user.id);
    let query = supabase.from('notifications').select('*');
    if (req.user.role === 'admin') {
      // Admins see notifications for themselves, plus those marked as is_for_admin
      query = query.or(`recipient_id.eq.${req.user.id},is_for_admin.eq.true`);
    } else {
      // Users only see notifications for themselves
      query = query.eq('recipient_id', req.user.id);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    console.log('[Notification-Debug] getNotifications DB Query Result:', data ? data.length : 0, 'items. Error:', error);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        // Fallback: load notifications from local notifications.json
        console.log('[NotificationController] Fetching from local notifications.json fallback');
        const { readLocalNotifications } = require('../services/notificationStorage');
        const localNotifs = readLocalNotifications();
        
        // Filter user/admin notifications
        const filtered = localNotifs.filter(n => {
          if (req.user.role === 'admin') {
            return n.recipient_id === req.user.id || n.is_for_admin === true;
          } else {
            return n.recipient_id === req.user.id;
          }
        });
        
        return res.status(200).json(filtered);
      }
      throw error;
    }
    res.status(200).json(data);
  } catch (error) {
    console.error('[Notification-Debug] Exception in getNotifications:', error);
    res.status(500).json({ error: error.message });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    let query = supabase.from('notifications').update({ read: true });
    if (req.user.role === 'admin') {
      query = query.or(`recipient_id.eq.${req.user.id},is_for_admin.eq.true`);
    } else {
      query = query.eq('recipient_id', req.user.id);
    }
    const { error } = await query;
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        // Fallback: update local JSON storage
        const { readLocalNotifications, writeLocalNotifications } = require('../services/notificationStorage');
        const localNotifs = readLocalNotifications();
        const updated = localNotifs.map(n => {
          const isMatch = req.user.role === 'admin' 
            ? (n.recipient_id === req.user.id || n.is_for_admin === true)
            : (n.recipient_id === req.user.id);
          return isMatch ? { ...n, read: true } : n;
        });
        writeLocalNotifications(updated);
        return res.status(200).json({ message: 'All notifications marked as read locally.' });
      }
      throw error;
    }
    res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First retrieve it to verify ownership
    const { data: notif, error: checkError } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .single();

    if (checkError) {
      if (checkError.code === '42P01' || checkError.code === 'PGRST205') {
        // Fallback: delete from local JSON file
        const { readLocalNotifications, writeLocalNotifications } = require('../services/notificationStorage');
        const localNotifs = readLocalNotifications();
        const updated = localNotifs.filter(n => n.id !== id);
        writeLocalNotifications(updated);
        return res.status(200).json({ message: 'Notification deleted locally.' });
      }
      // Return 200/success to let client remove from state even if not found in DB
      return res.status(200).json({ message: 'Notification deleted (not found in DB)' });
    }

    if (!notif) {
      return res.status(200).json({ message: 'Notification deleted (not found in DB)' });
    }

    // Access control check
    if (notif.is_for_admin) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    } else {
      if (notif.recipient_id !== req.user.id) {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    }

    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ message: 'Notification deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const clearNotifications = async (req, res) => {
  try {
    let query = supabase.from('notifications').delete();
    if (req.user.role === 'admin') {
      query = query.or(`recipient_id.eq.${req.user.id},is_for_admin.eq.true`);
    } else {
      query = query.eq('recipient_id', req.user.id);
    }
    const { error } = await query;
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        // Fallback: clear matching from local JSON file
        const { readLocalNotifications, writeLocalNotifications } = require('../services/notificationStorage');
        const localNotifs = readLocalNotifications();
        const remaining = localNotifs.filter(n => {
          const isMatch = req.user.role === 'admin' 
            ? (n.recipient_id === req.user.id || n.is_for_admin === true)
            : (n.recipient_id === req.user.id);
          return !isMatch; // Keep non-matching
        });
        writeLocalNotifications(remaining);
        return res.status(200).json({ message: 'All notifications cleared locally.' });
      }
      throw error;
    }
    res.status(200).json({ message: 'All notifications cleared.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    
    // First retrieve it to verify ownership
    const { data: notif, error: checkError } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .single();

    if (checkError) {
      if (checkError.code === '42P01' || checkError.code === 'PGRST205') {
        // Fallback: update local JSON file
        const { readLocalNotifications, writeLocalNotifications } = require('../services/notificationStorage');
        const localNotifs = readLocalNotifications();
        const updated = localNotifs.map(n => n.id === id ? { ...n, read: true } : n);
        writeLocalNotifications(updated);
        return res.status(200).json({ message: 'Notification marked as read locally.' });
      }
      return res.status(200).json({ message: 'Notification marked as read (not found in DB)' });
    }

    if (!notif) {
      return res.status(200).json({ message: 'Notification marked as read (not found in DB)' });
    }

    // Access control check
    if (notif.is_for_admin) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    } else {
      if (notif.recipient_id !== req.user.id) {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    }

    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) throw error;
    res.status(200).json({ message: 'Notification marked as read.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getNotifications,
  markAllAsRead,
  markAsRead,
  deleteNotification,
  clearNotifications
};
