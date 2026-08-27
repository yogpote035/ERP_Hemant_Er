import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="That route doesn’t exist. It may have moved, or you followed a stale link."
        action={
          <Link to="/" className="btn btn-primary">
            Back to dashboard
          </Link>
        }
      />
    </div>
  )
}
