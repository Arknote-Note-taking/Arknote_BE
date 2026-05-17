require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkTable() {
  const { data, error } = await supabase.from('password_resets').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Table password_resets exists:', data);
  }
}

checkTable();
