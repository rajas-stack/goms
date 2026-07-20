import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'

export function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span className="eyebrow">Error 404</span>
      <h1 className="text-2xl font-semibold text-ink-900">This record isn’t in the registry.</h1>
      <Link to="/map">
        <Button variant="primary"><Icon name="ArrowLeft" size={15} /> Back to the map</Button>
      </Link>
    </div>
  )
}
