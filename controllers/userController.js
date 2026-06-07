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
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, role, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Alias id to _id for FE and append is_pro
    const formatted = users.map(u => ({ ...u, _id: u.id, is_pro: isUserPro(u.id) }));
    res.status(200).json(formatted);
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

    // 1. Cascade Delete: wipe out all their associated documents
    await supabase.from('documents').delete().eq('user_id', userId);
    
    // 1.5. Clean up password_resets using the user's email
    const { data: userToDelete } = await supabase.from('users').select('email').eq('id', userId).single();
    if (userToDelete?.email) {
      await supabase.from('password_resets').delete().eq('email', userToDelete.email);
    }

    // 2. Delete from public.users table
    const { error: dbError } = await supabase.from('users').delete().eq('id', userId);
    if (dbError) throw dbError;

    // 3. Delete from Supabase Auth (Requires Service Role Key)
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) {
      console.error('CRITICAL ERROR: Failed to delete user from Supabase Auth!');
      console.error('Message:', authError.message);
      console.error('ACTION REQUIRED: Ensure your SUPABASE_KEY in .env is the SERVICE ROLE KEY, not the anon key.');
    }

    // Clean up subscription locally too
    setUserPro(userId, false);

    res.status(200).json({ message: 'Người dùng và dữ liệu liên quan đã bị xóa vĩnh viễn.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, avatar_url, created_at')
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

module.exports = {
  getUsers,
  deleteUser,
  getProfile,
  updateProfile,
  uploadAvatar,
  upgradeToPro,
  isUserPro
};

