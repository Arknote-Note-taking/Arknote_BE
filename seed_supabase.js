require('dotenv').config();
const supabase = require('./config/supabaseClient');
const docsData = require('./data/documents');

// Define users to seed
const usersToSeed = [
  {
    email: 'admin@arknote.com',
    password: '123456',
    name: 'Administrator',
    role: 'admin',
    is_pro: true
  },
  {
    email: 'staff@arknote.com',
    password: '123456',
    name: 'John Staff',
    role: 'user',
    is_pro: false
  },
  {
    email: 'pro.test@arknote.ai',
    password: '123456',
    name: 'Test Pro User',
    role: 'user',
    is_pro: true
  }
];

// 768-dimensional mock vector generator
const subjectClusters = {
  'Nhân sự': Array.from({ length: 768 }, () => 0.5 + Math.random() * 0.1),
  'Hành chính': Array.from({ length: 768 }, () => -0.5 + Math.random() * 0.1),
  'Pháp luật': Array.from({ length: 768 }, () => 0.8 + Math.random() * 0.1),
  'Học tập': Array.from({ length: 768 }, () => -0.8 + Math.random() * 0.1),
};

const mockEmbedding = (subject) => {
   const base = subjectClusters[subject] || Array.from({ length: 768 }, () => Math.random());
   const array = base.map(val => val + (Math.random() * 0.05));
   // Normalize to unit vector
   const magnitude = Math.sqrt(array.reduce((sum, val) => sum + val * val, 0));
   return array.map(val => val / magnitude);
};

