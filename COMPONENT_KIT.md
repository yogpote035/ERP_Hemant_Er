# COMPONENT_KIT.md — CRM_Core Shared Component Reference

> Canonical reference for the shared UI kit in `src/components/`. Generated from the actual source.
> **Rule: reuse these. Never hand-roll a local copy. To add a variant, extend the shared component with a prop — don't fork it.**
> Conventions: `@/` import alias · `darkMode: 'class'` (add dark variants to every new element) · lucide-react icons · Tailwind tokens `primary/secondary/success/warning/danger/info` · Inter font · `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-danger` button classes.

Legend: ✅ reuse as-is · ⚠️ minor gap · ❌ missing

---

## Overlays & dialogs

### Drawer ✅ — `@/components/Drawer` (default)
Right-side slide-in, portaled to body, Esc + backdrop close, **built-in maximize/minimize toggle**. **Default for detail/record views and substantial forms.**
Props: `isOpen, onClose, title, subtitle?, children, size?('sm'|'md'|'lg'|'xl'=md), maximizable?(=true), defaultMaximized?(=false)`
```tsx
import Drawer from '@/components/Drawer'
<Drawer isOpen={open} onClose={close} title="Acme Corp" subtitle="Account · Manufacturing" size="lg" maximizable>…</Drawer>
```
Used in 31 files (module detail pages, automation step config, calendar, emails, contacts…).

### Modal ✅ — `@/components/Modal` (default)
Center dialog. **Short, single-purpose content only.** Record-sized/multi-section → use Drawer.
Props: `isOpen, onClose, title, children, size?('sm'|'md'|'lg'=md)`

### ConfirmDialog ✅ — `@/components/ConfirmDialog` (default)
Destructive/confirmation dialog with icon + colored button.
Props: `isOpen, onClose, onConfirm, title, message, confirmText?(=Confirm), cancelText?(=Cancel), type?('danger'|'warning'|'info'=danger)`

### PromptDialog ✅ — `@/components/PromptDialog` (default)
Single text-input dialog with validation.
Props: `isOpen, onClose, onConfirm(value:string)=>void, title, message?, placeholder?, defaultValue?, validate?(value)=>string|null`

---

## Inputs & pickers

### SearchableDropdown ✅ — `@/components/SearchableDropdown` (default)
Premium combobox: type-to-filter, **↓/↑ nav, Enter select, Esc close**, scroll-into-view, clear button, icons + descriptions, keyboard-hint footer. **Replaces every raw `<select>`.**
Props: `value, onChange(value), options:DropdownOption[], placeholder?, searchPlaceholder?, emptyMessage?, clearable?(=true), disabled?, className?, size?('sm'|'md'=md)`
`DropdownOption = { value, label, description?, icon?, iconColor? }`
```tsx
import SearchableDropdown, { DropdownOption } from '@/components/SearchableDropdown'
<SearchableDropdown value={accId} onChange={setAccId} options={opts} placeholder="Select account…" clearable />
```
Used in 18 files. **~33 files still use raw `<select>` — migration candidates (see end).**

### InlineEdit ✅ — `@/components/InlineEdit` (default)
Click-to-edit cell (text/number/select/etc.) with validation; great in tables.
Props: `value:string|number, type?, options?(for select), onSave(next:string), renderDisplay?, validate?, className?`

### TagPicker ✅ — `@/components/TagPicker` (default)
Tag input with create + autocomplete, integrates the tag system.
Props: `value:string[], onChange(tagNames:string[]), placeholder?, disableCreate?, compact?, size?('xs'|'sm'), max?`

### CustomFieldInput ✅ — `@/components/CustomFieldInput` (default)
Renders a single custom field by its type; `CustomFieldsSection` renders a whole set.
Props: `field:CustomField, value:any, onChange(next:any)` (+ `fields, values` for the section).

### MentionInput ✅ — `@/components/MentionInput` — `@`-mention textarea. Props: `value, onChange(val), users:MentionUser[], onMention?`
### RichTextEditor ✅ — `@/components/RichTextEditor` — HTML editor, optional mentions. Props: `value, onChange(html), users?, onMention?, placeholder?, minHeight?, toolbar?('minimal'|'full'), autoFocus?`
### RecipientInput ✅ — `@/components/RecipientInput` — email chips w/ autocomplete. Props: `value:string[], onChange(emails), placeholder?, label?, showAutocomplete?`
### OTPInput ✅ — `@/components/OTPInput` — segmented OTP entry.
### AvatarUploader ✅ — `@/components/AvatarUploader` — avatar crop/upload.
### RecurrenceSelector ✅ — `@/components/RecurrenceSelector` — RRULE-style recurrence builder.

---

## Tables, lists & data ops

