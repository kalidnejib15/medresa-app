/**
 * 🛡️ Medresa Cloudinary Image Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional utility for handling high-definition student photo uploads
 * to your Cloudinary 'die8ukixs' product environment.
 */

const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/die8ukixs/image/upload';
const UPLOAD_PRESET = 'medresa-app';

/**
 * Uploads an image file to Cloudinary and returns the hosted URL.
 * @param imageUri The local URI of the image (from expo-image-picker)
 * @returns Promise with the secure_url or null on failure
 */
export async function uploadToCloudinary(imageUri: string): Promise<string | null> {
  try {
    const formData = new FormData();
    
    // 🛡️ Format the file for high-speed multi-part upload
    const filename = imageUri.split('/').pop();
    const match = /\.(\w+)$/.exec(filename || '');
    const type = match ? `image/${match[1]}` : `image`;

    formData.append('file', {
      uri: imageUri,
      name: filename,
      type,
    } as any);
    
    formData.append('upload_preset', UPLOAD_PRESET);

    const response = await fetch(CLOUDINARY_URL, {
      method: 'POST',
      body: formData,
      // 🛡️ CRITICAL: Do NOT set Content-Type manually for FormData in React Native.
      // The fetch runtime auto-sets 'multipart/form-data; boundary=...' with the
      // correct boundary string. Overriding it strips the boundary and breaks the upload.
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (data.secure_url) {
      console.log('🛡️ Cloudinary Upload Success:', data.secure_url);
      return data.secure_url;
    } else {
      console.error('🛡️ Cloudinary Upload Failed:', data.error?.message || 'Unknown error');
      return null;
    }
  } catch (error) {
    console.error('🛡️ Cloudinary Engine Critical Error:', error);
    return null;
  }
}
