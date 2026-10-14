import crypto from 'crypto';

interface CloudinaryUploadResult {
  url: string;
  name: string;
  type: string;
  size: number;
  publicId?: string;
}

export async function uploadToCloudinary(
  base64Data: string,
  fileName: string,
  fileType: string,
  userId: string = 'user'
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary credentials missing: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET not set in environment."
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `strides_users/${userId}`;
  
  // Cloudinary signature calculation: SHA1 of sorted params + api_secret
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  // Ensure file data URI format
  let dataUri = base64Data;
  if (!dataUri.startsWith('data:')) {
    dataUri = `data:${fileType || 'application/octet-stream'};base64,${base64Data}`;
  }

  const formData = new URLSearchParams();
  formData.append('file', dataUri);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('folder', folder);
  formData.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
  console.log(`[Cloudinary] Uploading ${fileName} (${fileType}) to cloud '${cloudName}'...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Cloudinary] Upload failed with HTTP ${response.status}:`, errText);
    throw new Error(`Cloudinary upload failed: ${errText}`);
  }

  const result: any = await response.json();
  console.log(`[Cloudinary] Upload successful! Hosted URL: ${result.secure_url}, publicId: ${result.public_id}`);

  return {
    url: result.secure_url || result.url,
    name: fileName,
    type: fileType || result.format || 'application/octet-stream',
    size: result.bytes || 0,
    publicId: result.public_id
  };
}

export async function destroyFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'raw' | 'video' | 'auto' = 'image'
): Promise<boolean> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.warn("[Cloudinary] Credentials missing for destroy operation.");
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

  const formData = new URLSearchParams();
  formData.append('public_id', publicId);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);

  const typesToTry = resourceType === 'auto' ? ['image', 'raw', 'video'] : [resourceType, 'raw', 'image'];
  let destroyed = false;

  for (const type of typesToTry) {
    try {
      const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`;
      console.log(`[Cloudinary] Destroying asset ${publicId} (type: ${type})...`);
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const resJson: any = await response.json();
        if (resJson.result === 'ok' || resJson.result === 'not found') {
          console.log(`[Cloudinary] Asset ${publicId} destroyed or not found (${resJson.result}).`);
          destroyed = true;
          break;
        }
      }
    } catch (err) {
      console.warn(`[Cloudinary] Failed destroy attempt on ${type}:`, err);
    }
  }

  return destroyed;
}