### SortableHeader ✅ — `@/components/SortableHeader` — sortable `<th>`. Props: `field, label, sort:SortState, onSort(field)`. Exports `SortDirection`, `SortState`.
### Pagination ✅ — `@/components/Pagination` — page nav + page-size. Props: `currentPage, totalItems, pageSize, onPageChange(page), onPageSizeChange(size)`.
### BulkActionBar ✅ — `@/components/BulkActionBar` — floating multi-select toolbar. Props: `selectedCount, onClear, onDelete, onExport?, onEmail?, customActions?[]`.
### BulkEditDrawer ✅ — `@/components/BulkEditDrawer` — edit fields across selected rows. Props: `isOpen, onClose, selectedCount, entityLabel, fields:BulkEditableField[], onApply`.
### ColumnCustomizer ✅ — `@/components/ColumnCustomizer` — show/hide/reorder columns. Props: `isOpen, onClose, entity, allColumns, defaultOrder`.
### AdvancedFilters ✅ — `@/components/AdvancedFilters` — multi-condition filter builder w/ saved filter sets.
### SavedViewsDropdown ✅ — `@/components/SavedViewsDropdown` — save/apply filter+sort+pagesize views. Props: `entity, currentFilters, currentSort?, currentPageSize?, onApplyView, onClearView?, activeViewId?`.
### KanbanBoard ✅ — `@/components/KanbanBoard` — drag pipeline board. Props: `deals:Deal[], onCardClick?, pipeline?`.

---

## Feedback & state

### Toast (ToastContainer) ✅ — `@/components/Toast` — mounted once; **dispatch via `useNotificationStore().addNotification({type,title,message})`** (`type: success|error|warning|info`). Don't build new toasts.
### EmptyState ✅ — `@/components/EmptyState` — icon + message + optional CTA(s). Props include `onAction?` and `EmptyStateAction`.
### Skeleton ✅ — `@/components/Skeleton` — loading placeholder. Props: `variant?('text'|'circle'|'rect'), width?, height?, count?`.
### Tooltip ✅ — `@/components/Tooltip` — hover tooltip. Props: `content, children, position?('top'|'bottom'|'left'|'right'=top), delay?(=300)`.
### ActionMenu ✅ — `@/components/ActionMenu` — `⋯` row menu. Props: `items:{label,icon,onClick,danger?}[]`.

---

## Global / app-shell

### CommandPalette ✅ — `@/components/CommandPalette` (default)
**App-wide global search + command menu.** ⌘K/Ctrl+K open, Esc close, ↓/↑ + Enter, grouped Navigation/Quick Actions/Records from entity stores. Mounted once at root.
**Add a new module:** extend the `allItems` useMemo — add a `navs` entry + a `records.slice(0,20)` block reading that module's store (follow the account/contact/lead/deal/task pattern). Never build a parallel search.

### HelpDrawer ✅ — `@/components/HelpDrawer` (default)
The Help Center. Searchable articles, categories, popular flags, reader w/ back nav, support footer. Props: `isOpen, onClose`. **Add help content** by appending to its `ARTICLES` array `{id,title,category,body,popular?}`.

### NotificationCenter ✅ — `@/components/NotificationCenter` — bell dropdown of typed notifications (mention/deal/lead/meeting/reminder/system).
### OnboardingTour ✅ — `@/components/OnboardingTour` — spotlight step tour (selector-anchored, per-route).
### Sidebar ✅ — `@/components/Sidebar` · ### TopBar ✅ — `@/components/TopBar` · ### Layout ✅ — `@/components/Layout` (app shell).
### UserSwitcher ✅ — `@/components/UserSwitcher` — dev role switcher (Admin/Manager/Sales Rep/Support/Viewer).

---

## Permissions & access (RBAC)

### Can ✅ — `@/components/Can` — gate by resource+action; supports render-prop for level-aware UI. Props: `resource, action, children|((level)=>node), fallback?, strict?`.
### Entitled ✅ — `@/components/Entitled` — gate by plan feature. Props: `feature, children, fallback?, inline?`.
### RouteGuard ✅ — `@/components/RouteGuard` — block a route by resource. Props: `resource, children, redirectTo?(='/')`.
### ViewScopeFilter ✅ — `@/components/ViewScopeFilter` — mine/team/all scope toggle. Exports `ViewScope`.
### usePermission ✅ — `@/hooks/usePermission` — `level(resource,action)`, `can(...)`. Also `useListPageGates`, `useEntityFields`.

---

## Domain panels (settings/detail surfaces — reuse, don't rebuild)
ActivityTimeline, CustomerJourney, ActivityHeatmap, LeadScoreBreakdown, ScoringRulesPanel, DashboardWidget, PipelinesPanel, PermissionsPanel, TeamPanel, PlansBillingPanel, StoragePanel, StorageUsageBar, SignatureManager, TemplateManager, ApiTokensPanel, WebhooksPanel, AuditLogPanel, CompliancePanel, SecurityPanel, NotificationPreferences, TwoFactorSetupDrawer, ImportWizard, AttachmentsPanel, AttachmentPreview, FormFileSection, CustomFieldsBuilder, GlobalTagSearch, TagsManager, EmailVariablePicker, SnoozePopover, OwnerBadge.

## Forms — `@/components/forms/*`
`AccountForm, ContactForm, LeadForm, DealForm, TaskForm, ActivityForm` — open these inside a `<Drawer>`.

