/**
 * Sample buttons with nested menus, taken from the v1 radial / ring menus (document screens, page-review slide).
 * Icons are v1 icon keys. `children` nests without limit (the service allows 6 levels).
 */
export const SAMPLE_MENUS = [
  {
    key: 'document-radial-menu', name: 'Document radial menu', icon: 'untrap-logo-basic',
    config: { kind: 'rotating', layout: 'fan', radius: 1.75, startAngle: -170, sweep: 160, itemScale: 0.75, rotateOnOpen: 45 },
    items: [
      { name: 'add', label: 'Add', icon: 'save-folder' },
      { name: 'rename', label: 'Rename', icon: 'folder-rename' },
      { name: 'move', label: 'Move', icon: 'folder-move' },
      { name: 'delete', label: 'Delete', icon: 'delete-scan' },
      { name: 'share', label: 'Share', icon: 'folder-share', children: [
        { name: 'sync', label: 'Sync', icon: 'sync' },
        { name: 'analyze', label: 'Analyze', icon: 'folder-ai-analyze' },
        { name: 'view', label: 'View', icon: 'eye' },
        { name: 'report', label: 'Report', icon: 'export-report', children: [
          { name: 'pdf', label: 'PDF', icon: 'export-to-pdf' },
          { name: 'print', label: 'Print', icon: 'report-print' }
        ] }
      ] },
      { name: 'folder', label: 'Folder', icon: 'folder' }
    ]
  },
  {
    key: 'page-review-menu', name: 'Page review menu', icon: 'untrap-scan',
    config: { kind: 'rotating', layout: 'fan', radius: 1.8, startAngle: -180, sweep: 180, itemScale: 0.72, rotateOnOpen: 0 },
    items: [
      { name: 'back', label: 'Back', icon: 'back' },
      { name: 'delete-scan', label: 'Delete scan', icon: 'delete-scan' },
      { name: 'reset-crop', label: 'Reset crop', icon: 'reset-crop' },
      { name: 'rotate-left', label: 'Rotate left', icon: 'rotate-left' },
      { name: 'rotate-right', label: 'Rotate right', icon: 'rotate-right' },
      { name: 'auto-crop', label: 'Auto crop', icon: 'auto-crop' },
      { name: 'approve-scan', label: 'Approve scan', icon: 'approve-scan' }
    ]
  },
  {
    key: 'more-popup-button', name: 'More popup button', icon: 'menu',
    config: { kind: 'popup', layout: 'list', direction: 'up', itemScale: 0.75, gap: 0.18, rotateOnOpen: 90 },
    items: [
      { name: 'profile', label: 'Profile', icon: 'profile' },
      { name: 'notifications', label: 'Notifications', icon: 'notifications', children: [
        { name: 'announcements', label: 'Announcements', icon: 'announcement' },
        { name: 'feedback', label: 'Feedback', icon: 'feedback' }
      ] },
      { name: 'settings', label: 'Settings', icon: 'settings' },
      { name: 'logout', label: 'Log out', icon: 'logout' }
    ]
  }
];
