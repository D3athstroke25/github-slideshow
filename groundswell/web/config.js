// Public client settings. The publishable key is safe to ship: the database only answers
// through functions that check the caller's session, and tables are not readable directly.
window.GS_CONFIG = {
  url: 'https://mrvuxjkahorglqnmyamh.supabase.co',
  key: 'sb_publishable_RHMNW2akCys52DGwpH9tOw_OBr0U95e',
  appUrl: 'https://d3athstroke25.github.io/github-slideshow/groundswell/',
  // 'test': pledges are recorded and count toward goals, but no card is taken and no money moves.
  payments: 'test',
  // Shown on the Help & contact page when set, e.g. 'help@yourdomain.com'.
  supportEmail: '',
};
