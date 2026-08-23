// Check actual Supabase table schemas
const url = 'https://omokgdblmnnvrpwvotjv.supabase.co/rest/v1/';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tb2tnZGJsbW5udnJwd3ZvdGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODA1NTgsImV4cCI6MjA5Nzc1NjU1OH0.q6852hJu5UNadZ9dLzsAHRxpNFrfu8VaCNJ08yZJse0';
const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

async function checkTable(table) {
  const res = await fetch(`${url}${table}?limit=1`, { headers });
  const data = await res.json();
  console.log(`\n=== ${table} ===`);
  if (Array.isArray(data) && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
    console.log('Sample:', JSON.stringify(data[0], null, 2));
  } else {
    console.log('Empty or error:', JSON.stringify(data));
  }
}

(async () => {
  await checkTable('subjects');
  await checkTable('grade_weights');
  await checkTable('teacher_subjects');
  await checkTable('teacher_student_links');
  await checkTable('students');
})();
