export type LegalBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'caps'; text: string }

export type LegalSection = {
  id: string
  title: string
  blocks: LegalBlock[]
  subsections?: { id: string; title: string; blocks: LegalBlock[] }[]
}

export const TERMS_OF_SERVICE_META = {
  title: 'Terms of Service',
  subtitle: 'Technology Platform & Marketplace Facilitator Agreement — National',
  effectiveDate: 'July 3, 2026',
  version: '1.2',
  company: 'Ulo Home, Inc.',
} as const

/** Anchor id for Privacy Policy references within the Terms page (Section 12.1). */
export const TERMS_PRIVACY_SECTION_ID = '12-1'
export const TERMS_PRIVACY_SECTION_PATH = `/terms#${TERMS_PRIVACY_SECTION_ID}` as const

export const TERMS_OF_SERVICE_PREAMBLE: LegalBlock[] = [
  {
    type: 'paragraph',
    text: 'These Terms of Service ("Terms") govern your access to and use of the Ulo Home platform, including its web-based interface, SMS communication system, mobile applications, and associated services (collectively, the "Platform") operated by Ulo Home, Inc., a Delaware corporation ("Ulo," "we," "us," or "our").',
  },
  {
    type: 'paragraph',
    text: 'By accessing the Platform, creating an account, or submitting or responding to any service request, you agree to be bound by these Terms and our Privacy Policy. If you do not agree, do not use the Platform.',
  },
  {
    type: 'paragraph',
    text: 'These Terms apply to users in all fifty U.S. states and U.S. territories. Where applicable law in your state provides rights that may not be contractually waived, those rights are preserved.',
  },
]

