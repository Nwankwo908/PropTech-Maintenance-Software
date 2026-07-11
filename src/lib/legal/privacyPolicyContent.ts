import type { LegalSection } from '@/lib/legal/termsOfServiceContent'

export const PRIVACY_POLICY_PATH = '/privatepolicy' as const

export const PRIVACY_POLICY_META = {
  title: 'Privacy Policy',
  subtitle: 'How Ulo Home collects, uses, and protects your information',
  effectiveDate: 'July 3, 2026',
  version: '1.2',
  company: 'Ulo Home, Inc.',
} as const

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    id: 'introduction',
    title: '1. Introduction',
    blocks: [
      {
        type: 'paragraph',
        text: 'Ulo Home, Inc. ("Ulo," "we," "us," or "our") is committed to protecting the privacy of our users. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the Ulo platform ("Service"), including our website, SMS intake system, mobile applications, and all associated services. It applies to all users: Landlords, Tenants, and Vendors.',
      },
    ],
  },
  {
    id: 'information-we-collect',
    title: '2. Information We Collect',
    blocks: [
      {
        type: 'list',
        items: [
          'Account Information: Name, email address, phone number, and account credentials.',
          'Property Information: Property addresses, unit details, and occupancy status.',
          'Service Request Content: Maintenance descriptions, photographs, and notes submitted via SMS or the Platform.',
          'Financial Information: Subscription billing details, payment records, and connected payment account information. Payment processing is handled by Stripe and Stripe Connect.',
          'Vendor Information: Vendor contact details, trade categories, service areas, professional licenses, certificates of insurance, background check consent and results, and job activity.',
          'Documents: Uploaded files such as leases, inspection reports, receipts, maintenance photographs, and insurance documents.',
          'Communications: Messages sent through the Platform, including SMS exchanges, maintenance request descriptions, vendor coordination notes, and support messages.',
          'Usage Data: Pages visited, features used, session timestamps, browser type, operating system, and IP address.',
          'SMS Metadata: Message timestamps, delivery status, and routing information. Approximate location is inferred from IP address; precise location is only collected if you grant explicit permission.',
          'Cookies and Preferences: Session cookies for authentication and display preferences. See Section 9 for details.',
        ],
      },
    ],
  },
  {
    id: 'how-we-use',
    title: '3. How We Use Your Information',
    blocks: [
      {
        type: 'paragraph',
        text: 'We use collected information to provide and maintain the Service; process and coordinate maintenance requests and vendor jobs; facilitate communication between Landlords, Tenants, and Vendors; verify Vendor credentials, insurance status, and licensing; process payments and maintain billing records; build and maintain the Home Data Graph for property maintenance intelligence; send transactional SMS messages and email notifications; detect and prevent fraud or abuse; comply with legal obligations and enforce our Terms of Service; and generate anonymized, aggregated analytics for product development and research.',
      },
    ],
  },
  {
    id: 'sms-communications',
    title: '4. SMS Communications and Mobile Data',
    blocks: [
      {
        type: 'paragraph',
        text: 'When you provide your mobile phone number or submit a service request via SMS, you consent to receive automated text messages from Ulo related to your account and service requests, including job confirmations, scheduling notifications, vendor coordination messages, and platform alerts. Consent to receive SMS messages is not a condition of using our Service. Standard message and data rates may apply. Reply STOP to opt out; reply HELP for assistance.',
      },
      {
        type: 'paragraph',
        text: 'Your mobile phone number and SMS opt-in consent will not be sold or shared with third parties for promotional or marketing purposes.',
      },
      {
        type: 'paragraph',
        text: 'All categories of personal data described in this Privacy Policy exclude text messaging originator opt-in data and consent. This information will not be shared with any third parties for purposes unrelated to providing you with the services of that SMS campaign. We will not share your opt-in to an SMS campaign with any third party for purposes unrelated to providing you with the services of that campaign. We may share your personal data, including your SMS opt-in or consent status, with third parties that help us provide our messaging services, including but not limited to platform providers, phone companies, and any other vendors who assist us in the delivery of text messages. This prohibition covers all methods of transfer, including sale, sharing, exchange, transfer between affiliates, or disclosure to business partners for any purpose outside the scope of delivering your requested SMS communications.',
      },
      {
        type: 'paragraph',
        text: 'Transactional messages directly related to an active service request cannot be opted out of while that request is pending, as they are necessary to coordinate your requested service. After opting out of non-transactional messages, you will receive a single confirmation and no further messages. To re-enroll, reply START or contact info@ulohome.io.',
      },
      {
        type: 'paragraph',
        text: 'If you are a Tenant submitting a maintenance request via SMS for the first time, you will receive a consent confirmation before any data is processed and must reply YES before Ulo processes your request.',
      },
    ],
  },
  {
    id: 'ai-data-processing',
    title: '5. AI Data Processing',
    blocks: [
      {
        type: 'paragraph',
        text: "Ulo uses OpenAI's API to power automated maintenance request classification, message generation, and certificate of insurance parsing. Your submitted content is sent to OpenAI solely to generate responses and perform document analysis within the Service. Zero-data-retention is configured for all production API calls, meaning OpenAI does not retain or use Ulo's production data to train its models. Please refer to OpenAI's privacy policy for information about their data handling practices.",
      },
    ],
  },
  {
    id: 'data-sharing',
    title: '6. Data Sharing',
    blocks: [
      {
        type: 'paragraph',
        text: 'We do not sell your personal information. We may share your data with service providers that help us operate the platform, including Twilio for SMS delivery, Stripe and Stripe Connect for payments and Vendor payouts, Supabase for database hosting, OpenAI for request classification and document analysis, Checkr for Vendor background screening, StateLicense.io for license verification, and Certificial for certificate of insurance verification. All providers are contractually bound to process data only as directed by Ulo.',
      },
      {
        type: 'paragraph',
        text: 'Within the Platform, Tenants can see their own data and property-related information shared by their Landlord. Vendors receive job-specific information necessary to perform requested services. Ulo does not share full contact information between users beyond what is required for job coordination.',
      },
      {
        type: 'paragraph',
        text: 'We may also disclose information when required by law, subpoena, court order, or to protect the safety of any person or the integrity of the Platform. In connection with a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity, and you will be notified prior to any such transfer.',
      },
    ],
  },
  {
    id: 'data-security',
    title: '7. Data Security',
    blocks: [
      {
        type: 'paragraph',
        text: 'We implement industry-standard security measures to protect your information, including encryption of data at rest (AES-256) and in transit (TLS 1.2 minimum), row-level security controls on database access, multi-factor authentication requirements for all system access, and regular security reviews. No method of electronic storage or transmission is 100% secure. In the event of a data breach affecting your personal information, we will notify you as required by applicable law.',
      },
    ],
  },
  {
    id: 'data-retention',
    title: '8. Data Retention',
    blocks: [
      {
        type: 'paragraph',
        text: 'We retain your data for as long as your account is active or as needed to provide the Service. Vendor credentialing records are retained for three years following account termination. SMS consent records are retained indefinitely as required for regulatory compliance. Payment records are retained for seven years as required by applicable law. When you close your account, we will delete or anonymize your personal data within a commercially reasonable period, except where retention is required by law, payment reconciliation, dispute resolution, or fraud prevention.',
      },
    ],
  },
  {
    id: 'cookies',
    title: '9. Cookies',
    blocks: [
      {
        type: 'paragraph',
        text: 'We use strictly necessary cookies (required for Platform function), functional cookies (preferences and settings), and analytics cookies (aggregated usage data). We do not use advertising or retargeting cookies. On your first visit, a consent banner will allow you to accept or decline non-essential cookies. You may update your preferences at any time via the cookie settings link in our website footer.',
      },
    ],
  },
  {
    id: 'your-rights',
    title: '10. Your Rights',
    blocks: [
      {
        type: 'paragraph',
        text: 'Depending on your jurisdiction, you may have the right to access and receive a copy of your personal data; correct inaccurate personal data; request deletion of your personal data; object to or restrict processing; and receive your data in a portable format.',
      },
      {
        type: 'paragraph',
        text: 'California residents have additional rights under the CCPA/CPRA, including the right to opt out of the sale or sharing of personal information (Ulo does not sell personal information), the right to limit use of sensitive personal information, and the right to non-discrimination for exercising these rights. The Do Not Sell or Share option is available at /privatepolicy#opt-out.',
      },
      {
        type: 'paragraph',
        text: 'New Jersey residents have rights under the New Jersey Data Privacy Act (effective January 15, 2025), including rights to access, correct, delete, and opt out of processing for targeted advertising. Residents of Colorado, Connecticut, Virginia, Texas, Montana, Oregon, and other states with active comprehensive privacy laws have similar rights. To exercise any of these rights, contact us at info@ulohome.io.',
      },
    ],
  },
  {
    id: 'childrens-privacy',
    title: "11. Children's Privacy",
    blocks: [
      {
        type: 'paragraph',
        text: 'The Service is not intended for individuals under the age of 18. We do not knowingly collect personal information from minors. If you believe we have collected information from a minor, contact us at info@ulohome.io and we will delete it promptly.',
      },
    ],
  },
  {
    id: 'changes',
    title: '12. Changes to This Policy',
    blocks: [
      {
        type: 'paragraph',
        text: 'We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on our website and, where appropriate, sending an email notification at least 30 days before changes take effect. Your continued use of the Service after changes are posted constitutes acceptance of the revised policy. All previous versions are archived at ulohome.com/privacy/versions.',
      },
    ],
  },
  {
    id: 'contact',
    title: '13. Contact Us',
    blocks: [
      {
        type: 'paragraph',
        text: 'If you have questions about this Privacy Policy or wish to exercise your privacy rights, please contact Ulo Home, Inc. at info@ulohome.io.',
      },
    ],
  },
]
