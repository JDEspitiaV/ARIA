/**
 * Google Picker API Integration for STRIDES / ARIA
 * Follows exact client-side PickerBuilder specifications from workspace_integration skill.
 * DO NOT USE developer key.
 */

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

export interface GoogleDriveSelectedFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  iconUrl?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  description?: string;
}

let isPickerLibraryLoaded = false;
let loadPromise: Promise<void> | null = null;

/**
 * Ensures https://apis.google.com/js/api.js is loaded and gapi.load('picker') has initialized.
 */
export function ensureGooglePickerLoaded(): Promise<void> {
  if (isPickerLibraryLoaded && typeof window !== 'undefined' && window.google?.picker) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window environment required for Google Picker'));
    }

    const initPicker = () => {
      if (window.gapi) {
        window.gapi.load('picker', {
          callback: () => {
            isPickerLibraryLoaded = true;
            resolve();
          },
          onerror: () => {
            reject(new Error('Failed to load Google Picker module via gapi.load'));
          }
        });
      } else {
        reject(new Error('gapi object not found after script load'));
      }
    };

    if (window.gapi) {
      initPicker();
      return;
    }

    // Check if script tag is already in DOM
    const existingScript = document.querySelector('script[src*="apis.google.com/js/api.js"]') as HTMLScriptElement | null;
    if (existingScript) {
      if (window.gapi) {
        initPicker();
      } else {
        existingScript.addEventListener('load', initPicker);
        existingScript.addEventListener('error', () => reject(new Error('Failed loading apis.google.com/js/api.js')));
      }
      return;
    }

    // Inject script
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = initPicker;
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export interface ShowPickerOptions {
  accessToken: string;
  onPick: (files: GoogleDriveSelectedFile[]) => void;
  onCancel?: () => void;
  multiselect?: boolean;
}

/**
 * Creates and displays Google Drive Picker using the client-side PickerBuilder.
 * Complies with ancestorOrigins iframe origin detection for AI Studio environment.
 */
export async function showGoogleDrivePicker(options: ShowPickerOptions): Promise<void> {
  await ensureGooglePickerLoaded();

  if (!window.google?.picker) {
    throw new Error('Google Picker library is not ready');
  }

  const pickerOrigin =
    typeof window !== 'undefined' &&
    window.location.ancestorOrigins &&
    window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
      : window.location.origin;

  // View configuration for Docs/Drive documents
  const docsView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS);
  docsView.setIncludeFolders(true);

  // DocsUploadView allows user to upload files into Drive directly from the picker
  const uploadView = new window.google.picker.DocsUploadView();

  const builder = new window.google.picker.PickerBuilder()
    .addView(docsView)
    .addView(uploadView)
    .setOAuthToken(options.accessToken)
    .setOrigin(pickerOrigin)
    .setCallback((data: any) => {
      const action = data[window.google.picker.Response.ACTION] || data.action;
      if (action === window.google.picker.Action.PICKED) {
        const rawDocs = data[window.google.picker.Response.DOCUMENTS] || data.docs || [];
        const files: GoogleDriveSelectedFile[] = rawDocs.map((doc: any) => {
          const id = doc[window.google.picker.Document.ID] || doc.id || '';
          const name = doc[window.google.picker.Document.NAME] || doc.name || 'Google Drive File';
          const url = doc[window.google.picker.Document.URL] || doc.url || `https://drive.google.com/file/d/${id}/view`;
          const mimeType = doc[window.google.picker.Document.MIME_TYPE] || doc.mimeType || doc.type || 'application/octet-stream';
          const iconUrl = doc[window.google.picker.Document.ICON_URL] || doc.iconUrl;

          // Thumbnail extraction
          let thumbnailUrl = doc[window.google.picker.Document.THUMBNAILS]?.[0]?.url || doc.thumbnailUrl || doc.thumbnails?.[0]?.url;
          if (!thumbnailUrl && id) {
            thumbnailUrl = `https://drive.google.com/thumbnail?id=${id}&sz=w400`;
          }

          const sizeBytes = doc.sizeBytes || doc[window.google.picker.Document.SIZE_BYTES];
          const embedUrl = doc[window.google.picker.Document.EMBEDDABLE_URL] || doc.embedUrl;
          const description = doc[window.google.picker.Document.DESCRIPTION] || doc.description;

          return {
            id,
            name,
            url,
            mimeType,
            sizeBytes,
            iconUrl,
            thumbnailUrl,
            embedUrl,
            description
          };
        });

        options.onPick(files);
      } else if (action === window.google.picker.Action.CANCEL) {
        if (options.onCancel) {
          options.onCancel();
        }
      }
    });

  if (options.multiselect !== false) {
    builder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
  }

  const picker = builder.build();
  picker.setVisible(true);
}
