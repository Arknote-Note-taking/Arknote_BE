const supabase = require('../config/supabaseClient');

const registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields must be filled' });

    console.log(`Attempting to register user: ${email}`);

    // Sign up via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });

    if (authError) {
      console.error('Supabase Auth SignUp Error:', authError);
      throw Error(authError.message);
    }
    
    if (!authData.user) throw Error('User creation failed');

    // Insert or update public.users
    // We use upsert in case the user was created in auth but didn't make it to public.users before
    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert({ id: authData.user.id, email, name, role: 'user' }, { onConflict: 'id' })
      .select()
      .single();

    if (userError) {
      console.error('Supabase Public Table Insert Error:', userError);
      throw Error(userError.message);
    }

    res.status(200).json({ 
      id: userData.id, 
      name, 
      email, 
      token: authData.session?.access_token || 'check-email', 
      role: userData.role 
    });
  } catch (error) {
    console.error('Registration Catch Block:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) throw Error('All fields must be filled');

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('Supabase Auth Login Error:', authError);
      throw Error(authError.message);
    }

    // Fetch user details from public.users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (userError || !userData) {
      console.error('Supabase Public Table Fetch Error: User profile missing.');
      return res.status(401).json({ error: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc xóa khỏi hệ thống.' });
    }

    res.status(200).json({ 
      id: userData.id, 
      name: userData.name, 
      email, 
      token: authData.session.access_token, 
      role: userData.role,
      avatar_url: userData.avatar_url
    });
  } catch (error) {
    console.error('Login Catch Block:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = { registerUser, loginUser };
