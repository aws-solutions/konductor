export const articles = [
  {
    slug: 'getting-started',
    label: 'Getting started',
    eyebrow: 'First steps',
    heading: 'Make your first Northstar workspace useful',
    body: 'Start with one clear home for the work your team already shares.',
  },
  {
    slug: 'billing',
    label: 'Billing',
    eyebrow: 'Plans and invoices',
    heading: 'Keep invoices easy to find',
    body: 'Your workspace owner can review receipts and adjust the plan from one place.',
  },
  {
    slug: 'security',
    label: 'Security',
    eyebrow: 'Account safety',
    heading: 'Give every teammate the right access',
    body: 'Use individual accounts and review unfamiliar sign-ins before sharing workspace data.',
  },
  {
    slug: 'contact',
    label: 'Contact us',
    eyebrow: 'A little help',
    heading: 'Talk to a person when the article is not enough',
    body: 'The care team can help with account questions on business days.',
  },
];

export function articleBySlug(slug) {
  return articles.find((article) => article.slug === slug) || null;
}
