export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export function uploadVideoXHR(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    
    xhr.open('PUT', signedUrl, true);
    // Supabase storage signed uploads don't need additional headers aside from Content-Type
    // But setting Content-Type might break pre-signed URL signature if not matched,
    // although standard Supabase PUT doesn't strictly enforce it unless explicitly signed.
    xhr.setRequestHeader('Content-Type', file.type);
    
    xhr.send(file);
  });
}
