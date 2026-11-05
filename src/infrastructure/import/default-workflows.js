/**
 * Workflows transferred from the v1 prototype. v1 only had the screen set (and slide images of the flows);
 * the links below connect those screens the way the app navigates. Edit freely in the workflow designer.
 * fromText / fromIcon pick the element on the source screen that triggers the link (used for export hotspots).
 */
export const WORKFLOWS = [
  {
    key: 'untrap-main-flow', name: 'Untrap main flow', label: 'Main flow',
    intro: 'End-to-end flow of the Untrap app: sign in, manage scan folders, review analyzed booklets and questions.',
    screens: ['splash', 'sign-in', 'sign-up', 'google-sign-in', 'scan-list', 'side-menu', 'scan-actions', 'booklet-analyzed', 'booklet-new-pages', 'analyzed-images',
      'question-detail', 'question-menu', 'question-menu-scrolled', 'question-parameters', 'ai-model-metrics', 're-analyze-page', 'edit-model-config',
      'project-comments', 'page-comments', 'document-analyze', 'document-radial-actions', 'document-bottom-actions', 'document-share-ring'],
    layout: [['splash', 'sign-in', 'sign-up', 'google-sign-in'], ['scan-list', 'side-menu', 'scan-actions', 'document-analyze'], ['booklet-analyzed', 'booklet-new-pages', 'analyzed-images'],
      ['question-detail', 'question-menu', 'question-menu-scrolled', 'question-parameters'], ['ai-model-metrics', 're-analyze-page', 'edit-model-config', 'project-comments', 'page-comments']],
    links: [
      ['splash', 'sign-in', 'Continue without session', 'Auto-advance after the splash animation (1.5 s) when no session token is stored.', { trigger: 'timeout' }],
      ['sign-in', 'sign-up', 'Open registration', 'Switch to the Sign up tab.', { fromText: 'Kayıt Ol' }],
      ['sign-in', 'google-sign-in', 'Sign in with Google', 'Switch to the Google tab and start OAuth.', { fromText: 'Google' }],
      ['sign-in', 'scan-list', 'Sign in', 'Validate credentials, store the session, open the scan list.', { fromText: 'Giriş Yap →' }],
      ['sign-up', 'sign-in', 'Back to sign in', 'Switch to the Sign in tab.', { fromText: 'Giriş Yap' }],
      ['google-sign-in', 'scan-list', 'Google signed in', 'OAuth finished: create/restore the session and open the scan list.', {}],
      ['scan-list', 'side-menu', 'Open main menu', 'Slide in the main menu from the left.', { fromIcon: 'menu' }],
      ['scan-list', 'scan-actions', 'Folder actions', 'Long-press (or tap the burger) on a folder to open the action menu.', {}],
      ['scan-list', 'booklet-analyzed', 'Open analyzed folder', 'Tap a fully analyzed folder (green frame).', {}],
      ['scan-list', 'booklet-new-pages', 'Open new folder', 'Tap a folder that still has unanalyzed pages.', {}],
      ['scan-list', 'document-analyze', 'Open document', 'Tap a document to get the analyze/folder main button.', {}],
      ['side-menu', 'scan-list', 'Close menu', 'Dismiss the menu and return to the scan list.', { fromIcon: 'home' }],
      ['scan-actions', 'scan-list', 'Close actions', 'Dismiss the action menu.', {}],
      ['booklet-analyzed', 'question-detail', 'Open question', 'Tap a question row to see the detected answer.', {}],
      ['booklet-analyzed', 'analyzed-images', 'Show analyzed images', 'Open the image gallery of analyzed pages.', {}],
      ['booklet-new-pages', 're-analyze-page', 'Analyze pages', 'Open the analyze sheet for the new pages.', {}],
      ['analyzed-images', 'question-detail', 'Open question from image', 'Tap an overlay result to open that question.', {}],
      ['question-detail', 'question-menu', 'Open question menu', 'Open the settings menu for this question.', { fromIcon: 'menu' }],
      ['question-menu', 'question-menu-scrolled', 'Scroll menu', 'Scroll the menu to show the lower options.', {}],
      ['question-menu', 'question-parameters', 'Question parameters', 'Open the parameters bottom sheet.', {}],
      ['question-menu', 'ai-model-metrics', 'AI model metrics', 'Open the metrics sheet of the selected model.', {}],
      ['question-menu', 'project-comments', 'Project comments', 'Open the project comments sheet.', {}],
      ['question-menu', 'page-comments', 'Page comments', 'Open the page comments sheet.', {}],
      ['question-menu', 're-analyze-page', 'Re-analyze page', 'Open the re-analyze sheet.', {}],
      ['question-menu-scrolled', 'edit-model-config', 'Edit model config', 'Open the model configuration form.', {}],
      ['question-parameters', 'question-detail', 'Apply parameters', 'Save the parameters and return to the question.', {}],
      ['re-analyze-page', 'question-detail', 'Start re-analysis', 'Queue the analysis and return to the question.', {}],
      ['edit-model-config', 'question-menu-scrolled', 'Save model', 'Save the model and return to the menu.', {}],
      ['document-analyze', 'document-radial-actions', 'Open radial actions', 'Tap the main button to open the radial ring.', {}],
      ['document-radial-actions', 'document-bottom-actions', 'Switch to bottom actions', 'Show the bottom action bar variant.', {}],
      ['document-bottom-actions', 'document-share-ring', 'Open share ring', 'Show the share ring.', {}],
      ['document-share-ring', 'document-analyze', 'Back', 'Return to the document screen.', {}]
    ]
  },
  {
    key: 'authentication', name: 'Authentication', label: 'Authentication',
    intro: 'Splash, sign in, sign up and Google sign-in.',
    screens: ['splash', 'sign-in', 'sign-up', 'google-sign-in', 'scan-list'],
    layout: [['splash'], ['sign-in'], ['sign-up'], ['google-sign-in'], ['scan-list']],
    links: 'subset-of:untrap-main-flow'
  },
  {
    key: 'document-actions', name: 'Document actions', label: 'Document actions',
    intro: 'The four document screens: main button, radial actions, bottom actions and share ring.',
    screens: ['document-analyze', 'document-radial-actions', 'document-bottom-actions', 'document-share-ring'],
    layout: [['document-analyze'], ['document-radial-actions'], ['document-bottom-actions'], ['document-share-ring']],
    links: 'subset-of:untrap-main-flow'
  }
];
