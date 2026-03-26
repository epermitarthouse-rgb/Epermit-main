// API Documentation Data

export interface APIEndpoint {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  description: string;
  category: 'payments' | 'auth' | 'notifications' | 'integrations' | 'admin' | 'utilities';
  authRequired: boolean;
  requestBody?: {
    fields: {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[];
    example: object;
  };
  responseBody: {
    fields: {
      name: string;
      type: string;
      description: string;
    }[];
    example: object;
  };
  errorResponses?: {
    status: number;
    message: string;
  }[];
  notes?: string[];
}

export const apiEndpoints: APIEndpoint[] = [
  // PAYMENTS
  {
    name: 'Create Checkout Session',
    path: '/functions/v1/create-checkout',
    method: 'POST',
    description: 'Creates a Stripe checkout session for subscription purchase',
    category: 'payments',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'priceId', type: 'string', required: true, description: 'Stripe price ID for the subscription tier' }
      ],
      example: {
        priceId: 'price_1234567890'
      }
    },
    responseBody: {
      fields: [
        { name: 'url', type: 'string', description: 'Stripe checkout URL to redirect user' }
      ],
      example: {
        url: 'https://checkout.stripe.com/c/pay/cs_test_...'
      }
    },
    errorResponses: [
      { status: 401, message: 'User not authenticated or email not available' },
      { status: 500, message: 'Price ID is required' }
    ]
  },
  {
    name: 'Check Subscription',
    path: '/functions/v1/check-subscription',
    method: 'GET',
    description: 'Checks the current user\'s subscription status and tier',
    category: 'payments',
    authRequired: true,
    responseBody: {
      fields: [
        { name: 'subscribed', type: 'boolean', description: 'Whether user has active subscription' },
        { name: 'tier', type: 'string | null', description: 'Subscription tier (starter, professional, business, enterprise)' },
        { name: 'product_id', type: 'string | null', description: 'Stripe product ID' },
        { name: 'subscription_end', type: 'string | null', description: 'ISO date when subscription ends' }
      ],
      example: {
        subscribed: true,
        tier: 'professional',
        product_id: 'prod_TmYt1UZnVUsP2w',
        subscription_end: '2025-02-16T00:00:00.000Z'
      }
    },
    errorResponses: [
      { status: 401, message: 'No authorization header provided' },
      { status: 500, message: 'STRIPE_SECRET_KEY is not set' }
    ]
  },
  {
    name: 'Customer Portal',
    path: '/functions/v1/customer-portal',
    method: 'POST',
    description: 'Generates a Stripe customer portal link for subscription management',
    category: 'payments',
    authRequired: true,
    responseBody: {
      fields: [
        { name: 'url', type: 'string', description: 'Stripe customer portal URL' }
      ],
      example: {
        url: 'https://billing.stripe.com/p/session/...'
      }
    },
    errorResponses: [
      { status: 401, message: 'User not authenticated' },
      { status: 404, message: 'No Stripe customer found for user' }
    ]
  },
  {
    name: 'Stripe Webhook',
    path: '/functions/v1/stripe-webhook',
    method: 'POST',
    description: 'Handles Stripe webhook events for payment processing',
    category: 'payments',
    authRequired: false,
    requestBody: {
      fields: [
        { name: 'type', type: 'string', required: true, description: 'Stripe event type' },
        { name: 'data', type: 'object', required: true, description: 'Stripe event data' }
      ],
      example: {
        type: 'checkout.session.completed',
        data: { object: { customer: 'cus_xxx', subscription: 'sub_xxx' } }
      }
    },
    responseBody: {
      fields: [
        { name: 'received', type: 'boolean', description: 'Whether webhook was processed' }
      ],
      example: { received: true }
    },
    notes: ['Requires Stripe webhook signature verification', 'Called by Stripe, not frontend']
  },

  // E-PERMIT INTEGRATIONS
  {
    name: 'E-Permit Submit',
    path: '/functions/v1/epermit-submit',
    method: 'POST',
    description: 'Submits permit applications to e-permit systems (Accela/CityView)',
    category: 'integrations',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'action', type: 'string', required: true, description: 'Action: submit, check_status, get_submissions' },
        { name: 'projectId', type: 'string', required: true, description: 'Project UUID' },
        { name: 'system', type: 'string', required: true, description: 'E-permit system: accela or cityview' },
        { name: 'environment', type: 'string', required: true, description: 'Environment: sandbox or production' },
        { name: 'credentials', type: 'object', required: true, description: 'API credentials for the e-permit system' },
        { name: 'applicationData', type: 'object', required: true, description: 'Permit application data' }
      ],
      example: {
        action: 'submit',
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        system: 'accela',
        environment: 'sandbox',
        credentials: {
          clientId: 'xxx',
          clientSecret: 'xxx',
          agencyId: 'CITY',
          baseUrl: 'https://apis.accela.com'
        },
        applicationData: {
          permitType: 'Building/Residential/New',
          projectName: 'Smith Residence',
          address: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62701',
          description: 'New single family home',
          applicantName: 'John Smith',
          applicantEmail: 'john@example.com'
        }
      }
    },
    responseBody: {
      fields: [
        { name: 'success', type: 'boolean', description: 'Whether submission succeeded' },
        { name: 'system', type: 'string', description: 'E-permit system used' },
        { name: 'recordId', type: 'string', description: 'System record ID' },
        { name: 'trackingNumber', type: 'string', description: 'Permit tracking number' },
        { name: 'status', type: 'string', description: 'Current status' },
        { name: 'submissionId', type: 'string', description: 'Database submission ID' }
      ],
      example: {
        success: true,
        system: 'accela',
        recordId: 'REC-12345',
        trackingNumber: 'ACCELA-M1234567',
        status: 'submitted',
        submissionId: '123e4567-e89b-12d3-a456-426614174000'
      }
    }
  },
  {
    name: 'E-Permit Status Email',
    path: '/functions/v1/send-epermit-status-email',
    method: 'POST',
    description: 'Sends email notification when permit status changes',
    category: 'notifications',
    authRequired: false,
    requestBody: {
      fields: [
        { name: 'submissionId', type: 'string', required: true, description: 'Submission UUID' },
        { name: 'applicantEmail', type: 'string', required: true, description: 'Email recipient' },
        { name: 'applicantName', type: 'string', required: true, description: 'Recipient name' },
        { name: 'projectName', type: 'string', required: true, description: 'Project name' },
        { name: 'trackingNumber', type: 'string', required: true, description: 'Permit tracking number' },
        { name: 'oldStatus', type: 'string', required: true, description: 'Previous status' },
        { name: 'newStatus', type: 'string', required: true, description: 'New status' }
      ],
      example: {
        submissionId: '123e4567-e89b-12d3-a456-426614174000',
        applicantEmail: 'john@example.com',
        applicantName: 'John Smith',
        projectName: 'Smith Residence',
        trackingNumber: 'ACCELA-M1234567',
        oldStatus: 'submitted',
        newStatus: 'under_review'
      }
    },
    responseBody: {
      fields: [
        { name: 'success', type: 'boolean', description: 'Email sent successfully' }
      ],
      example: { success: true }
    }
  },

  // EXTERNAL APIS
  {
    name: 'Shovels API Proxy',
    path: '/functions/v1/shovels-api',
    method: 'POST',
    description: 'Proxies requests to the Shovels permit data API',
    category: 'integrations',
    authRequired: false,
    requestBody: {
      fields: [
        { name: 'endpoint', type: 'string', required: true, description: 'API endpoint: permits, contractors, or jurisdictions' },
        { name: 'params', type: 'object', required: true, description: 'Query parameters for the API' }
      ],
      example: {
        endpoint: 'permits',
        params: {
          state: 'CA',
          city: 'Los Angeles',
          permit_type: 'residential'
        }
      }
    },
    responseBody: {
      fields: [
        { name: 'items', type: 'array', description: 'Array of permit/contractor/jurisdiction records' },
        { name: 'total', type: 'number', description: 'Total number of results' }
      ],
      example: {
        items: [{ id: '123', address: '456 Oak St', permit_type: 'residential' }],
        total: 1
      }
    },
    errorResponses: [
      { status: 401, message: 'Invalid Shovels API key' },
      { status: 429, message: 'Rate limit exceeded' }
    ]
  },
  {
    name: 'Get Mapbox Token',
    path: '/functions/v1/get-mapbox-token',
    method: 'GET',
    description: 'Retrieves the Mapbox access token for map rendering',
    category: 'utilities',
    authRequired: false,
    responseBody: {
      fields: [
        { name: 'token', type: 'string', description: 'Mapbox public access token' }
      ],
      example: {
        token: 'pk.eyJ1IjoiZXhhbXBsZSIsImEiOiJjazE...'
      }
    }
  },

  // AI & ANALYSIS
  {
    name: 'Analyze Drawing',
    path: '/functions/v1/analyze-drawing',
    method: 'POST',
    description: 'AI-powered analysis of architectural drawings for compliance issues',
    category: 'integrations',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'imageUrl', type: 'string', required: true, description: 'URL of the drawing image to analyze' },
        { name: 'analysisType', type: 'string', required: false, description: 'Type of analysis to perform' }
      ],
      example: {
        imageUrl: 'https://storage.example.com/drawings/floor-plan.pdf',
        analysisType: 'compliance'
      }
    },
    responseBody: {
      fields: [
        { name: 'findings', type: 'array', description: 'List of compliance findings' },
        { name: 'summary', type: 'string', description: 'Analysis summary' }
      ],
      example: {
        findings: [{ issue: 'Egress width insufficient', severity: 'high', location: 'Main exit' }],
        summary: 'Found 3 potential compliance issues'
      }
    }
  },
  {
    name: 'ElevenLabs TTS',
    path: '/functions/v1/elevenlabs-tts',
    method: 'POST',
    description: 'Converts text to speech using ElevenLabs API',
    category: 'integrations',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'text', type: 'string', required: true, description: 'Text to convert to speech' },
        { name: 'voiceId', type: 'string', required: false, description: 'ElevenLabs voice ID' }
      ],
      example: {
        text: 'Your compliance report is ready.',
        voiceId: '21m00Tcm4TlvDq8ikWAM'
      }
    },
    responseBody: {
      fields: [
        { name: 'audioUrl', type: 'string', description: 'URL to the generated audio file' }
      ],
      example: {
        audioUrl: 'https://storage.example.com/audio/report-123.mp3'
      }
    }
  },

  // NOTIFICATIONS
  {
    name: 'Send Contact Email',
    path: '/functions/v1/send-contact-email',
    method: 'POST',
    description: 'Sends contact form submissions to the support team',
    category: 'notifications',
    authRequired: false,
    requestBody: {
      fields: [
        { name: 'name', type: 'string', required: true, description: 'Sender name' },
        { name: 'email', type: 'string', required: true, description: 'Sender email' },
        { name: 'message', type: 'string', required: true, description: 'Message content' },
        { name: 'company', type: 'string', required: false, description: 'Company name' }
      ],
      example: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        message: 'I would like to learn more about your enterprise plan.',
        company: 'Acme Construction'
      }
    },
    responseBody: {
      fields: [
        { name: 'success', type: 'boolean', description: 'Email sent successfully' }
      ],
      example: { success: true }
    }
  },
  {
    name: 'Send Welcome Email',
    path: '/functions/v1/send-welcome-email',
    method: 'POST',
    description: 'Sends welcome email to newly registered users',
    category: 'notifications',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'email', type: 'string', required: true, description: 'User email' },
        { name: 'name', type: 'string', required: true, description: 'User name' }
      ],
      example: {
        email: 'newuser@example.com',
        name: 'John Smith'
      }
    },
    responseBody: {
      fields: [
        { name: 'success', type: 'boolean', description: 'Email sent successfully' }
      ],
      example: { success: true }
    }
  },
  {
    name: 'Send Deadline Reminders',
    path: '/functions/v1/send-deadline-reminders',
    method: 'POST',
    description: 'Cron job that sends reminders for upcoming project deadlines',
    category: 'notifications',
    authRequired: false,
    responseBody: {
      fields: [
        { name: 'sent', type: 'number', description: 'Number of reminders sent' }
      ],
      example: { sent: 5 }
    },
    notes: ['Triggered by cron schedule', 'Sends reminders 3 days before deadline']
  },
  {
    name: 'Send Inspection Reminders',
    path: '/functions/v1/send-inspection-reminders',
    method: 'POST',
    description: 'Cron job that sends reminders for upcoming inspections',
    category: 'notifications',
    authRequired: false,
    responseBody: {
      fields: [
        { name: 'sent', type: 'number', description: 'Number of reminders sent' }
      ],
      example: { sent: 3 }
    },
    notes: ['Triggered by cron schedule', 'Sends reminders 1 day before inspection']
  },
  {
    name: 'Send Jurisdiction Notification',
    path: '/functions/v1/send-jurisdiction-notification',
    method: 'POST',
    description: 'Sends notifications to users subscribed to a jurisdiction',
    category: 'notifications',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'jurisdictionId', type: 'string', required: true, description: 'Jurisdiction UUID' },
        { name: 'title', type: 'string', required: true, description: 'Notification title' },
        { name: 'message', type: 'string', required: true, description: 'Notification message' },
        { name: 'sendEmail', type: 'boolean', required: false, description: 'Also send email notifications' }
      ],
      example: {
        jurisdictionId: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Fee Schedule Updated',
        message: 'Springfield has updated their permit fee schedule effective January 1.',
        sendEmail: true
      }
    },
    responseBody: {
      fields: [
        { name: 'notificationsSent', type: 'number', description: 'Number of notifications created' },
        { name: 'emailsSent', type: 'number', description: 'Number of emails sent' }
      ],
      example: { notificationsSent: 25, emailsSent: 25 }
    }
  },
  {
    name: 'Process Scheduled Notifications',
    path: '/functions/v1/process-scheduled-notifications',
    method: 'POST',
    description: 'Processes and sends scheduled notifications from the queue',
    category: 'notifications',
    authRequired: false,
    responseBody: {
      fields: [
        { name: 'processed', type: 'number', description: 'Number of notifications processed' }
      ],
      example: { processed: 10 }
    },
    notes: ['Triggered by cron schedule']
  },

  // ADMIN & MARKETING
  {
    name: 'Process Drip Emails',
    path: '/functions/v1/process-drip-emails',
    method: 'POST',
    description: 'Processes marketing drip campaign emails',
    category: 'admin',
    authRequired: false,
    responseBody: {
      fields: [
        { name: 'processed', type: 'number', description: 'Number of emails sent' }
      ],
      example: { processed: 15 }
    },
    notes: ['Triggered by cron schedule', 'Sends onboarding email sequences']
  },
  {
    name: 'Admin Drip Campaigns',
    path: '/functions/v1/admin-drip-campaigns',
    method: 'POST',
    description: 'Manages drip campaign settings and user enrollments',
    category: 'admin',
    authRequired: true,
    requestBody: {
      fields: [
        { name: 'action', type: 'string', required: true, description: 'Action: list, enroll, unenroll, update_settings' },
        { name: 'userId', type: 'string', required: false, description: 'User ID for enroll/unenroll actions' },
        { name: 'campaignType', type: 'string', required: false, description: 'Campaign type (onboarding, etc.)' }
      ],
      example: {
        action: 'enroll',
        userId: '123e4567-e89b-12d3-a456-426614174000',
        campaignType: 'onboarding'
      }
    },
    responseBody: {
      fields: [
        { name: 'success', type: 'boolean', description: 'Action completed successfully' }
      ],
      example: { success: true }
    }
  },

  // UTILITIES
  {
    name: 'Validate URL',
    path: '/functions/v1/validate-url',
    method: 'POST',
    description: 'Validates and checks URLs for availability',
    category: 'utilities',
    authRequired: false,
    requestBody: {
      fields: [
        { name: 'url', type: 'string', required: true, description: 'URL to validate' }
      ],
      example: {
        url: 'https://springfield.gov/permits'
      }
    },
    responseBody: {
      fields: [
        { name: 'valid', type: 'boolean', description: 'URL is valid format' },
        { name: 'reachable', type: 'boolean', description: 'URL is reachable' },
        { name: 'statusCode', type: 'number', description: 'HTTP status code if reachable' }
      ],
      example: {
        valid: true,
        reachable: true,
        statusCode: 200
      }
    }
  }
];

export const categoryLabels: Record<string, { label: string; description: string; color: string }> = {
  payments: { label: 'Payments & Billing', description: 'Stripe integration for subscriptions', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  auth: { label: 'Authentication', description: 'User authentication and authorization', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  notifications: { label: 'Notifications', description: 'Email and in-app notifications', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' },
  integrations: { label: 'External Integrations', description: 'Third-party API integrations', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' },
  admin: { label: 'Admin & Marketing', description: 'Administrative and marketing functions', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  utilities: { label: 'Utilities', description: 'Helper and utility functions', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300' },
};
