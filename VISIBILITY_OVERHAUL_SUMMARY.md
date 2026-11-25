# Source Visibility Controls Overhaul - Implementation Summary

## Overview
Complete refactor of source visibility controls in Openmag, replacing checkboxes with elegant dot-based indicators and improving touch accessibility.

## Key Changes

### 1. Visual Design
- **Source Lists**: Replaced checkboxes + count badges with simple dots on the right
  - Theme color dot (blue) = source displayed
  - Grey dot = source hidden
  - Hidden source names shown in lighter tone
  - Removed article count display (kept in code for future use)

- **Article Cards**: Replaced card-level checkbox with dot
  - Positioned between source name and date in meta-info
  - Same color logic as sidebar dots
  - Maintains same functionality as before

- **Topic Rows**: Replaced minus sign with smart dot
  - Theme color = all sources in topic displayed
  - Grey dot = all sources hidden
  - Divided dot (gradient) = mixed state (some displayed, some hidden)
  - Mixed state dot click displays all sources for that topic

- **Source Page**: Added visibility icon beside RSS icon
  - Eye icon using SVG
  - Same color system (primary when visible, grey when hidden)
  - Maintains hover/focus effects

### 2. HTML Structure

#### Sidebar Items
```html
<div class="source-item" data-visible="true|false">
  <div class="source-item-name">Source Name</div>
  <button class="visibility-toggle" data-preference-source="Name">
    <div class="visibility-dot"></div>
  </button>
</div>
```

#### Category Headers
```html
<div class="category-header">
  <div>Category Name</div>
  <button class="visibility-toggle" data-preference-topic="Category">
    <div class="visibility-dot"></div>
  </button>
</div>
```

#### Article Meta-Info
```html
<div class="meta-info">
  <span class="source-trigger">Source Name</span>
  <button class="card-visibility-toggle" data-preference-source="Name">
    <div class="visibility-dot"></div>
  </button>
  <span>Date/Time</span>
</div>
```

#### Source Page Header
```html
<button class="source-page-visibility-toggle" data-preference-source="Name">
  <svg><!-- Eye icon --></svg>
</button>
```

### 3. CSS Updates
- New `.visibility-toggle` class for all dot buttons
- `.visibility-dot` base styling (8px circle)
- Color states: `data-visible="true"` (blue), `data-visible="false"` (grey), `data-visible="mixed"` (gradient)
- `.source-item-name` for text truncation
- `.card-visibility-toggle` for smaller dots on cards (6px)
- `.source-page-visibility-toggle` for icon buttons
- `.visibility-confirmation-row` for touch confirmation UI
- Focus states for keyboard navigation

### 4. JavaScript Updates

#### New Functions
- `createVisibilityToggle(name, isTopic)`: Creates dot button instead of checkbox
- `updateVisibilityToggle(toggle, state)`: Updates dot appearance based on state
- `showTouchConfirmation(button, sourceName, isTopic, onConfirm)`: Displays confirmation UI for touch devices
- `isTouchDevice()`: Detects touch-capable devices

#### Modified Functions
- `syncSourceControls()`: Updated to work with buttons instead of checkboxes
  - Updates all `[data-preference-source]` and `[data-preference-topic]` elements
  - Handles mixed state for topics
  - Updates sidebar item visibility styling
  
- `renderCategoryView()` and `renderAZView()`: 
  - Now create source-item-name divs for proper text handling
  - Use `createVisibilityToggle()` instead of `createPreferenceControl()`
  - Prevent dot clicks from triggering source selection

- `createArticleCard()`:
  - Adds visibility dot between source name and date
  - Removed old card-source-switch checkbox

- `setViewTitleAndRss()`:
  - Added visibility toggle button before RSS icon
  - Shows confirmation UI on touch devices

#### Accessibility
- All buttons have `aria-label` attributes with translated text
- Keyboard navigation: Enter and Space keys work on all toggles
- Keyboard activation bypasses touch confirmation (always immediate)
- Focus outline styling for visibility

### 5. Touch Experience
On touch devices:
- Tapping a visibility dot opens a confirmation row
- Confirmation row appears below the item (sidebar) or card
- Shows action description and "Apply" / "Cancel" buttons
- Clicking "Apply" confirms the visibility change
- Clicking "Cancel" closes the confirmation without changing anything
- Keyboard users always get immediate toggle (no confirmation)

### 6. Translations
Added new translation keys to `translations.json`:
- `ui.hide_source` - "Hide this source"
- `ui.display_source` - "Display this source"
- `ui.hide_topic` - "Hide this topic"
- `ui.display_topic` - "Display this topic"

These keys are used for ARIA labels and confirmation UI text.

### 7. Data Attributes
All visibility controls use these data attributes for state:
- `data-preference-source="SourceName"` - Source-level toggle
- `data-preference-topic="TopicName"` - Topic-level toggle
- `data-visible="true|false|mixed"` - Current visibility state
- Buttons also include `data-source` for redundancy

### 8. Backwards Compatibility
- All existing data attributes retained for test compatibility
- Local preferences persist (uses same localStorage key)
- All existing behaviors preserved:
  - Filtering by language/region still works
  - Bookmarks still work
  - Source page previews unchanged
  - Article count kept in code (not displayed)

## Testing Updates

### Test Modifications
- Changed assertions from `.checked` property to `.getAttribute('data-visible')`
- Updated selectors to find buttons instead of input elements
- Verified localStorage interactions still work
- Touch and keyboard behaviors tested separately

### Manual Testing Checklist
- [ ] Desktop: Click dots to toggle visibility
- [ ] Desktop: Category dots show correct mixed state
- [ ] Touch: Tapping dots shows confirmation UI
- [ ] Touch: Confirm button applies changes
- [ ] Touch: Cancel button closes without changing
- [ ] Keyboard: Tab navigation to all dots
- [ ] Keyboard: Enter/Space toggles immediately (no confirmation)
- [ ] Source page: Visibility icon works correctly
- [ ] All dots update when preferences change
- [ ] Sidebar source names gray out when hidden
- [ ] Preferences persist after page reload
- [ ] Language filtering still works with visibility
- [ ] Bookmarks functionality unaffected

## Files Modified
1. `app.js` - Core visibility logic and UI creation
2. `style.css` - New dot styles and confirmation UI styling
3. `source-preferences.browser.test.js` - Updated test assertions
4. `translations.json` - Already had the new keys

## Browser Compatibility
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Touch device detection covers all major platforms
- CSS gradients for mixed state (supported in all modern browsers)
- SVG icons with currentColor fill (fully supported)

## Performance Impact
- Minimal: dots are simpler DOM elements than checkboxes
- No additional network requests
- Same preference storage mechanism
- Touch confirmation UI only created when needed

## Future Enhancements
1. Animation when dots change color (ease transition)
2. Swipe gesture support for touch devices
3. Tooltip showing number of articles if desired
4. Bulk operations (hide all in category with one confirmation)
5. Undo/redo for visibility changes
