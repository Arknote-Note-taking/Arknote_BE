const supabase = require('../config/supabaseClient');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { isUserPro } = require('./userController');


const getCustomToken = (id, email) => {
  return jwt.sign(
    { id, email },
    process.env.JWT_SECRET || 'ai-tagging-secret-key-123!'
  );
};

const getUserFromToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ai-tagging-secret-key-123!');
    return { id: decoded.id, email: decoded.email };
  } catch (jwtErr) {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw Error('Invalid token');
    return { id: user.id, email: user.email };
  }
};

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
      .upsert({ id: authData.user.id, email, name, role: 'user', has_password: true }, { onConflict: 'id' })
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
      token: authData.session ? getCustomToken(userData.id, userData.email) : 'check-email', 
      role: userData.role,
      is_pro: await isUserPro(userData.id),
      onboarding_completed: userData.onboarding_completed || false
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
    let userData, userError;
    const resUser = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (resUser.error && resUser.error.code === '42703') {
      const fallbackUser = await supabase
        .from('users')
        .select('id, name, email, role, avatar_url, has_password')
        .eq('id', authData.user.id)
        .single();
      userData = fallbackUser.data;
      userError = fallbackUser.error;
      if (userData) userData.is_deleted = false;
    } else {
      userData = resUser.data;
      userError = resUser.error;
    }

    if (userError || !userData || userData.is_deleted) {
      console.error('Supabase Public Table Fetch Error: User profile missing or deleted.');
      return res.status(401).json({ error: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc xóa khỏi hệ thống.' });
    }

    res.status(200).json({ 
      id: userData.id, 
      name: userData.name, 
      email, 
      token: getCustomToken(userData.id, userData.email), 
      role: userData.role,
      avatar_url: userData.avatar_url,
      is_pro: await isUserPro(userData.id),
      onboarding_completed: userData.onboarding_completed || false
    });
  } catch (error) {
    console.error('Login Catch Block:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    if (!email) throw Error('Email is required');

    // 1. Generate 6 digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // 2. Insert into password_resets
    const { error: insertError } = await supabase
      .from('password_resets')
      .insert({ email, code, expires_at: expiresAt });

    if (insertError) {
      console.error('Insert OTP Error:', insertError);
      throw Error('Error saving reset code');
    }

    // 3. Configure nodemailer transporter
    let transporter;
    if (process.env.SENDGRID_API_KEY) {
      transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY
        }
      });
    } else {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Arknote System" <noreply@arknote.com>',
      to: email,
      subject: "Your Password Reset Code",
      text: `Your password reset code is: ${code}. It will expire in 5 minutes.`,
      html: `<b>Your password reset code is: ${code}</b><br/>It will expire in 5 minutes.`
    });

    console.log("====================================");
    console.log(">>> MÃ OTP CỦA BẠN LÀ:", code, "<<<");
    console.log("====================================");
    console.log("OTP Email Sent! Preview URL: %s", nodemailer.getTestMessageUrl(info));
    console.log("====================================");

    res.status(200).json({ message: 'Reset code sent to email' });
  } catch (error) {
    console.error('Forgot Password Catch Block:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const resetPassword = async (req, res) => {
  const { email, code, newPassword, confirmPassword } = req.body;
  try {
    if (!email || !code || !newPassword || !confirmPassword) {
      throw Error('All fields are required');
    }
    if (newPassword !== confirmPassword) {
      throw Error('Passwords do not match');
    }
    if (newPassword.length < 6) {
      throw Error('Password must be at least 6 characters');
    }

    // 1. Check OTP in database
    const { data: resetData, error: fetchError } = await supabase
      .from('password_resets')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .single();

    if (fetchError || !resetData) {
      throw Error('Invalid or expired reset code');
    }

    if (new Date(resetData.expires_at) < new Date()) {
      throw Error('Reset code has expired');
    }

    // 2. Find user in public.users to get ID
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError || !userData) {
      throw Error('User not found');
    }

    // 3. Update password in Supabase Auth
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userData.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error('Update Password Error:', updateError);
      throw Error('Failed to update password');
    }

    // 4. Delete the used OTP
    await supabase.from('password_resets').delete().eq('id', resetData.id);

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset Password Catch Block:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const googleLogin = async (req, res) => {
  const { access_token } = req.body;
  try {
    if (!access_token) throw Error('Access token required');

    // 1. Get user from Supabase using the token
    const { data: { user }, error: userError } = await supabase.auth.getUser(access_token);
    
    if (userError || !user) {
      throw Error('Invalid Google token');
    }

    // 2. Check if user exists in public.users
    const { data: userData, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    const name = user.user_metadata?.full_name || user.email.split('@')[0];
    const avatar_url = user.user_metadata?.avatar_url || null;

    if (!userData) {
      // User is new, DO NOT save to database yet. Wait for password setup.
      return res.status(200).json({ 
        id: user.id, 
        name, 
        email: user.email, 
        token: getCustomToken(user.id, user.email), 
        role: 'user',
        avatar_url,
        needsPassword: true,
        is_pro: await isUserPro(user.id),
        onboarding_completed: false
      });
    }

    // User already exists in public database
    res.status(200).json({ 
      id: userData.id, 
      name: userData.name, 
      email: userData.email, 
      token: getCustomToken(userData.id, userData.email), 
      role: userData.role,
      avatar_url: userData.avatar_url,
      needsPassword: !userData.has_password,
      is_pro: await isUserPro(userData.id),
      onboarding_completed: userData.onboarding_completed || false
    });
  } catch (error) {
    console.error('Google Login Error:', error.message);
    res.status(400).json({ error: error.message });
  }
};

const setPassword = async (req, res) => {
  const { newPassword, name, avatar_url } = req.body;
  const { authorization } = req.headers;

  try {
    // 1. Verify token manually since we removed requireAuth
    if (!authorization) throw Error('Authorization token required');
    const token = authorization.split(' ')[1];
    
    const user = await getUserFromToken(token);

    if (!newPassword || newPassword.length < 6) {
      throw Error('Password must be at least 6 characters');
    }

    // 2. Update password in Supabase Auth
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (updateAuthError) {
      console.error('Update Auth Password Error:', updateAuthError);
      throw Error('Failed to update password in Auth');
    }

    // 3. Insert into public.users NOW
    const { error: dbError } = await supabase
      .from('users')
      .upsert({ 
        id: user.id,
        email: user.email,
        name: name || user.email.split('@')[0],
        avatar_url: avatar_url || null,
        role: 'user',
        has_password: true 
      }, { onConflict: 'id' });

    if (dbError) {
      console.error('Update DB User Error:', dbError);
      throw Error('Failed to create user status');
    }

    // 4. Re-authenticate to get a fresh token (because changing password revokes old tokens)
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: newPassword
    });

    if (signInError || !authData.session) {
      console.error('Sign-in after password change failed:', signInError);
      throw Error('Password set but failed to retrieve new token');
    }

    res.status(200).json({ 
      message: 'Password set successfully',
      token: getCustomToken(user.id, user.email)
    });
  } catch (error) {
    console.error('Set Password Error:', error.message);
    res.status(400).json({ error: error.message });
  }
};

module.exports = { registerUser, loginUser, forgotPassword, resetPassword, googleLogin, setPassword };
