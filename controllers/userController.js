const supabase = require('../config/supabaseClient');
const fs = require('fs');
const path = require('path');

const SUBS_FILE = path.join(__dirname, '../data/subscriptions.json');

// Ensure subscriptions directory and file exist
const initSubscriptionsFile = () => {
  const dir = path.dirname(SUBS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SUBS_FILE)) {
    fs.writeFileSync(SUBS_FILE, JSON.stringify({}));
  }
};

const getSubscriptions = () => {
  initSubscriptionsFile();
  try {
    const data = fs.readFileSync(SUBS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
};

const saveSubscriptions = (subs) => {
  initSubscriptionsFile();
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
};

const isUserPro = (userId) => {
  const subs = getSubscriptions();
  return !!subs[userId];
};

const setUserPro = (userId, status) => {
  const subs = getSubscriptions();
  if (status) {
    subs[userId] = true;
  } else {
    delete subs[userId];
  }
  saveSubscriptions(subs);
};

const getUsers = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    
    let users, error;
    const resUsers = await supabase
      .from('users')
      .select('id, email, name, role, created_at, is_deleted')
      .or('is_deleted.eq.false,is_deleted.is.null')
      .order('created_at', { ascending: false });

    if (resUsers.error && resUsers.error.code === '42703') {
      const fallbackUsers = await supabase
        .from('users')
        .select('id, email, name, role, created_at')
        .order('created_at', { ascending: false });
      users = fallbackUsers.data;
      error = fallbackUsers.error;
    } else {
      users = resUsers.data;
      error = resUsers.error;
    }

    if (error) throw error;
    
    // Alias id to _id for FE and append is_pro
    const formatted = users.map(u => ({ ...u, _id: u.id, is_pro: isUserPro(u.id) }));
    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDeletedUsers = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    
    let users, error;
    const resUsers = await supabase
      .from('users')
      .select('id, email, name, role, created_at, is_deleted')
      .eq('is_deleted', true)
      .order('created_at', { ascending: false });

    if (resUsers.error && resUsers.error.code === '42703') {
      users = [];
      error = null;
    } else {
      users = resUsers.data;
      error = resUsers.error;
    }

    if (error) throw error;
    
    const formatted = users.map(u => ({ ...u, _id: u.id, is_pro: isUserPro(u.id) }));
    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const restoreUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const userId = req.params.id;

    const { error: dbError } = await supabase
      .from('users')
      .update({ is_deleted: false })
      .eq('id', userId);

    if (dbError) throw dbError;

    // Save & Emit notification to user
    const { createNotification } = require('../services/notificationService');
    await createNotification(req, {
      recipientId: userId,
      type: 'user_restored',
      title: 'Tài khoản đã được khôi phục',
      message: 'Tài khoản của bạn đã được khôi phục thành công!'
    });

    res.status(200).json({ message: 'Người dùng đã được khôi phục thành công.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const requestDeleteAccount = async (req, res) => {
  try {
    // Save & Emit notification to admin
    const { createNotification } = require('../services/notificationService');
    await createNotification(req, {
      isForAdmin: true,
      type: 'user_delete_request',
      title: 'Yêu cầu xóa tài khoản',
      message: `Người dùng: ${req.user.name || req.user.email} (${req.user.email})`
    });
    res.status(200).json({ message: 'Đã gửi yêu cầu xóa tài khoản tới Admin.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const userId = req.params.id;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Trầm trọng: Không thể tự xóa chính mình.' });
    }

    // Soft delete: set is_deleted to true
    const { error: dbError } = await supabase
      .from('users')
      .update({ is_deleted: true })
      .eq('id', userId);

    if (dbError) throw dbError;

    res.status(200).json({ message: 'Người dùng đã được xóa tạm thời.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const permanentDeleteUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const userId = req.params.id;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Trầm trọng: Không thể tự xóa chính mình.' });
    }

    // Hard delete from users table
    const { error: dbError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (dbError) throw dbError;

    // Remove from subscriptions if present
    try {
      setUserPro(userId, false);
    } catch (e) {
      console.error('Error clearing subscription for deleted user:', e);
    }

    res.status(200).json({ message: 'Người dùng đã được xóa vĩnh viễn khỏi hệ thống.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, avatar_url, created_at, onboarding_completed')
      .eq('id', req.user.id)
      .single();

    if (error || !user) throw Error('User profile not found');
    
    res.status(200).json({ ...user, _id: user.id, is_pro: isUserPro(user.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data: user, error } = await supabase
      .from('users')
      .update({ name })
      .eq('id', req.user.id)
      .select('id, email, name, role, avatar_url, created_at')
      .single();

    if (error) throw error;
    
    res.status(200).json({ ...user, _id: user.id, is_pro: isUserPro(user.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không có tệp nào được tải lên' });

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const { data: user, error } = await supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', req.user.id)
      .select('id, email, name, role, avatar_url, created_at')
      .single();

    if (error) throw error;
    
    res.status(200).json({ ...user, _id: user.id, is_pro: isUserPro(user.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const upgradeToPro = async (req, res) => {
  try {
    setUserPro(req.user.id, true);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, avatar_url, created_at')
      .eq('id', req.user.id)
      .single();

    if (error || !user) throw Error('User profile not found');
    
    res.status(200).json({ ...user, _id: user.id, is_pro: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const saveOnboardingSurvey = async (req, res) => {
  const { answers } = req.body;
  const userId = req.user.id;
  try {
    if (answers && typeof answers === 'object') {
      const { error: surveyError } = await supabase
        .from('onboarding_surveys')
        .upsert({ user_id: userId, answers }, { onConflict: 'user_id' });

      if (surveyError) {
        console.error('Save onboarding survey error:', surveyError);
      }
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .update({ onboarding_completed: true })
      .eq('id', userId)
      .select('id, email, name, role, avatar_url, created_at, onboarding_completed')
      .single();

    if (userError) throw userError;

    res.status(200).json({ ...user, _id: user.id, is_pro: isUserPro(user.id) });
  } catch (error) {
    console.error('saveOnboardingSurvey error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getUsers,
  getDeletedUsers,
  restoreUser,
  deleteUser,
  permanentDeleteUser,
  getProfile,
  updateProfile,
  uploadAvatar,
  upgradeToPro,
  isUserPro,
  setUserPro,
  requestDeleteAccount,
  saveOnboardingSurvey
};

