const supabase = require('../config/supabaseClient');

const isUserPro = async (userId) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('is_pro, pro_expires_at')
      .eq('id', userId)
      .single();
    if (error || !user) return false;
    
    // Check if pro has expired
    if (user.is_pro && user.pro_expires_at && new Date(user.pro_expires_at) < new Date()) {
      // Auto downgrade in database
      await supabase.from('users').update({ is_pro: false }).eq('id', userId);
      return false;
    }
    
    return !!user.is_pro;
  } catch (err) {
    console.error('Error checking isUserPro:', err);
    return false;
  }
};

const setUserPro = async (userId, status) => {
  try {
    const expiresAt = status ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null; // 30 days
    await supabase
      .from('users')
      .update({ 
        is_pro: status, 
        pro_expires_at: expiresAt,
        ai_credits_remaining: status ? 500 : 30 // Pro users get more daily credits
      })
      .eq('id', userId);
  } catch (err) {
    console.error('Error setting user pro:', err);
  }
};

const getUsers = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    
    let users, error;
    const resUsers = await supabase
      .from('users')
      .select('id, email, name, role, created_at, is_deleted, is_pro, ai_credits_remaining')
      .or('is_deleted.eq.false,is_deleted.is.null')
      .order('created_at', { ascending: false });

    if (resUsers.error && resUsers.error.code === '42703') {
      const fallbackUsers = await supabase
        .from('users')
        .select('id, email, name, role, created_at, is_pro, ai_credits_remaining')
        .order('created_at', { ascending: false });
      users = fallbackUsers.data;
      error = fallbackUsers.error;
    } else {
      users = resUsers.data;
      error = resUsers.error;
    }

    if (error) throw error;
    
    console.log(`[getUsers] Admin: ${req.user.email}, Users found in DB: ${users ? users.length : 0}`);
    
    // Alias id to _id for FE and append is_pro
    const formatted = users.map(u => ({ ...u, _id: u.id, is_pro: !!u.is_pro }));
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
      .select('id, email, name, role, created_at, is_deleted, is_pro, ai_credits_remaining')
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
    
    const formatted = users.map(u => ({ ...u, _id: u.id, is_pro: !!u.is_pro }));
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
      .select('id, email, name, role, avatar_url, created_at, onboarding_completed, is_pro, ai_credits_remaining')
      .eq('id', req.user.id)
      .single();

    if (error || !user) throw Error('User profile not found');
    
    res.status(200).json({ ...user, _id: user.id, is_pro: !!user.is_pro });
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
      .select('id, email, name, role, avatar_url, created_at, is_pro, ai_credits_remaining')
      .single();

    if (error) throw error;
    
    res.status(200).json({ ...user, _id: user.id, is_pro: !!user.is_pro });
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
      .select('id, email, name, role, avatar_url, created_at, is_pro, ai_credits_remaining')
      .single();

    if (error) throw error;
    
    res.status(200).json({ ...user, _id: user.id, is_pro: !!user.is_pro });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const upgradeToPro = async (req, res) => {
  try {
    await setUserPro(req.user.id, true);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, avatar_url, created_at, is_pro, ai_credits_remaining')
      .eq('id', req.user.id)
      .single();

    if (error || !user) throw Error('User profile not found');
    
    res.status(200).json({ ...user, _id: user.id, is_pro: !!user.is_pro });
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
      .select('id, email, name, role, avatar_url, created_at, onboarding_completed, is_pro, ai_credits_remaining')
      .single();

    if (userError) throw userError;

    res.status(200).json({ ...user, _id: user.id, is_pro: !!user.is_pro });
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

