const supabase = require('./config/supabaseClient');
const { setUserPro } = require('./controllers/userController');

async function main() {
  const email = 'pro.test@arknote.ai';
  const password = '123456';
  const name = 'Test Pro User';

  console.log(`Checking if user ${email} already exists in auth.users...`);

  // Try to find the user in auth
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing users from auth:', listError);
    process.exit(1);
  }

  let existingUser = listData.users.find(u => u.email === email);
  let userId;

  if (existingUser) {
    console.log(`User already exists with ID: ${existingUser.id}. Resetting password and user metadata...`);
    userId = existingUser.id;
    
    // Update password & name
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: password,
      user_metadata: { name }
    });
    if (updateError) {
      console.error('Error updating user password/metadata:', updateError);
      process.exit(1);
    }
  } else {
    console.log(`Creating new auth user ${email}...`);
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (createError) {
      console.error('Error creating auth user:', createError);
      process.exit(1);
    }

    userId = createData.user.id;
    console.log(`User created successfully in auth with ID: ${userId}`);
  }

  // Insert or update public.users
  console.log(`Upserting to public.users table...`);
  const { error: dbError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email,
      name,
      role: 'user',
      has_password: true,
      onboarding_completed: true,
      is_deleted: false
    }, { onConflict: 'id' });

  if (dbError) {
    console.error('Error upserting to public.users:', dbError);
    process.exit(1);
  }

  // Set as PRO in backend/data/subscriptions.json
  console.log(`Setting user ${email} as PRO...`);
  setUserPro(userId, true);

  console.log(`\n========================================`);
  console.log(`Successfully created/updated Test Pro Account!`);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Role:     User`);
  console.log(`Plan:     PRO`);
  console.log(`========================================\n`);
  
  process.exit(0);
}

main();
