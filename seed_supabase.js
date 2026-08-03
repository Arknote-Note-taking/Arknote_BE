require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const supabase = require('./config/supabaseClient');

// Define ONLY admin user
const adminUserConfig = {
  email: 'admin@arknote.com',
  password: '123456',
  name: 'Administrator',
  role: 'admin',
  is_pro: true
};

const mockUserEmails = ['staff@arknote.com', 'pro.test@arknote.ai'];

async function setupAdminAndCleanupMock() {
  try {
    console.log('[SEED] Starting Admin user setup and mock data cleanup...');

    // 1. Ensure Admin User exists in Auth & public.users
    console.log(`[SEED] Ensuring admin user: ${adminUserConfig.email}...`);

    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      throw new Error(`Error listing auth users: ${listError.message}`);
    }

    let existingAdmin = listData.users.find(authU => authU.email === adminUserConfig.email);
    let adminId;

    if (existingAdmin) {
      adminId = existingAdmin.id;
      console.log(`[SEED] Admin ${adminUserConfig.email} exists with ID: ${adminId}. Resetting credentials...`);
      const { error: updateError } = await supabase.auth.admin.updateUserById(adminId, {
        password: adminUserConfig.password,
        user_metadata: { name: adminUserConfig.name }
      });
      if (updateError) {
        throw new Error(`Error updating admin auth user: ${updateError.message}`);
      }
    } else {
      console.log(`[SEED] Creating new admin auth user ${adminUserConfig.email}...`);
      const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email: adminUserConfig.email,
        password: adminUserConfig.password,
        email_confirm: true,
        user_metadata: { name: adminUserConfig.name }
      });
      if (createError) {
        if (createError.message.includes('already been registered')) {
          const { data: pUser } = await supabase.from('users').select('id').eq('email', adminUserConfig.email).single();
          if (pUser) {
            adminId = pUser.id;
          } else {
            throw new Error(`Error creating admin auth user: ${createError.message}`);
          }
        } else {
          throw new Error(`Error creating admin auth user: ${createError.message}`);
        }
      } else {
        adminId = createData.user.id;
      }
    }

    // Upsert into public.users
    console.log(`[SEED] Upserting to public.users for ${adminUserConfig.email}...`);
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year PRO
    const { error: dbError } = await supabase
      .from('users')
      .upsert({
        id: adminId,
        email: adminUserConfig.email,
        name: adminUserConfig.name,
        role: 'admin',
        is_pro: true,
        pro_expires_at: expiresAt,
        ai_credits_remaining: 1000,
        has_password: true,
        onboarding_completed: true,
        is_deleted: false
      }, { onConflict: 'id' });

    if (dbError) {
      throw new Error(`Error upserting to public.users table: ${dbError.message}`);
    }

    // 2. Remove mock users staff@arknote.com & pro.test@arknote.ai
    console.log('[SEED] Removing mock test users...');
    for (const mockEmail of mockUserEmails) {
      const mockAuthUser = listData.users.find(u => u.email === mockEmail);
      if (mockAuthUser) {
        await supabase.auth.admin.deleteUser(mockAuthUser.id);
        console.log(`[SEED] Deleted auth user: ${mockEmail}`);
      }
      await supabase.from('users').delete().eq('email', mockEmail);
    }

    // 3. Clean up all sample mock data from database tables
    console.log('[SEED] Cleaning up mock data from database tables...');

    // Get list of mock deck IDs to clean up reviews & cards
    const { data: mockDecks } = await supabase.from('flashcard_decks').select('id');
    const deckIds = mockDecks?.map(d => d.id) || [];
    if (deckIds.length > 0) {
      const { data: cards } = await supabase.from('flashcards').select('id').in('deck_id', deckIds);
      const cardIds = cards?.map(c => c.id) || [];
      if (cardIds.length > 0) {
        await supabase.from('flashcard_reviews').delete().in('flashcard_id', cardIds);
        await supabase.from('flashcards').delete().in('id', cardIds);
      }
    }

    await supabase.from('quiz_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('quizzes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('flashcard_decks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('document_annotations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('document_comments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('folders').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('\n==================================================');
    console.log('[SUCCESS] Cleaned up all sample mock data!');
    console.log('Only real data will be used. Admin account is preserved:');
    console.log(`- Email: ${adminUserConfig.email} | Password: ${adminUserConfig.password} | Role: ADMIN`);
    console.log('==================================================\n');
    process.exit(0);

  } catch (error) {
    console.error(`\n[ERROR] Setup failed:`, error.message);
    process.exit(1);
  }
}

setupAdminAndCleanupMock();
