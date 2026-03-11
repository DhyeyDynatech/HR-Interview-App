/**
 * Client-side activity logging utility
 * Logs frontend actions to the database via API
 */

export interface FrontendActivityData {
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: Record<string, any> | null;
}

/**
 * Log a frontend action to the database
 * This is a fire-and-forget function that won't block the UI
 */
export async function logFrontendActivity(data: FrontendActivityData): Promise<void> {
  try {
    // Fire and forget - don't await to avoid blocking UI
    fetch("/api/log-activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }).catch((error) => {
      // Silently fail - logging should never break the app
      console.error("[Frontend Activity Log] Failed to log:", error);
    });
  } catch (error) {
    // Silently fail - logging should never break the app
    console.error("[Frontend Activity Log] Error:", error);
  }
}

/**
 * Log when edit button is clicked
 */
export function logEditClick(resourceType: string, resourceId: string | number, resourceData?: any): void {
  logFrontendActivity({
    action: `${resourceType}_edit_clicked`,
    resource_type: resourceType,
    resource_id: String(resourceId),
    details: {
      resource_id: resourceId,
      resource_data: resourceData ? {
        // Only include safe, non-sensitive data
        id: resourceData.id,
        email: resourceData.email,
        name: resourceData.first_name && resourceData.last_name 
          ? `${resourceData.first_name} ${resourceData.last_name}` 
          : null,
      } : null,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log when form is submitted
 */
export function logFormSubmit(resourceType: string, formData: any, mode: 'create' | 'edit'): void {
  logFrontendActivity({
    action: `${resourceType}_form_submitted`,
    resource_type: resourceType,
    resource_id: mode === 'edit' && formData.id ? String(formData.id) : null,
    details: {
      mode: mode,
      form_fields: Object.keys(formData),
      has_image: !!formData.avatar_url,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log when modal is opened
 */
export function logModalOpen(modalType: string, resourceType?: string, resourceId?: string | number): void {
  logFrontendActivity({
    action: `${modalType}_modal_opened`,
    resource_type: resourceType || null,
    resource_id: resourceId ? String(resourceId) : null,
    details: {
      modal_type: modalType,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log when modal is closed
 */
export function logModalClose(modalType: string, resourceType?: string, resourceId?: string | number): void {
  logFrontendActivity({
    action: `${modalType}_modal_closed`,
    resource_type: resourceType || null,
    resource_id: resourceId ? String(resourceId) : null,
    details: {
      modal_type: modalType,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log when delete button is clicked
 */
export function logDeleteClick(resourceType: string, resourceId: string | number, resourceData?: any): void {
  logFrontendActivity({
    action: `${resourceType}_delete_clicked`,
    resource_type: resourceType,
    resource_id: String(resourceId),
    details: {
      resource_id: resourceId,
      resource_name: resourceData?.name || resourceData?.email || null,
      timestamp: new Date().toISOString(),
    },
  });
}

