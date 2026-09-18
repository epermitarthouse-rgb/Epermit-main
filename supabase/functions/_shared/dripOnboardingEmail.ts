import {
  DEFAULT_BRANDING,
  type BrandingSettings,
  resolveNotificationsFromEmail,
} from "./jurisdictionNotificationEmail.ts";

export interface DripEmailTemplate {
  day: number;
  subject: string;
  getBodyHtml: (name: string) => string;
}

export function resolveDripFromEmail(brandingHeader = "PermitPilot"): string {
  const envFrom =
    Deno.env.get("DRIP_FROM_EMAIL")?.trim() ||
    Deno.env.get("RESEND_FROM_EMAIL")?.trim() ||
    "";
  return resolveNotificationsFromEmail(envFrom || null, brandingHeader);
}

export function wrapDripEmailHtml(params: {
  branding: BrandingSettings;
  bodyHtml: string;
}): string {
  const { branding, bodyHtml } = params;
  const logoHtml = branding.logo_url
    ? `<img src="${branding.logo_url}" alt="${branding.header_text}" style="max-height: 50px; margin-bottom: 10px;" />`
    : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: ${branding.primary_color}; padding: 20px; text-align: center;">
        ${logoHtml}
        <h2 style="color: #ffffff; margin: 0;">${branding.header_text}</h2>
      </div>
      <div style="padding: 30px;">
        ${bodyHtml}
      </div>
      <div style="background-color: #f5f5f5; padding: 20px; text-align: center;">
        <p style="color: #666; font-size: 12px; margin: 0;">${branding.footer_text}</p>
      </div>
    </div>
  `;
}

export const ONBOARDING_DRIP_TEMPLATES: DripEmailTemplate[] = [
  {
    day: 1,
    subject: "Day 1: Set Up Your First Project",
    getBodyHtml: (name) => `
      <h1 style="color: #1a1a2e; margin-bottom: 24px;">Hey ${name}! 👋</h1>
      <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
        Welcome to Day 1 of your PermitPilot onboarding! Let's make sure you're set up for success.
      </p>
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Tip: Create Your First Project</h2>
        <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
          Head to the Dashboard and click "New Project" to get started. Fill in your project details,
          and our AI will automatically identify the jurisdiction and estimate review timelines.
        </p>
      </div>
      <h3 style="color: #1a1a2e; margin-top: 32px;">Quick Start Checklist:</h3>
      <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
        <li>Complete your profile with company details</li>
        <li>Upload your first set of permit drawings</li>
        <li>Enable notifications for deadline reminders</li>
      </ul>
      <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin-top: 24px;">
        Need help? Just reply to this email — we're here for you!
      </p>
      <p style="color: #888; font-size: 14px; margin-top: 32px;">
        Happy permitting!<br>
        The PermitPilot Team
      </p>
    `,
  },
  {
    day: 3,
    subject: "Day 3: Unlock Jurisdiction Intelligence",
    getBodyHtml: (name) => `
      <h1 style="color: #1a1a2e; margin-bottom: 24px;">Making Progress, ${name}! 🚀</h1>
      <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
        You're 3 days in! Today, let's explore one of our most powerful features.
      </p>
      <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Feature: Jurisdiction Intelligence</h2>
        <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
          Use our Jurisdiction Map to explore permit requirements across different cities.
          Compare SLA times, fees, and submission methods to plan your projects strategically.
        </p>
      </div>
      <h3 style="color: #1a1a2e; margin-top: 32px;">Did You Know?</h3>
      <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
        <li>Subscribe to jurisdictions to get update notifications</li>
        <li>Some jurisdictions offer expedited review for additional fees</li>
        <li>Compare up to 3 jurisdictions side-by-side</li>
      </ul>
      <p style="color: #888; font-size: 14px; margin-top: 32px;">
        Keep building!<br>
        The PermitPilot Team
      </p>
    `,
  },
  {
    day: 5,
    subject: "Day 5: Master Your Analytics Dashboard",
    getBodyHtml: (name) => `
      <h1 style="color: #1a1a2e; margin-bottom: 24px;">Halfway There, ${name}! 📊</h1>
      <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
        You're getting the hang of things! Let's dive into analytics to optimize your workflow.
      </p>
      <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Today's Power Move: Analytics Dashboard</h2>
        <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
          Track cycle times, monitor costs, and identify bottlenecks across all your projects.
          Use data to negotiate better with contractors and set realistic client expectations.
        </p>
      </div>
      <h3 style="color: #1a1a2e; margin-top: 32px;">Analytics Highlights:</h3>
      <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
        <li>Track average review times by jurisdiction</li>
        <li>Monitor permit fees and expeditor costs</li>
        <li>Analyze rejection trends to improve first-time approvals</li>
        <li>Export reports for stakeholder presentations</li>
      </ul>
      <p style="color: #888; font-size: 14px; margin-top: 32px;">
        You're crushing it!<br>
        The PermitPilot Team
      </p>
    `,
  },
  {
    day: 7,
    subject: "Day 7: You're a Permit Pro Now!",
    getBodyHtml: (name) => `
      <h1 style="color: #1a1a2e; margin-bottom: 24px;">Congratulations, ${name}! 🎉</h1>
      <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6;">
        You've completed your first week with PermitPilot! Here's a recap of everything you've learned.
      </p>
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 20px;">Your Week in Review</h2>
        <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 15px; line-height: 1.6;">
          You've learned about project management, jurisdiction intelligence, and analytics.
          Now you're ready to streamline every permit in your pipeline!
        </p>
      </div>
      <h3 style="color: #1a1a2e; margin-top: 32px;">What's Next?</h3>
      <ul style="color: #4a4a4a; font-size: 15px; line-height: 1.8;">
        <li>Invite team members to collaborate</li>
        <li>Try our mobile-friendly interface on the go</li>
        <li>Explore AI-powered form autofill features</li>
        <li>Share your feedback to help us improve</li>
      </ul>
      <p style="color: #888; font-size: 14px; margin-top: 32px;">
        Here's to faster permits!<br>
        The PermitPilot Team
      </p>
    `,
  },
];

export { DEFAULT_BRANDING, type BrandingSettings };
