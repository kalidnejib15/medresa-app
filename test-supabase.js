const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://omokgdblmnnvrpwvotjv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tb2tnZGJsbW5udnJwd3ZvdGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODA1NTgsImV4cCI6MjA5Nzc1NjU1OH0.q6852hJu5UNadZ9dLzsAHRxpNFrfu8VaCNJ08yZJse0';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data, error } = await supabase.from('users').select('*');
  if (error) console.error("Error:", error);
  else {
    console.log("Users in Supabase:");
    data.forEach(u => {
      console.log(`- ${u.name} (Role: ${u.role}) | Phone: ${u.phone} | Active: ${u.is_active}`);
    });
  }
}

check();
