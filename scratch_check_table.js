require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkTable() {
  const tables = ['users', 'payments', 'flashcard_decks', 'flashcards', 'flashcard_reviews', 'folder_shares', 'document_comments', 'document_annotations', 'ai_usage_logs'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`Table ${t} check failed:`, error.message);
    } else {
      console.log(`Table ${t} exists. Number of rows queried (max 1):`, data.length);
    }
  }
}

checkTable();
