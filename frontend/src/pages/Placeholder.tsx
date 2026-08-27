import type { NavItem } from '@/app/nav'
import { Card, EmptyState, Badge } from '@/components/ui'

/**
 * Stand-in for a module whose real screen ships in a later phase. Driven by the
 * nav entry so the title/icon/blurb stay consistent with the sidebar.
 */
export default function Placeholder({ item }: { item: NavItem }) {
  return (
    <Card>
      <EmptyState
        icon={item.icon}
        title={item.label}
        description={item.blurb}
        action={<Badge tone="muted">Planned for {item.phase}</Badge>}
      />
    </Card>
  )
}
