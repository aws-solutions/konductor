export const accountSections = [
  { slug: 'profile', label: 'Profile', hint: 'Your personal details and workspace identity.' },
  { slug: 'security', label: 'Security', hint: 'Sign-in methods and recent device activity.' },
  { slug: 'notifications', label: 'Notifications', hint: 'Choose which updates reach your inbox.' },
];

export function sectionLabel(slug) {
  return accountSections.find((section) => section.slug === slug)?.label || 'Account';
}
