/**
 * Jurisdiction notification email helpers.
 */

export interface BrandingSettings {
  header_text: string;
  primary_color: string;
  footer_text: string;
  unsubscribe_text: string;
  logo_url: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
  header_text: "PermitPilot",
  primary_color: "#0f766e",
  footer_text: "© 2024 PermitPilot. All rights reserved.",
  unsubscribe_text: "Unsubscribe from these notifications",
  logo_url: null,
};

export function resolveNotificationsFromEmail(
  envFrom: string | undefined | null,
  displayName = "PermitPilot",
): string {
  const raw = (envFrom || "").trim();
  if (!raw) {
    return `${displayName} <notifications@localhost.invalid>`;
  }
  if (raw.includes("<") && raw.includes(">")) {
    return raw;
  }
  return `${displayName} <${raw}>`;
}

export function buildUnsubscribeUrl(appBaseUrl: string): string {
  const base = (appBaseUrl || "").replace(/\/$/, "");
  return `${base}/settings?tab=notifications&unsubscribe=jurisdiction-email`;
}

export function buildJurisdictionNotificationHtml(params: {
  branding: BrandingSettings;
  title: string;
  message: string;
  jurisdictionName: string;
  scheduled?: boolean;
  unsubscribeUrl: string;
}): string {
  const { branding, title, message, jurisdictionName, scheduled, unsubscribeUrl } = params;
  const logoHtml = branding.logo_url
    ? `<img src="${branding.logo_url}" alt="${branding.header_text}" style="max-height: 50px; margin-bottom: 10px;" />`
    : "";
  const prefix = scheduled ? "[Scheduled] " : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: ${branding.primary_color}; padding: 20px; text-align: center;">
        ${logoHtml}
        <h2 style="color: #ffffff; margin: 0;">${branding.header_text}</h2>
      </div>
      <div style="padding: 30px;">
        <p style="color: #666; font-size: 14px; margin-bottom: 10px;">${prefix}Jurisdiction Code Update Notification</p>
        <h1 style="color: #1a1a1a; margin-bottom: 15px;">${title}</h1>
        <div style="background-color: ${branding.primary_color}15; color: ${branding.primary_color}; padding: 8px 16px; border-radius: 20px; display: inline-block; font-size: 14px; font-weight: 500; margin-bottom: 20px;">
          ${jurisdictionName}
        </div>
        <div style="background-color: #f7fafc; border-left: 4px solid ${branding.primary_color}; padding: 15px; margin: 20px 0;">
          <p style="color: #4a5568; margin: 0; white-space: pre-wrap;">${message}</p>
        </div>
        <p style="color: #718096; font-size: 14px; margin-top: 30px;">
          You received this email because you subscribed to updates for ${jurisdictionName} on ${branding.header_text}.
        </p>
      </div>
      <div style="background-color: #f5f5f5; padding: 20px; text-align: center;">
        <p style="color: #666; font-size: 12px; margin: 0;">${branding.footer_text}</p>
        <p style="margin-top: 10px;">
          <a href="${unsubscribeUrl}" style="color: ${branding.primary_color}; font-size: 12px; text-decoration: none;">${branding.unsubscribe_text}</a>
        </p>
      </div>
    </div>
  `;
}
