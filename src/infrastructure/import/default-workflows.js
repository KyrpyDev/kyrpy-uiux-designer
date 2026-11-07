/**
 * Workflows transferred from the v1 prototype. v1 only had the screen set (and slide images of the flows);
 * the links below connect those screens the way the app navigates. Edit freely in the workflow designer.
 * fromText / fromIcon pick the element on the source screen that triggers the link (used for export hotspots).
 */
export const WORKFLOWS = [
  {
    key: 'sample-main-flow', name: 'Sample main flow', label: 'Main flow',
    intro: 'End-to-end flow of the Sample App: sign in, manage collections, review items and their details.',
    screens: ['splash', 'sign-in', 'sign-up', 'google-sign-in', 'item-list', 'side-menu', 'item-actions', 'collection-complete', 'collection-new-items', 'collection-gallery',
      'item-detail', 'item-menu', 'item-menu-scrolled', 'item-properties', 'item-stats', 'refresh-item-sheet', 'edit-item-settings',
      'all-comments', 'item-comments', 'detail-main', 'detail-radial-actions', 'detail-bottom-actions', 'detail-share-ring'],
    layout: [['splash', 'sign-in', 'sign-up', 'google-sign-in'], ['item-list', 'side-menu', 'item-actions', 'detail-main'], ['collection-complete', 'collection-new-items', 'collection-gallery'],
      ['item-detail', 'item-menu', 'item-menu-scrolled', 'item-properties'], ['item-stats', 'refresh-item-sheet', 'edit-item-settings', 'all-comments', 'item-comments']],
    links: [
      ['splash', 'sign-in', 'Continue without session', 'Auto-advance after the splash animation (1.5 s) when no session token is stored.', { trigger: 'timeout' }],
      ['sign-in', 'sign-up', 'Open registration', 'Switch to the Sign up tab.', { fromText: 'Sign up' }],
      ['sign-in', 'google-sign-in', 'Sign in with Google', 'Switch to the Google tab and start OAuth.', { fromText: 'Google' }],
      ['sign-in', 'item-list', 'Sign in', 'Validate credentials, store the session, open the item list.', { fromText: 'Sign in' }],
      ['sign-up', 'sign-in', 'Back to sign in', 'Switch to the Sign in tab.', { fromText: 'Sign in' }],
      ['google-sign-in', 'item-list', 'Google signed in', 'OAuth finished: create/restore the session and open the item list.', {}],
      ['item-list', 'side-menu', 'Open main menu', 'Slide in the main menu from the left.', { fromIcon: 'menu' }],
      ['item-list', 'item-actions', 'Item actions', 'Long-press (or tap the burger) on an item to open the action menu.', {}],
      ['item-list', 'collection-complete', 'Open completed collection', 'Tap a completed collection.', {}],
      ['item-list', 'collection-new-items', 'Open new collection', 'Tap a collection with new items.', {}],
      ['item-list', 'detail-main', 'Open document', 'Tap an item to get its main action button.', {}],
      ['side-menu', 'item-list', 'Close menu', 'Dismiss the menu and return to the item list.', { fromIcon: 'home' }],
      ['item-actions', 'item-list', 'Close actions', 'Dismiss the action menu.', {}],
      ['collection-complete', 'item-detail', 'Open item', 'Tap an item row to see its details.', {}],
      ['collection-complete', 'collection-gallery', 'Show gallery', 'Open the image gallery.', {}],
      ['collection-new-items', 'refresh-item-sheet', 'Refresh items', 'Open the refresh sheet for the new items.', {}],
      ['collection-gallery', 'item-detail', 'Open item from image', 'Tap an overlay result to open that item.', {}],
      ['item-detail', 'item-menu', 'Open item menu', 'Open the settings menu for this item.', { fromIcon: 'menu' }],
      ['item-menu', 'item-menu-scrolled', 'Scroll menu', 'Scroll the menu to show the lower options.', {}],
      ['item-menu', 'item-properties', 'Item properties', 'Open the properties bottom sheet.', {}],
      ['item-menu', 'item-stats', 'AI model metrics', 'Open the metrics sheet of the selected model.', {}],
      ['item-menu', 'all-comments', 'Project comments', 'Open the project comments sheet.', {}],
      ['item-menu', 'item-comments', 'Page comments', 'Open the page comments sheet.', {}],
      ['item-menu', 'refresh-item-sheet', 'Refresh item', 'Open the refresh sheet.', {}],
      ['item-menu-scrolled', 'edit-item-settings', 'Edit model config', 'Open the model configuration form.', {}],
      ['item-properties', 'item-detail', 'Apply properties', 'Save the properties and return to the item.', {}],
      ['refresh-item-sheet', 'item-detail', 'Start refresh', 'Queue the refresh and return to the item.', {}],
      ['edit-item-settings', 'item-menu-scrolled', 'Save model', 'Save the model and return to the menu.', {}],
      ['detail-main', 'detail-radial-actions', 'Open radial actions', 'Tap the main button to open the radial ring.', {}],
      ['detail-radial-actions', 'detail-bottom-actions', 'Switch to bottom actions', 'Show the bottom action bar variant.', {}],
      ['detail-bottom-actions', 'detail-share-ring', 'Open share ring', 'Show the share ring.', {}],
      ['detail-share-ring', 'detail-main', 'Back', 'Return to the document screen.', {}]
    ]
  },
  {
    key: 'authentication', name: 'Authentication', label: 'Authentication',
    intro: 'Splash, sign in, sign up and Google sign-in.',
    screens: ['splash', 'sign-in', 'sign-up', 'google-sign-in', 'item-list'],
    layout: [['splash'], ['sign-in'], ['sign-up'], ['google-sign-in'], ['item-list']],
    links: 'subset-of:sample-main-flow'
  },
  {
    key: 'item-actions', name: 'Item actions', label: 'Item actions',
    intro: 'The four item detail screens: main button, radial actions, bottom actions and share ring.',
    screens: ['detail-main', 'detail-radial-actions', 'detail-bottom-actions', 'detail-share-ring'],
    layout: [['detail-main'], ['detail-radial-actions'], ['detail-bottom-actions'], ['detail-share-ring']],
    links: 'subset-of:sample-main-flow'
  }
];