async function seedDatabase() {
  try {
    console.log('[SEED] Starting Supabase database seeding...');

    // 1. Upsert Users
    const seededUserMap = {};

    for (const u of usersToSeed) {
      console.log(`[SEED] Checking/creating auth user: ${u.email}...`);

      const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) {
        throw new Error(`Error listing auth users: ${listError.message}`);
      }

      let existingUser = listData.users.find(authU => authU.email === u.email);
      let userId;

      if (existingUser) {
        userId = existingUser.id;
        console.log(`[SEED] User ${u.email} exists with ID: ${userId}. Resetting password and name...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
          password: u.password,
          user_metadata: { name: u.name }
        });
        if (updateError) {
          throw new Error(`Error updating auth user: ${updateError.message}`);
        }
      } else {
        console.log(`[SEED] Creating new auth user ${u.email}...`);
        const { data: createData, error: createError } = await supabase.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { name: u.name }
        });
        if (createError) {
          throw new Error(`Error creating auth user: ${createError.message}`);
        }
        userId = createData.user.id;
      }

      // Upsert into public.users
      console.log(`[SEED] Upserting to public.users for ${u.email}...`);
      const expiresAt = u.is_pro ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null; // 1 year PRO
      
      const { error: dbError } = await supabase
        .from('users')
        .upsert({
          id: userId,
          email: u.email,
          name: u.name,
          role: u.role,
          is_pro: u.is_pro,
          pro_expires_at: expiresAt,
          ai_credits_remaining: u.is_pro ? 100 : 30,
          has_password: true,
          onboarding_completed: true,
          is_deleted: false
        }, { onConflict: 'id' });

      if (dbError) {
        throw new Error(`Error upserting to public.users table: ${dbError.message}`);
      }

      seededUserMap[u.email] = userId;
    }

    const userIds = Object.values(seededUserMap);
    const adminId = seededUserMap['admin@arknote.com'];
    const staffId = seededUserMap['staff@arknote.com'];
    const proId = seededUserMap['pro.test@arknote.ai'];

    // 2. Clean up previous mock data for these specific seed users
    console.log('[SEED] Cleaning up old mock data for seed users...');
    
    // Select decks first to delete flashcards
    const { data: decks } = await supabase.from('flashcard_decks').select('id').in('user_id', userIds);
    const deckIds = decks?.map(d => d.id) || [];
    if (deckIds.length > 0) {
      // Find flashcards under these decks
      const { data: cards } = await supabase.from('flashcards').select('id').in('deck_id', deckIds);
      const cardIds = cards?.map(c => c.id) || [];
      if (cardIds.length > 0) {
        await supabase.from('flashcard_reviews').delete().in('flashcard_id', cardIds);
        await supabase.from('flashcards').delete().in('id', cardIds);
      }
    }
    
    await supabase.from('quiz_attempts').delete().in('user_id', userIds);
    await supabase.from('quizzes').delete().in('user_id', userIds);
    await supabase.from('flashcard_decks').delete().in('user_id', userIds);
    await supabase.from('document_annotations').delete().in('user_id', userIds);
    await supabase.from('document_comments').delete().in('user_id', userIds);
    await supabase.from('documents').delete().in('user_id', userIds);
    await supabase.from('folders').delete().in('user_id', userIds);
    
    console.log('[SEED] Cleanup complete.');

    // 3. Create mock Folders
    console.log('[SEED] Seeding folders...');
    const userFolders = {};

    for (const uId of userIds) {
      const foldersToInsert = [
        { name: 'Pháp lý & Quy định', user_id: uId },
        { name: 'Nhân sự & Hành chính', user_id: uId },
        { name: 'Tài liệu học tập', user_id: uId }
      ];
      
      const { data: insertedFolders, error: folderErr } = await supabase
        .from('folders')
        .insert(foldersToInsert)
        .select();

      if (folderErr) throw folderErr;
      userFolders[uId] = insertedFolders;
    }
    console.log('[SEED] Folders seeded successfully.');

    // 4. Create mock Documents
    console.log('[SEED] Seeding documents (generating 1536-dim vector embeddings)...');
    const createdDocs = [];

    for (const uId of userIds) {
      const folders = userFolders[uId];
      const docsToInsert = docsData.map((doc, idx) => {
        // Determine folder_id based on subject
        let folderId = null;
        if (doc.subject === 'Nhân sự' || doc.subject === 'Hành chính') {
          folderId = folders.find(f => f.name === 'Nhân sự & Hành chính')?.id;
        } else if (doc.subject === 'Pháp luật') {
          folderId = folders.find(f => f.name === 'Pháp lý & Quy định')?.id;
        } else if (doc.subject === 'Học tập') {
          folderId = folders.find(f => f.name === 'Tài liệu học tập')?.id;
        }

        return {
          title: doc.title,
          content: doc.content,
          summary: doc.summary,
          tags: doc.tags || [],
          subject: doc.subject || 'General',
          file_url: doc.fileUrl,
          embedding: mockEmbedding(doc.subject || 'General'),
          user_id: uId,
          folder_id: folderId,
          is_deleted: false,
          is_pinned: idx === 0, // Pin the first document
          ai_confidence: doc.aiConfidence || 90,
          created_at: new Date(Date.now() - idx * 24 * 60 * 60 * 1000).toISOString()
        };
      });

      const { data: insertedDocs, error: docsErr } = await supabase
        .from('documents')
        .insert(docsToInsert)
        .select();
      
      if (docsErr) throw docsErr;
      createdDocs.push(...insertedDocs);
    }
    console.log(`[SEED] Seeded ${createdDocs.length} mock documents successfully.`);

    // 5. Create mock Quizzes
    console.log('[SEED] Seeding quizzes...');
    const quizzesToInsert = [];
    for (const doc of createdDocs) {
      if (doc.title.includes('lương') || doc.title.includes('mẫu') || doc.title.includes('bảo mật') || doc.title.includes('Bảo hiểm')) {
        const questions = [
          {
            question: `Câu hỏi 1 về tài liệu: ${doc.title}?`,
            options: ["Đáp án đúng A", "Đáp án sai B", "Đáp án sai C", "Đáp án sai D"],
            answer: "Đáp án đúng A",
            explanation: `Lời giải chi tiết cho câu hỏi 1 của tài liệu: ${doc.title}.`
          },
          {
            question: `Câu hỏi 2 về chủ đề ${doc.subject}?`,
            options: ["Sai lầm A", "Đáp án đúng B", "Sai lầm C", "Sai lầm D"],
            answer: "Đáp án đúng B",
            explanation: `Lời giải chi tiết giải thích tại sao đáp án B là đúng dựa trên ${doc.summary || doc.title}.`
          },
          {
            question: `Câu hỏi 3 về nội dung: ${doc.title}?`,
            options: ["Lựa chọn 1", "Lựa chọn 2", "Đáp án đúng C", "Lựa chọn 4"],
            answer: "Đáp án đúng C",
            explanation: `Phân tích nội dung và đưa ra đáp án đúng C.`
          }
        ];
        
        quizzesToInsert.push({
          user_id: doc.user_id,
          document_id: doc.id,
          title: `Quiz ôn tập: ${doc.title}`,
          questions: questions
        });
      }
    }

    const { data: insertedQuizzes, error: quizErr } = await supabase
      .from('quizzes')
      .insert(quizzesToInsert)
      .select();

    if (quizErr) throw quizErr;
    console.log(`[SEED] Seeded ${insertedQuizzes.length} quizzes successfully.`);

    // 6. Create mock Quiz Attempts
    console.log('[SEED] Seeding quiz attempts...');
    const attemptsToInsert = [];
    for (const quiz of insertedQuizzes) {
      // Admin is not allowed to take quizzes in the controller, so seed only for staff and pro test users
      if (quiz.user_id !== adminId) {
        attemptsToInsert.push({
          quiz_id: quiz.id,
          user_id: quiz.user_id,
          score: 2,
          user_answers: { "0": "Đáp án đúng A", "1": "Đáp án đúng B", "2": "Lựa chọn 1" },
          is_completed: true,
          time_spent: 45,
          current_question_index: 2,
          completed_at: new Date().toISOString()
        });
      }
    }

    if (attemptsToInsert.length > 0) {
      const { error: attemptErr } = await supabase
        .from('quiz_attempts')
        .insert(attemptsToInsert);
      if (attemptErr) throw attemptErr;
      console.log(`[SEED] Seeded ${attemptsToInsert.length} quiz attempts successfully.`);
    }

    // 7. Create mock Flashcard Decks & Flashcards
    console.log('[SEED] Seeding flashcard decks & flashcards...');
    const decksToInsert = [];
    for (const doc of createdDocs) {
      if (doc.title.includes('lương') || doc.title.includes('quy trình') || doc.title.includes('Nghị định') || doc.title.includes('an toàn')) {
        decksToInsert.push({
          user_id: doc.user_id,
          document_id: doc.id,
          title: `Deck: ${doc.title}`,
          description: `Bộ thẻ ghi nhớ học tập cho tài liệu: ${doc.title}`
        });
      }
    }

    const { data: insertedDecks, error: deckErr } = await supabase
      .from('flashcard_decks')
      .insert(decksToInsert)
      .select();

    if (deckErr) throw deckErr;

    const flashcardsToInsert = [];
    for (const deck of insertedDecks) {
      flashcardsToInsert.push(
        {
          deck_id: deck.id,
          front_text: `Thuật ngữ 1 từ tài liệu của deck này?`,
          back_text: `Định nghĩa / Giải thích chi tiết số 1.`
        },
        {
          deck_id: deck.id,
          front_text: `Thuật ngữ 2 từ tài liệu của deck này?`,
          back_text: `Định nghĩa / Giải thích chi tiết số 2.`
        },
        {
          deck_id: deck.id,
          front_text: `Khái niệm 3 quan trọng cần nhớ?`,
          back_text: `Nội dung giải nghĩa khái niệm số 3.`
        }
      );
    }

    if (flashcardsToInsert.length > 0) {
      const { error: cardErr } = await supabase
        .from('flashcards')
        .insert(flashcardsToInsert);
      if (cardErr) throw cardErr;
      console.log(`[SEED] Seeded ${flashcardsToInsert.length} flashcards successfully.`);
    }

    console.log('\n==================================================');
    console.log('[SUCCESS] Supabase database has been seeded successfully!');
    console.log('Login credentials:');
    usersToSeed.forEach(u => {
      console.log(`- Email: ${u.email.padEnd(22)} | Password: ${u.password.padEnd(8)} | Role: ${u.role.padEnd(6)} | Plan: ${u.is_pro ? 'PRO' : 'FREE'}`);
    });
    console.log('==================================================\n');
    process.exit(0);

  } catch (error) {
    console.error(`\n[ERROR] Seeding process failed:`, error.message);
    process.exit(1);
  }
}

seedDatabase();
