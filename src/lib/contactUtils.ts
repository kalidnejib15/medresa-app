// 🛡️ Registration (app/(admin)/students/add.tsx) stores the emergency contact as a
// single combined string: `${name}: ${phone}` (e.g. "Fatuma Ahmed: 0911223344"). This
// pulls the phone portion back out so it can be used as a fallback call number anywhere
// parent_phone is missing — finance's defaulters call list, the Fees screen, and the
// student detail page all show a "Contact" number that staff actually dial, and none of
// them should ever show "N/A" if a usable number was recorded at registration.
export function extractEmergencyPhone(emergencyContact?: string | null): string {
  if (!emergencyContact) return '';
  // Phone is everything after the LAST colon (name may itself contain one, unlikely
  // but harmless either way), then keep only digits/+ so stray spaces don't matter.
  const afterColon = emergencyContact.includes(':')
    ? emergencyContact.split(':').pop() || ''
    : emergencyContact;
  const digits = afterColon.replace(/[^\d+]/g, '');
  return digits.length >= 7 ? digits : ''; // guard against picking up junk/name text
}

// Resolves the number staff should actually call: the parent's phone if one was
// recorded, otherwise the phone half of the emergency contact from registration.
export function getFallbackPhone(parentPhone?: string | null, emergencyContact?: string | null): string {
  const primary = (parentPhone || '').trim();
  if (primary) return primary;
  return extractEmergencyPhone(emergencyContact);
}
