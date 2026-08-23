const supabaseUrl = 'https://omokgdblmnnvrpwvotjv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tb2tnZGJsbW5udnJwd3ZvdGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODA1NTgsImV4cCI6MjA5Nzc1NjU1OH0.q6852hJu5UNadZ9dLzsAHRxpNFrfu8VaCNJ08yZJse0';

async function checkPhotos() {
  console.log("🔍 Checking student photo_url values in Supabase...\n");
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/students?select=id,name_am,photo_url&order=created_at.desc&limit=20`,
      {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`
        }
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ Error:", data);
      return;
    }

    let withPhoto = 0, withoutPhoto = 0;
    for (const s of data) {
      if (s.photo_url) {
        withPhoto++;
        console.log(`✅ [HAS PHOTO] ${s.name_am} → ${s.photo_url.substring(0, 60)}...`);
      } else {
        withoutPhoto++;
        console.log(`❌ [NO PHOTO]  ${s.name_am} → null`);
      }
    }
    console.log(`\n📊 Summary: ${withPhoto} with photo, ${withoutPhoto} without photo (of last 20)`);
  } catch (e) {
    console.error("❌ Critical error:", e.message);
  }
}

checkPhotos();
