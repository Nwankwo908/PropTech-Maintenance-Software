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
  version: '1.3',
  company: 'Ulo Home, Inc.',
} as const

/** Anchor id for Privacy Policy references within the Terms page (Section 13.1). */
export const TERMS_PRIVACY_SECTION_ID = '13-1'
/** @deprecated Prefer PRIVACY_POLICY_PATH from privacyPolicyContent — kept for legacy imports. */
export { PRIVACY_POLICY_PATH as TERMS_PRIVACY_SECTION_PATH } from '@/lib/legal/privacyPolicyContent'

export const TERMS_OF_SERVICE_PREAMBLE: LegalBlock[] = [
  {
    type: 'paragraph',
    text: 'These Terms of Service ("Terms") govern your access to and use of the Ulo Home platform, including its web-based interface, SMS communication system, mobile applications, and associated services (collectively, the "Platform") operated by Ulo Home, Inc., a Delaware corporation ("Ulo," "we," "us," or "our").',
  },
  {
    type: 'paragraph',
    text: 'By accessing the Platform, creating an account, or submitting or responding to any service request, you agree to be bound by these Terms and our /privacy. If you do not agree, do not use the Platform.',
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
        title: '1.3 Two-Tier Vendor Structure & Disclaimer',
        blocks: [
          {
            type: 'paragraph',
            text: 'The Platform supports two distinct categories of service providers: (a) Ulo Verified Vendors (sourced, vetted, and background-checked directly by Ulo); and (b) Landlord Preferred Vendors (nominated, authorized, and independently vetted directly by a Landlord). Ulo does not independently screen, background-check, or verify credentials for Landlord Preferred Vendors, and expressly disclaims all liability related to their selection, authorization, and performance.',
          },
        ],
      },
      {
        id: '1-4',
        title: '1.4 No Employment or Agency Relationship',
        blocks: [
          {
            type: 'paragraph',
            text: 'Nothing in these Terms creates an employment relationship, joint venture, partnership, agency, or franchise between Ulo and any user. Ulo expressly disclaims any such relationship.',
          },
        ],
      },
      {
        id: '1-5',
        title: '1.5 Automated Communications',
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
          '"Ulo Verified Vendor" — A Vendor who has completed full vetting directly with Ulo: license verification, COI confirmation, and background screening.',
          '"Landlord Preferred Vendor" — A Vendor nominated by a Landlord who completes Ulo\'s lightweight self-representation process without full Ulo vetting.',
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
        title: '5.2 Mandatory Insurance Requirements',
        blocks: [
          {
            type: 'list',
            items: [
              'Ulo Verified Vendors: Must maintain commercial general liability insurance ($1,000,000 per occurrence / $2,000,000 aggregate minimum), upload a valid COI listing Ulo Home, Inc. as Additional Insured, and maintain continuous coverage.',
              'Landlord Preferred Vendors: Must confirm and warrant prior to Job acceptance that they maintain active general liability insurance and required credentials as mandated by Applicable Law and their authorizing Landlord.',
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
            text: 'Ulo Verified Vendors must consent to background screening via Ulo\'s designated third-party provider, conducted in compliance with the Fair Credit Reporting Act (FCRA) and applicable state laws. Landlord Preferred Vendors are exempt from Ulo background screening, but may be screened independently by the nominating Landlord.',
          },
        ],
      },
      {
        id: '5-5',
        title: '5.5 Job Performance Standards',
        blocks: [
          {
            type: 'paragraph',
            text: 'Upon accepting a Job, Vendors agree to: (a) perform work professionally per applicable trade standards; (b) honor scheduled appointment times or provide reasonable advance notice of changes; (c) document completion with photographs as required by the Platform; and (d) obtain all required permits for regulated work.',
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
    id: 'landlord-supplied-vendors',
    title: '6. Landlord-Supplied Vendors & Two-Tier Verification',
    blocks: [],
    subsections: [
      {
        id: '6-1',
        title: '6.1 Nomination of Landlord Preferred Vendors',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords may nominate and supply their own third-party Vendors ("Landlord Preferred Vendors") to receive automated job routing through the Platform. When nominating a Vendor, the Landlord must supply initial contact details, including Business Name, Phone Number, Email, Trade, and known licensing/insurance details.',
          },
        ],
      },
      {
        id: '6-2',
        title: '6.2 Landlord Representation & Authorization',
        blocks: [
          {
            type: 'paragraph',
            text: 'When adding a Landlord Preferred Vendor, the Landlord expressly acknowledges, authorizes, and agrees that:',
          },
          {
            type: 'list',
            items: [
              'The Landlord has independently selected, evaluated, and vetted the Vendor.',
              'Ulo is authorized strictly to act as a communication routing mechanism to coordinate work orders with said Vendor.',
              'Ulo does not independently verify, endorse, background-check, or audit credentials for Landlord Preferred Vendors.',
              'The Landlord assumes sole responsibility for confirming that the nominated Vendor is properly licensed, bonded, insured, and qualified under Applicable Law to perform the requested services.',
            ],
          },
        ],
      },
      {
        id: '6-3',
        title: '6.3 Vendor Self-Representation & SMS Acknowledgment',
        blocks: [
          {
            type: 'paragraph',
            text: 'Prior to receiving or accepting any Job dispatched via Ulo, a Landlord Preferred Vendor must complete an automated SMS intake flow agreeing that:',
          },
          {
            type: 'list',
            items: [
              'All business information, trade credentials, and contact details provided to Ulo are accurate and current.',
              'The Vendor holds and will maintain all required licenses, permits, registrations, workers\' compensation coverage, and commercial general liability insurance required by Applicable Law.',
              'The Vendor will immediately notify Ulo and the authorizing Landlord if any required credential expires, lapses, is suspended, or becomes invalid.',
              'The Vendor acts solely as an independent contractor to the Landlord and acknowledges that Ulo is a software coordination platform—not their employer, general contractor, or contracting party.',
            ],
          },
        ],
      },
      {
        id: '6-4',
        title: '6.4 Allocation of Risk',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords and Vendors acknowledge that Ulo\'s two-tier onboarding process relies on mutual representations from the Landlord and Vendor. Ulo disclaims all liability stemming from unverified, inaccurate, or fraudulent representations made by Landlords or Landlord Preferred Vendors.',
          },
        ],
      },
    ],
  },
  {
    id: 'tenant-terms',
    title: '7. Tenant Terms',
    blocks: [],
    subsections: [
      {
        id: '7-1',
        title: '7.1 Limited Platform Access',
        blocks: [
          {
            type: 'paragraph',
            text: 'Tenants may use the Platform\'s SMS intake solely to submit maintenance requests on their Landlord\'s behalf.',
          },
        ],
      },
      {
        id: '7-2',
        title: '7.2 Tenant Data and Consent',
        blocks: [
          {
            type: 'paragraph',
            text: 'By submitting a request via the Platform, Tenants consent to collection and processing of contact information, request content, and communication history as described in Ulo\'s /privacy.',
          },
        ],
      },
      {
        id: '7-3',
        title: '7.3 No Direct Service Contract',
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
    title: '8. Disclaimer of Warranties',
    blocks: [
      {
        type: 'caps',
        text: 'THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. ULO EXPRESSLY DISCLAIMS ALL WARRANTIES INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. ULO DOES NOT WARRANT THE QUALITY, SAFETY, TIMELINESS, OR WORKMANSHIP OF VENDOR SERVICES (WHETHER ULO VERIFIED OR LANDLORD PREFERRED) OR UNINTERRUPTED PLATFORM AVAILABILITY.',
      },
    ],
  },
  {
    id: 'limitation-of-liability',
    title: '9. Limitation of Liability',
    blocks: [],
    subsections: [
      {
        id: '9-1',
        title: '9.1 Liability Cap',
        blocks: [
          {
            type: 'caps',
            text: 'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ULO\'S TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE LESSER OF: (A) TOTAL FEES PAID BY THAT USER TO ULO IN THE THREE MONTHS PRECEDING THE CLAIM; OR (B) ONE HUNDRED DOLLARS ($100.00 USD).',
          },
        ],
      },
      {
        id: '9-2',
        title: '9.2 Exclusion of Consequential Damages',
        blocks: [
          {
            type: 'caps',
            text: 'IN NO EVENT SHALL ULO, ITS OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, PUNITIVE, EXEMPLARY, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, LOSS OF DATA, LOSS OF GOODWILL, OR PROPERTY DAMAGE.',
          },
        ],
      },
      {
        id: '9-3',
        title: '9.3 No Liability for Vendor Acts or Landlord Selections',
        blocks: [
          {
            type: 'caps',
            text: 'ULO IS NOT LIABLE FOR ANY ACT, OMISSION, NEGLIGENCE, MISCONDUCT, OR BREACH BY ANY VENDOR (WHETHER ULO VERIFIED OR LANDLORD PREFERRED), INCLUDING BUT NOT LIMITED TO PROPERTY DAMAGE, BODILY INJURY, PERSONAL INJURY, THEFT, POOR WORKMANSHIP, OR SERVICE FAILURE. ULO IS SPECIFICALLY NOT LIABLE FOR ANY CLAIMS ARISING FROM A LANDLORD\'S ELECTION TO ENGAGE OR AUTHORIZE A LANDLORD PREFERRED VENDOR.',
          },
        ],
      },
    ],
  },
  {
    id: 'indemnification',
    title: '10. Indemnification',
    blocks: [
      {
        type: 'paragraph',
        text: 'You agree to defend, indemnify, and hold harmless Ulo Home, Inc. and its officers, directors, employees, agents, successors, and assigns from and against all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\' fees) arising from or relating to:',
      },
      {
        type: 'list',
        items: [
          'Your use of the Platform or services arranged through it.',
          'Your selection, authorization, or engagement of any third-party Vendor (including Landlord Preferred Vendors).',
          'Property damage, personal injury, bodily harm, or death attributable to any Vendor you engage or work performed by you.',
          'Any misrepresentation regarding licensing, credentials, insurance, or independent contractor status.',
          'Your violation of these Terms or any Applicable Law.',
          'Your negligence or willful misconduct.',
          'Any dispute between you and another Platform user (including Landlord-Tenant, Landlord-Vendor, or Tenant-Vendor disputes).',
        ],
      },
    ],
  },
  {
    id: 'insurance',
    title: '11. Insurance and Property Damage',
    blocks: [],
    subsections: [
      {
        id: '11-1',
        title: '11.1 Verification Standards',
        blocks: [
          {
            type: 'list',
            items: [
              'Ulo Verified Jobs: No Ulo Verified Vendor receives any Job assignment without a valid COI on file naming Ulo Home, Inc. as Additional Insured.',
              'Landlord Preferred Jobs: Job dispatch proceeds based on the Landlord\'s authorization and the Vendor\'s self-representation pursuant to Section 6.',
            ],
          },
        ],
      },
      {
        id: '11-2',
        title: '11.2 Property Damage Claims Process',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords must report suspected Vendor-caused property damage within 48 hours of discovery. Upon report, Ulo will: (a) suspend the Vendor from new Platform-matched Jobs pending review; (b) provide the Landlord with any COI or credential information on file; and (c) cooperate with reasonable requests in connection with an insurance claim.',
          },
          {
            type: 'caps',
            text: 'ULO DOES NOT PAY OR COVER PROPERTY DAMAGE CLAIMS.',
          },
        ],
      },
    ],
  },
  {
    id: 'safety',
    title: '12. Safety and Misconduct Protocol',
    blocks: [],
    subsections: [
      {
        id: '12-1',
        title: '12.1 Reporting',
        blocks: [
          {
            type: 'paragraph',
            text: 'Report Vendor misconduct immediately to safety@ulohome.com. Ulo never requires reporters to prove claims before acting.',
          },
        ],
      },
      {
        id: '12-2',
        title: '12.2 Response Standards',
        blocks: [
          {
            type: 'paragraph',
            text: 'Upon report: (a) Vendor suspended from new Jobs immediately; (b) Class A (physical safety): founder contact within 15 minutes during business hours; (c) Class B (theft/fraud): human review within 1 hour; (d) Ulo never discourages law enforcement contact. Permanent bans are permanent.',
          },
        ],
      },
      {
        id: '12-3',
        title: '12.3 No Guarantee of Safety',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo\'s vetting procedures and verification steps are risk-reduction measures, not guarantees of safety or Vendor conduct.',
          },
        ],
      },
    ],
  },
  {
    id: 'data-privacy-sms',
    title: '13. Data, Privacy, and SMS Communications',
    blocks: [],
    subsections: [
      {
        id: '13-1',
        title: '13.1 Privacy Policy',
        blocks: [
          {
            type: 'paragraph',
            text: 'Data practices are governed by Ulo\'s /privacy incorporated by reference.',
          },
        ],
      },
      {
        id: '13-2',
        title: '13.2 SMS/TCPA Consent',
        blocks: [
          {
            type: 'paragraph',
            text: 'By providing a phone number and submitting or receiving a service request via SMS, you expressly consent to receive automated SMS messages from Ulo using an automated telephone dialing system (ATDS). Consent is not a condition of purchase. Standard message and data rates may apply. Reply STOP to opt out of non-transactional messages.',
          },
        ],
      },
      {
        id: '13-3',
        title: '13.3 Home Data Graph',
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
    title: '14. Prohibited Conduct',
    blocks: [
      {
        type: 'paragraph',
        text: 'Users may not:',
      },
      {
        type: 'list',
        items: [
          'Circumvent the Platform to transact directly with Platform-introduced Ulo Verified Vendors for 12 months post-introduction.',
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
    title: '15. Termination',
    blocks: [],
    subsections: [
      {
        id: '15-1',
        title: '15.1 By User',
        blocks: [
          {
            type: 'paragraph',
            text: 'Landlords may terminate by written notice to support@ulohome.com. Prepaid fees are non-refundable except as required by Applicable Law.',
          },
        ],
      },
      {
        id: '15-2',
        title: '15.2 By Ulo',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo may suspend or terminate accounts for Terms violations, misconduct, fraud, or other reasonable cause.',
          },
        ],
      },
      {
        id: '15-3',
        title: '15.3 Survival',
        blocks: [
          {
            type: 'paragraph',
            text: 'Sections 8, 9, 10, 13, 16, and 17 survive termination.',
          },
        ],
      },
    ],
  },
  {
    id: 'dispute-resolution',
    title: '16. Dispute Resolution',
    blocks: [],
    subsections: [
      {
        id: '16-1',
        title: '16.1 Informal Resolution (Required)',
        blocks: [
          {
            type: 'paragraph',
            text: 'Before formal proceedings, parties must attempt informal resolution by written notice to legal@ulohome.com. Ulo will respond within 30 days. This step is a condition precedent to arbitration.',
          },
        ],
      },
      {
        id: '16-2',
        title: '16.2 Binding Arbitration',
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
        id: '16-3',
        title: '16.3 California Users',
        blocks: [
          {
            type: 'paragraph',
            text: 'Notwithstanding Section 16.2, California residents may bring individual claims in California small claims court or seek public injunctive relief in court to the extent such claims cannot be waived under California law.',
          },
        ],
      },
      {
        id: '16-4',
        title: '16.4 Small Claims Exception',
        blocks: [
          {
            type: 'paragraph',
            text: 'Either party may bring individual claims in small claims court if the claim qualifies under applicable court rules.',
          },
        ],
      },
      {
        id: '16-5',
        title: '16.5 Jury Trial Waiver',
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
    title: '17. Governing Law',
    blocks: [
      {
        type: 'paragraph',
        text: 'These Terms are governed by Delaware law, without regard to conflict of law principles. This choice of law does not deprive consumers of protections available under mandatory provisions of their home state\'s law that cannot be waived by contract.',
      },
    ],
  },
  {
    id: 'general-provisions',
    title: '18. General Provisions',
    blocks: [],
    subsections: [
      {
        id: '18-1',
        title: '18.1 Modifications',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo may modify these Terms with 30 days\' advance notice via email or Platform notice. Continued use constitutes acceptance.',
          },
        ],
      },
      {
        id: '18-2',
        title: '18.2 Entire Agreement',
        blocks: [
          {
            type: 'paragraph',
            text: 'These Terms, /privacy, and any applicable Vendor Agreement constitute the entire agreement and supersede all prior understandings.',
          },
        ],
      },
      {
        id: '18-3',
        title: '18.3 Severability',
        blocks: [
          {
            type: 'paragraph',
            text: 'If any provision is found unenforceable, it shall be modified to the minimum extent required; remaining provisions remain in full force.',
          },
        ],
      },
      {
        id: '18-4',
        title: '18.4 Assignment',
        blocks: [
          {
            type: 'paragraph',
            text: 'You may not assign rights under these Terms. Ulo may assign in connection with a merger, acquisition, or asset sale.',
          },
        ],
      },
      {
        id: '18-5',
        title: '18.5 Contact',
        blocks: [
          {
            type: 'paragraph',
            text: 'Ulo Home, Inc. · info@ulohome.io',
          },
        ],
      },
    ],
  },
]
