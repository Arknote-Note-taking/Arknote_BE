require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('Initializing Supabase client with key starting with:', supabaseKey ? supabaseKey.substring(0, 15) : 'undefined');

module.exports = supabase;
