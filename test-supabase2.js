const url = 'https://omokgdblmnnvrpwvotjv.supabase.co/rest/v1/users?select=*';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tb2tnZGJsbW5udnJwd3ZvdGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODA1NTgsImV4cCI6MjA5Nzc1NjU1OH0.q6852hJu5UNadZ9dLzsAHRxpNFrfu8VaCNJ08yZJse0';

fetch(url, {
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`
  }
})
.then(res => res.json())
.then(data => {
  console.log("Users in Supabase:");
  data.forEach(u => {
    console.log(`- ${u.name} (Role: ${u.role}) | Phone: ${u.phone} | Active: ${u.is_active}`);
  });
})
.catch(err => console.error(err));