export const TERMS_OF_SERVICE_SECTIONS: LegalSection[] = [
  {
    id: 'platform-nature',
    title: '1. Platform Nature and Facilitator Status',
    blocks: [],
    subsections: [
      {
        id: '1-1',
        title: '1.1 Ulo is a Technology Facilitator',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo operates a technology platform connecting property owners and managers ("Landlords") with independent service professionals ("Vendors") to coordinate property maintenance and repair. Ulo does not itself perform maintenance, repair, or property management services of any kind.',
          },
          {
            type: 'caps',
            text: 'ULO IS NOT A CONTRACTOR, GENERAL CONTRACTOR, SUBCONTRACTOR, EMPLOYER, STAFFING AGENCY, EMPLOYMENT AGENCY, PROFESSIONAL EMPLOYER ORGANIZATION, OR LABOR BROKER. Ulo does not direct, supervise, or control Vendors\' means or methods of performing services.',
          },
        ],
      },
      {
        id: '1-2',
        title: '1.2 Independent Vendor Status',
        blocks: [
          {
            type: 'paragraph',
            text: 'Vendors are independent contractors. They are not employees, agents, joint venturers, or representatives of Ulo in any jurisdiction. Ulo does not withhold taxes, provide benefits, furnish equipment, or exercise control over how Vendors perform services. Vendor classification is governed by the laws of each jurisdiction where services are performed.',
          },
        ],
      },
      {
        id: '1-3',
        title: '1.3 No Employment or Agency Relationship',
        blocks: [
          {
            type: 'paragraph',
            text: 'Nothing in these Terms creates an employment relationship, joint venture, partnership, agency, or franchise between Ulo and any user. Ulo expressly disclaims any such relationship.',
          },
        ],
      },
      {
        id: '1-4',
        title: '1.4 Automated Communications',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo\'s platform includes automated SMS routing, classification, and coordination functionality. Automated messages constitute platform communications only and do not constitute advice, warranty, or guarantee of any service outcome.',
          },
        ],
      },
    ],
  },
  {
    id: 'definitions',
    title: '2. Definitions',
    blocks: [
      {
        type: 'list',
        items: [
          '"Platform" — The Ulo Home technology platform including web interfaces, SMS intake system, mobile applications, and all associated tools.',
          '"Landlord" — Any property owner, property manager, or authorized agent registered to use the Platform.',
          '"Tenant" — Any individual submitting a maintenance request via the Platform on behalf of or at the direction of a Landlord.',
          '"Vendor" — Any independent service professional registered on the Platform to fulfill service requests.',
          '"Ulo Verified Vendor" — A Vendor who has completed full vetting: license verification, COI confirmation, and background screening.',
          '"Landlord Preferred Vendor" — A Vendor nominated by a Landlord who has completed Ulo\'s lighter vetting process.',
          '"Job" — A discrete service request submitted, matched, and tracked through the Platform.',
          '"COI" — Certificate of Insurance evidencing commercial general liability coverage.',
          '"Home Data Graph" — Ulo\'s proprietary property maintenance data system.',
          '"Applicable Law" — All federal, state, and local laws applicable to a user\'s location and activities on the Platform.',
        ],
      },
    ],
  },
  {
    id: 'eligibility',
    title: '3. Eligibility and Registration',
    blocks: [],
    subsections: [
      {
        id: '3-1',
        title: '3.1 Eligibility',
        blocks: [
          {
            type: 'paragraph',
            text: 'You must be at least 18 years of age and legally authorized to enter contracts in your jurisdiction. Landlords must hold any property management license required by their state or locality.',
          },
        ],
      },
      {
        id: '3-2',
        title: '3.2 Account Accuracy',
        blocks: [
          {
            type: 'paragraph',
            text: 'You agree to provide and maintain accurate, current, and complete registration information. Ulo may suspend accounts containing inaccurate or misleading information.',
          },
        ],
      },
      {
        id: '3-3',
        title: '3.3 Account Security',
        blocks: [
          {
            type: 'paragraph',
            text: 'You are responsible for all account activity. Notify Ulo immediately at support@ulohome.com of any unauthorized access.',
          },
        ],
      },
    ],
  },
  {
    id: 'landlord-terms',
    title: '4. Landlord Terms',
    blocks: [],
    subsections: [
      {
        id: '4-1',
        title: '4.1 Service Requests and Approval Authority',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords may submit service requests directly or enable Tenants to submit via SMS intake. Landlords retain sole authority to approve or reject any Job assignment prior to work commencement.',
          },
        ],
      },
      {
        id: '4-2',
        title: '4.2 Property Access and Legal Authority',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords represent they have lawful authority to manage the properties and grant Vendor access for services. Landlords are responsible for coordinating access with Tenants in compliance with applicable landlord-tenant law.',
          },
        ],
      },
      {
        id: '4-3',
        title: '4.3 Landlord Compliance Obligations',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords are solely responsible for compliance with all applicable landlord-tenant statutes, habitability requirements, fair housing laws, disclosure obligations to Tenants regarding third-party platform use, and permit requirements for regulated work.',
          },
        ],
      },
      {
        id: '4-4',
        title: '4.4 Subscription Fees and Billing',
        blocks: [
          {
            type: 'paragraph',
            text: 'Paid features are subject to fees in Ulo\'s then-current pricing schedule. Fees are billed monthly in advance. Auto-renewal disclosures required by applicable state law are provided at checkout. Ulo will give 30 days\' notice of fee changes.',
          },
        ],
      },
    ],
  },
  {
    id: 'vendor-terms',
    title: '5. Vendor Terms',
    blocks: [],
    subsections: [
      {
        id: '5-1',
        title: '5.1 Independent Contractor Acknowledgment',
        blocks: [
          {
            type: 'paragraph',
            text: 'Vendors acknowledge they are independent contractors in all jurisdictions where they operate. Vendors are solely responsible for taxes, insurance, licensing, benefits, and Applicable Law compliance.',
          },
        ],
      },
      {
        id: '5-2',
        title: '5.2 Mandatory Insurance',
        blocks: [
          {
            type: 'paragraph',
            text: 'All Vendors must maintain commercial general liability insurance: $1,000,000 per occurrence / $2,000,000 aggregate minimum. Prior to any Job assignment, Vendors must:',
          },
          {
            type: 'list',
            items: [
              'Upload a valid, current COI to the Platform.',
              'List Ulo Home, Inc. as Additional Insured on their policy.',
              'Maintain continuous coverage and notify Ulo immediately of any lapse or cancellation.',
            ],
          },
        ],
      },
      {
        id: '5-3',
        title: '5.3 Licensing Requirements',
        blocks: [
          {
            type: 'paragraph',
            text: 'Vendors must hold and maintain in good standing all licenses required by Applicable Law in each jurisdiction where they perform services. False representations are grounds for permanent removal.',
          },
        ],
      },
      {
        id: '5-4',
        title: '5.4 Background Screening',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo Verified Vendors must consent to background screening via Ulo\'s designated third-party provider, conducted in compliance with the Fair Credit Reporting Act (FCRA) and applicable state laws.',
          },
        ],
      },
      {
        id: '5-5',
        title: '5.5 Job Performance Standards',
        blocks: [
          {
            type: 'paragraph',
            text: 'Upon accepting a Job, Vendors agree to: (a) perform work professionally per applicable trade standards; (b) honor scheduled appointment times or provide reasonable advance notice of changes; (c) document completion with photographs as required by the Platform; (d) obtain all required permits for regulated work.',
          },
        ],
      },
      {
        id: '5-6',
        title: '5.6 Platform Fees',
        blocks: [
          {
            type: 'paragraph',
            text: 'Vendor fees are described in Ulo\'s then-current Vendor fee schedule disclosed at enrollment and updated with reasonable advance notice.',
          },
        ],
      },
    ],
  },
  {
    id: 'tenant-terms',
    title: '6. Tenant Terms',
    blocks: [],
    subsections: [
      {
        id: '6-1',
        title: '6.1 Limited Platform Access',
        blocks: [
          {
            type: 'paragraph',
            text: 'Tenants may use the Platform\'s SMS intake solely to submit maintenance requests on their Landlord\'s behalf.',
          },
        ],
      },
      {
        id: '6-2',
        title: '6.2 Tenant Data and Consent',
        blocks: [
          {
            type: 'paragraph',
            text: 'By submitting a request via the Platform, Tenants consent to collection and processing of contact information, request content, and communication history as described in Ulo\'s Privacy Policy.',
          },
        ],
      },
      {
        id: '6-3',
        title: '6.3 No Direct Service Contract',
        blocks: [
          {
            type: 'paragraph',
            text: 'Tenants have no direct contractual relationship with Vendors for Platform-arranged services.',
          },
        ],
      },
    ],
  },
  {
    id: 'disclaimer',
    title: '7. Disclaimer of Warranties',
    blocks: [
      {
        type: 'caps',
        text: 'THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. ULO EXPRESSLY DISCLAIMS ALL WARRANTIES INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. ULO DOES NOT WARRANT THE QUALITY, SAFETY, TIMELINESS, OR WORKMANSHIP OF VENDOR SERVICES OR UNINTERRUPTED PLATFORM AVAILABILITY.',
      },
    ],
  },
  {
    id: 'limitation-of-liability',
    title: '8. Limitation of Liability',
    blocks: [],
    subsections: [
      {
        id: '8-1',
        title: '8.1 Liability Cap',
        blocks: [
          {
            type: 'caps',
            text: 'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ULO\'S TOTAL LIABILITY SHALL NOT EXCEED THE LESSER OF: (A) TOTAL FEES PAID BY THAT USER TO ULO IN THE THREE MONTHS PRECEDING THE CLAIM; OR (B) ONE HUNDRED DOLLARS ($100.00).',
          },
        ],
      },
      {
        id: '8-2',
        title: '8.2 Exclusion of Consequential Damages',
        blocks: [
          {
            type: 'caps',
            text: 'IN NO EVENT SHALL ULO BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, PUNITIVE, EXEMPLARY, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, LOSS OF DATA, OR PROPERTY DAMAGE.',
          },
        ],
      },
      {
        id: '8-3',
        title: '8.3 No Liability for Vendor Acts',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo is not liable for any act, omission, negligence, or breach by any Vendor, including property damage, personal injury, theft, or service failure.',
          },
        ],
      },
    ],
  },
  {
    id: 'indemnification',
    title: '9. Indemnification',
    blocks: [
      {
        type: 'paragraph',
        text: 'You agree to defend, indemnify, and hold harmless Ulo Home, Inc. and its officers, directors, employees, agents, successors, and assigns from all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\' fees) arising from:',
      },
      {
        type: 'list',
        items: [
          'Your use of the Platform or services arranged through it.',
          'Property damage, personal injury, or harm attributable to any Vendor you engage.',
          'Your violation of these Terms or any Applicable Law.',
          'Your negligence or willful misconduct.',
          'Any dispute between you and another Platform user.',
        ],
      },
    ],
  },
  {
    id: 'insurance',
    title: '10. Insurance and Property Damage',
    blocks: [],
    subsections: [
      {
        id: '10-1',
        title: '10.1 COI as Condition Precedent',
        blocks: [
          {
            type: 'paragraph',
            text: 'No Vendor receives any Job assignment without a valid COI on file naming Ulo Home, Inc. as Additional Insured. This applies to all Jobs regardless of value or market.',
          },
        ],
      },
      {
        id: '10-2',
        title: '10.2 Property Damage Claims Process',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords must report suspected Vendor-caused property damage within 48 hours of discovery. Upon report, Ulo will: (a) suspend the Vendor from new Jobs pending review; (b) provide the Landlord with the Vendor\'s COI information; and (c) cooperate with the Landlord\'s reasonable requests in connection with an insurance claim.',
          },
          {
            type: 'caps',
            text: 'ULO DOES NOT PAY PROPERTY DAMAGE CLAIMS.',
          },
        ],
      },
    ],
  },
  {
    id: 'safety',
    title: '11. Safety and Misconduct Protocol',
    blocks: [],
    subsections: [
      {
        id: '11-1',
        title: '11.1 Reporting',
        blocks: [
          {
            type: 'paragraph',
            text: 'Report Vendor misconduct immediately to safety@ulohome.com. Ulo never requires reporters to prove claims before acting.',
          },
        ],
      },
      {
        id: '11-2',
        title: '11.2 Response Standards',
        blocks: [
          {
            type: 'paragraph',
            text: 'Upon report: (a) Vendor suspended from new Jobs immediately; (b) Class A (physical safety): founder contact within 15 minutes during business hours; (c) Class B (theft/fraud): human review within 1 hour; (d) Ulo never discourages law enforcement contact. Permanent bans are permanent.',
          },
        ],
      },
      {
        id: '11-3',
        title: '11.3 No Guarantee of Safety',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo\'s vetting procedures are risk-reduction measures, not guarantees of safety or Vendor conduct.',
          },
        ],
      },
    ],
  },
  {
    id: 'data-privacy-sms',
    title: '12. Data, Privacy, and SMS Communications',
    blocks: [],
    subsections: [
      {
        id: '12-1',
        title: '12.1 Privacy Policy',
        blocks: [
          {
            type: 'paragraph',
            text: 'Data practices are governed by Ulo\'s Privacy Policy available at /privacy, incorporated by reference.',
          },
        ],
      },
      {
        id: '12-2',
        title: '12.2 SMS/TCPA Consent',
        blocks: [
          {
            type: 'paragraph',
            text: 'By providing a phone number and submitting or receiving a service request via SMS, you expressly consent to receive automated SMS messages from Ulo using an automated telephone dialing system (ATDS). Consent is not a condition of purchase. Standard message and data rates may apply. Reply STOP to opt out of non-transactional messages.',
          },
        ],
      },
      {
        id: '12-3',
        title: '12.3 Home Data Graph',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo maintains property maintenance history, vendor performance, and property health data derived from Platform activity. Landlords retain ownership of individual property data. Ulo may use anonymized, aggregated data for product development and commercial purposes.',
          },
        ],
      },
    ],
  },
  {
    id: 'prohibited-conduct',
    title: '13. Prohibited Conduct',
    blocks: [
      {
        type: 'paragraph',
        text: 'Users may not:',
      },
      {
        type: 'list',
        items: [
          'Circumvent the Platform to transact directly with Platform-introduced Vendors for 12 months post-introduction.',
          'Submit false, misleading, or fraudulent requests, credentials, or reviews.',
          'Harass, threaten, or abuse any user or Ulo representative.',
          'Use the Platform to violate fair housing laws, tenant protection statutes, or any Applicable Law.',
          'Attempt to circumvent Ulo\'s matching algorithms, fee structures, or platform operations.',
          'Share account credentials with unauthorized parties.',
        ],
      },
    ],
  },
  {
    id: 'termination',
    title: '14. Termination',
    blocks: [],
    subsections: [
      {
        id: '14-1',
        title: '14.1 By User',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords may terminate by written notice to support@ulohome.com. Prepaid fees are non-refundable except as required by Applicable Law.',
          },
        ],
      },
      {
        id: '14-2',
        title: '14.2 By Ulo',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo may suspend or terminate accounts for Terms violations, misconduct, fraud, or other reasonable cause.',
          },
        ],
      },
      {
        id: '14-3',
        title: '14.3 Survival',
        blocks: [
          {
            type: 'paragraph',
            text: 'Sections 7, 8, 9, 12, 15, and 16 survive termination.',
          },
        ],
      },
    ],
  },
  {
    id: 'dispute-resolution',
    title: '15. Dispute Resolution',
    blocks: [],
    subsections: [
      {
        id: '15-1',
        title: '15.1 Informal Resolution (Required)',
        blocks: [
          {
            type: 'paragraph',
            text: 'Before formal proceedings, parties must attempt informal resolution by written notice to legal@ulohome.com. Ulo will respond within 30 days. This step is a condition precedent to arbitration.',
          },
        ],
      },
      {
        id: '15-2',
        title: '15.2 Binding Arbitration',
        blocks: [
          {
            type: 'paragraph',
            text: 'Disputes not resolved informally shall be resolved by binding arbitration under AAA Consumer Arbitration Rules, on an individual basis.',
          },
          {
            type: 'caps',
            text: 'CLASS ACTIONS AND CLASS ARBITRATIONS ARE NOT PERMITTED.',
          },
        ],
      },
      {
        id: '15-3',
        title: '15.3 California Users',
        blocks: [
          {
            type: 'paragraph',
            text: 'Notwithstanding Section 15.2, California residents may bring individual claims in California small claims court or seek public injunctive relief in court to the extent such claims cannot be waived under California law.',
          },
        ],
      },
      {
        id: '15-4',
        title: '15.4 Small Claims Exception',
        blocks: [
          {
            type: 'paragraph',
            text: 'Either party may bring individual claims in small claims court if the claim qualifies under applicable court rules.',
          },
        ],
      },
      {
        id: '15-5',
        title: '15.5 Jury Trial Waiver',
        blocks: [
          {
            type: 'caps',
            text: 'TO THE EXTENT PERMITTED BY APPLICABLE LAW, EACH PARTY WAIVES ITS RIGHT TO A JURY TRIAL IN CONNECTION WITH ANY DISPUTE ARISING FROM THESE TERMS.',
          },
        ],
      },
    ],
  },
  {
    id: 'governing-law',
    title: '16. Governing Law',
    blocks: [
      {
        type: 'paragraph',
        text: 'These Terms are governed by Delaware law, without regard to conflict of law principles. This choice of law does not deprive consumers of protections available under mandatory provisions of their home state\'s law that cannot be waived by contract.',
      },
    ],
  },
  {
    id: 'general-provisions',
    title: '17. General Provisions',
    blocks: [],
    subsections: [
      {
        id: '17-1',
        title: '17.1 Modifications',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo may modify these Terms with 30 days\' advance notice via email or Platform notice. Continued use constitutes acceptance.',
          },
        ],
      },
      {
        id: '17-2',
        title: '17.2 Entire Agreement',
        blocks: [
          {
            type: 'paragraph',
            text: 'These Terms, Privacy Policy, and any applicable Vendor Agreement constitute the entire agreement and supersede all prior understandings.',
          },
        ],
      },
      {
        id: '17-3',
        title: '17.3 Severability',
        blocks: [
          {
            type: 'paragraph',
            text: 'If any provision is found unenforceable, it shall be modified to the minimum extent required; remaining provisions remain in full force.',
          },
        ],
      },
      {
        id: '17-4',
        title: '17.4 Assignment',
        blocks: [
          {
            type: 'paragraph',
            text: 'You may not assign rights under these Terms. Ulo may assign in connection with a merger, acquisition, or asset sale.',
          },
        ],
      },
      {
        id: '17-5',
        title: '17.5 Contact',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo Home, Inc. · hello@ulohome.com · legal@ulohome.com · safety@ulohome.com',
          },
        ],
      },
    ],
  },
]