---

---

## Excel / CSV import journey ✅ (reusable — `ImportWizard` + `importParser`)

A complete drop-file → preview → auto-map → validate → confirm → result flow. **Reuse this for every entity that needs import. Do not build a new importer.** Already wired into Accounts, Contacts, and Leads list pages.

### ImportWizard — `@/components/ImportWizard` (default; named export `ImportField`)
Renders as a **Drawer** with 6 steps: `upload → preview → map → validate → confirm → result`. Drag-drop or browse, auto-maps columns to your fields, lets the user remap, validates per-field with skip-errors option, then calls `onImport` with clean rows. Pushes toasts via `useNotificationStore`.
Props:
```ts
ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  entityType: 'account' | 'contact' | 'lead'   // ⚠️ hardcoded union — see gap below
  entityLabelSingular?: string                  // override for industry-pack terms ("client")
  entityLabelPlural?: string
  fields: ImportField[]                         // the target CRM fields
  onImport: (rows: Record<string, any>[]) => void
}
ImportField {
  key: string
  label: string
  required: boolean
  type: 'text' | 'email' | 'phone' | 'number' | 'date' | 'url'
  example?: string
  validate?: (val: string) => string | null    // custom per-field validator
}
```
Usage (real callsite pattern):
```tsx
import ImportWizard, { ImportField } from '@/components/ImportWizard'

const contactImportFields: ImportField[] = [
  { key: 'first_name', label: 'First Name', required: true,  type: 'text',  example: 'Jane' },
  { key: 'email',      label: 'Email',      required: true,  type: 'email', example: 'jane@acme.com' },
  { key: 'phone',      label: 'Phone',      required: false, type: 'phone', example: '+1 555 234 5678' },
]
const handleImport = (rows: Record<string, any>[]) => {
  rows.forEach((row) => addContact({ first_name: row.first_name || '', email: row.email || '', /* … */ }))
  notify.success('Import complete', `${rows.length} contacts imported`)
}

<ImportWizard isOpen={showImport} onClose={() => setShowImport(false)}
  entityType="contact" entityLabelPlural="contacts"
  fields={contactImportFields} onImport={handleImport} />
```

### importParser — `@/utils/importParser`
The parsing/mapping engine behind the wizard (uses **ExcelJS** for .xlsx/.xls and **PapaParse** for .csv). Reuse these directly if you need parsing outside the wizard.
```ts
parseImportFile(file: File): Promise<ParsedFile>          // detects xlsx/xls/csv, returns headers+rows
ParsedFile { headers: string[]; rows: string[][]; totalRows: number; fileType: 'xlsx'|'xls'|'csv' }
autoMapColumns(excelHeaders, crmFields: {key,label}[]): Record<string,string>   // fuzzy header→field map
downloadTemplate(...)                                      // generates a starter file for the entity
validators                                                 // shared field validators (email, phone, …)
```

### How to add import to a NEW entity (reuse pattern)
1. Define `fields: ImportField[]` for the entity (key/label/required/type/example, + optional `validate`).
2. Add an **Import** button on the list page that opens `<ImportWizard>` with those fields.
3. Implement `onImport(rows)` to push rows into the entity's Zustand store, then toast success.
4. Reuse `downloadTemplate`/`autoMapColumns` as-is — no new parser.

### ⚠️ Gap to fix for true reuse
`ImportWizard.entityType` is a **hardcoded union (`'account'|'contact'|'lead'`)**, and `downloadTemplate` likely keys off it. To make the wizard reusable for *any* module (deals, tasks, real-estate properties, job-work inward, etc.), widen `entityType` to `string` (or accept a `templateKey`/`templateColumns` prop) so new entities can plug in without editing the component. Until then, new entities can still reuse it by passing one of the three existing keys, but that's a leak. **Recommend: generalize `entityType` to `string` + optional `templateColumns`.**

---

## ⚠️ The one real gap: raw `<select>` → SearchableDropdown
~33 files still use raw `<select>`. Migrate **user-facing** ones (forms in `components/forms/*`, filters, pickers) to `SearchableDropdown`. Skip trivial internal ones (e.g. 2-option page-size in Pagination) and note skips here.
Known offenders to review: `forms/{Account,Contact,Deal,Task}Form`, `CustomFieldInput`, `CustomFieldsBuilder`, `PermissionsPanel`, `ScoringRulesPanel`, `TeamPanel`, `TemplateManager`, `RecurrenceSelector`, `AuditLogPanel`, `ApiTokensPanel`, `ImportWizard`, `automation/StepConfigDrawer`, `automation/TestModePanel`, `InlineEdit` (select type), `BulkEditDrawer`.

## Suggested barrel — `src/components/index.ts`
Re-export the primitives so screens can `import { Drawer, Modal, SearchableDropdown, ConfirmDialog, PromptDialog, EmptyState, Skeleton, Tooltip, Pagination, SortableHeader, ActionMenu, BulkActionBar } from '@/components'`. Keep existing deep imports working.
