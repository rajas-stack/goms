import type { CompetitorInput } from '@goms/domain'

/** Demo data for local mode only. No logos are shipped: every sample shows its initials tile. */
export const SAMPLE_COMPETITORS: CompetitorInput[] = [
  {
    name: 'SAS', website: 'https://www.sas.com', relationship: 'strategicThreat', category: 'Analytics & Data Management',
    subCategories: ['Data quality', 'Advanced analytics'], verticals: ['BFSI', 'Government', 'Healthcare'],
    certifications: ['ISO 27001', 'SOC 2'],
    offerings: ['Data deduplication tools', 'Master data management', 'Data quality', 'Fraud analytics', 'Data governance'],
    strengths: ['Deep analytics heritage and brand recall', 'Strong references in public-sector fraud detection', 'Broad partner ecosystem'],
    description: 'Long-established analytics vendor. Frequently bids on government data-quality and fraud programmes.',
  },
  {
    name: 'Informatica', website: 'https://www.informatica.com', relationship: 'competitor', category: 'Data Integration',
    subCategories: ['Cloud data management'], verticals: ['BFSI', 'Retail', 'Data & AI'], certifications: ['ISO 27001', 'FedRAMP'],
    offerings: ['Data integration', 'Master data management', 'Data catalog', 'Data quality', 'Cloud data management'],
    strengths: ['Market-leading integration platform', 'Mature MDM product line', 'Large certified-partner network'],
    description: 'Enterprise data-integration specialist moving customers to its cloud platform.',
  },
  {
    name: 'IBM', website: 'https://www.ibm.com', relationship: 'partner', category: 'IT Services & Software',
    subCategories: ['Consulting', 'Hybrid cloud'], verticals: ['Government', 'BFSI', 'Telecom'], certifications: ['CMMI L5', 'ISO 27001', 'ISO 9001'],
    offerings: ['Data governance', 'AI platforms', 'Hybrid cloud', 'Systems integration', 'Consulting'],
    strengths: ['End-to-end delivery capacity', 'Trusted by large government departments', 'Strong AI research brand'],
    description: 'Partner on large integration bids; competes directly on some AI and governance work.',
  },
  {
    name: 'Oracle', website: 'https://www.oracle.com', relationship: 'competitor', category: 'Database & Cloud',
    subCategories: ['ERP', 'Cloud infrastructure'], verticals: ['Government', 'BFSI', 'Manufacturing'], certifications: ['ISO 27001', 'SOC 2'],
    offerings: ['Database platforms', 'Cloud infrastructure', 'ERP', 'Data integration'],
    strengths: ['Installed database base in most departments', 'Bundled licensing leverage'],
    description: 'Often already present in the customer estate; competes on bundled platform deals.',
  },
  {
    name: 'Talend', website: 'https://www.talend.com', relationship: 'neutral', category: 'Data Integration',
    subCategories: ['Open-source tooling'], verticals: ['Retail', 'Data & AI'], certifications: ['ISO 27001'],
    offerings: ['Data integration', 'Data quality', 'Data preparation'],
    strengths: ['Lower licence cost', 'Open-source developer community'],
    description: 'Lower-cost integration option; seen mainly in smaller tenders.',
  },
]
