require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkTable() {
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Table users fields:', Object.keys(data[0] || {}));
  }
}

checkTable();
