/**
 * Sample buttons with nested menus, taken from the v1 radial / ring menus (item detail screens, page-check slide).
 * Icons are v1 icon keys. `children` nests without limit (the service allows 6 levels).
 */
export const SAMPLE_MENUS = [
  {
    key: 'item-radial-menu', name: 'Item radial menu', icon: 'sample-logo-basic',
    config: { kind: 'rotating', layout: 'fan', radius: 1.75, startAngle: -170, sweep: 160, itemScale: 0.75, rotateOnOpen: 45 },
    items: [
      { name: 'add', label: 'Add', icon: 'save-folder' },
      { name: 'rename', label: 'Rename', icon: 'folder-rename' },
      { name: 'move', label: 'Move', icon: 'folder-move' },
      { name: 'delete', label: 'Delete', icon: 'delete-scan' },
      { name: 'share', label: 'Share', icon: 'folder-share', children: [
        { name: 'sync', label: 'Sync', icon: 'sync' },
        { name: 'process', label: 'Process', icon: 'folder-ai-analyze' },
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
    key: 'page-check-menu', name: 'Page check menu', icon: 'sample-logo-capture',
    config: { kind: 'rotating', layout: 'fan', radius: 1.8, startAngle: -180, sweep: 180, itemScale: 0.72, rotateOnOpen: 0 },
    items: [
      { name: 'back', label: 'Back', icon: 'back' },
      { name: 'delete-item', label: 'Delete item', icon: 'delete-scan' },
      { name: 'reset-crop', label: 'Reset crop', icon: 'reset-crop' },
      { name: 'rotate-left', label: 'Rotate left', icon: 'rotate-left' },
      { name: 'rotate-right', label: 'Rotate right', icon: 'rotate-right' },
      { name: 'auto-crop', label: 'Auto crop', icon: 'auto-crop' },
      { name: 'approve-item', label: 'Approve item', icon: 'approve-scan' }
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
  },
  // Hub menus: an infinitely scrolling bar of 3 visible buttons (small left, DOUBLE-size centre, small right) over a ring of
  // 3+ root items. Click a side button: it swaps size and place with the centre button and, when it has sub items, they fan out
  // around the centre; sub items with sub items repeat that. A second click on the centre or a click outside goes back.
  {
    key: 'hub-menu-horizontal', name: 'Hub menu (horizontal)', icon: 'sample-logo-basic',
    config: { kind: 'hub', layout: 'fan', direction: 'horizontal', hubScale: 0.8, radius: 1.15, startAngle: -160, sweep: 140, itemScale: 0.4, gap: 0.2, rotateOnOpen: 0 },
    items: [
      { name: 'logo', label: 'Logo', icon: 'sample-logo-basic', children: [
        { name: 'profile', label: 'Profile', icon: 'profile' },
        { name: 'settings', label: 'Settings', icon: 'settings' },
        { name: 'feedback', label: 'Feedback', icon: 'feedback' }
      ] },
      { name: 'home', label: 'Home', icon: 'home' },
      { name: 'search', label: 'Search', icon: 'search' },
      { name: 'share', label: 'Share', icon: 'share', children: [
        { name: 'sync', label: 'Sync', icon: 'sync' },
        { name: 'view', label: 'View', icon: 'eye' }
      ] },
      { name: 'menu', label: 'Menu', icon: 'menu', children: [
        { name: 'profile', label: 'Profile', icon: 'profile' },
        { name: 'notifications', label: 'Notifications', icon: 'notifications', children: [
          { name: 'announcements', label: 'Announcements', icon: 'announcement' },
          { name: 'feedback', label: 'Feedback', icon: 'feedback' }
        ] },
        { name: 'settings', label: 'Settings', icon: 'settings' },
        { name: 'logout', label: 'Log out', icon: 'logout' }
      ] }
    ]
  },
  {
    key: 'hub-menu-vertical', name: 'Hub menu (vertical)', icon: 'sample-logo-basic',
    config: { kind: 'hub', layout: 'fan', direction: 'vertical', hubScale: 0.8, radius: 1.15, startAngle: -70, sweep: 140, itemScale: 0.4, gap: 0.2, rotateOnOpen: 0 },
    items: [
      { name: 'logo', label: 'Logo', icon: 'sample-logo-basic', children: [
        { name: 'profile', label: 'Profile', icon: 'profile' },
        { name: 'settings', label: 'Settings', icon: 'settings' },
        { name: 'feedback', label: 'Feedback', icon: 'feedback' }
      ] },
      { name: 'home', label: 'Home', icon: 'home' },
      { name: 'search', label: 'Search', icon: 'search' },
      { name: 'share', label: 'Share', icon: 'share', children: [
        { name: 'sync', label: 'Sync', icon: 'sync' },
        { name: 'view', label: 'View', icon: 'eye' }
      ] },
      { name: 'menu', label: 'Menu', icon: 'menu', children: [
        { name: 'profile', label: 'Profile', icon: 'profile' },
        { name: 'notifications', label: 'Notifications', icon: 'notifications', children: [
          { name: 'announcements', label: 'Announcements', icon: 'announcement' },
          { name: 'feedback', label: 'Feedback', icon: 'feedback' }
        ] },
        { name: 'settings', label: 'Settings', icon: 'settings' },
        { name: 'logout', label: 'Log out', icon: 'logout' }
      ] }
    ]
  }
];
