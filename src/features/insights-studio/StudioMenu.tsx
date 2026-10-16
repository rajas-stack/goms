import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Tooltip } from '@/components/ui/Tooltip'
import { STUDIO_PATHS } from './paths'

/** The Insights page's settings gear: opens Insights Studio (visualization components, report templates, data sources).
 *  Router-only on purpose — it renders inside the Insights header and needs no data of its own. */
export function StudioMenu() {
  const navigate = useNavigate()
  return (
    <Menu
      align="end"
      trigger={({ open, toggle }) => (
        <Tooltip label="Insights studio" side="bottom">
          <button type="button" aria-label="Insights studio" aria-haspopup="menu" aria-expanded={open} onClick={toggle} className="insight-icon-button">
            <Icon name="Settings" size={15} />
          </button>
        </Tooltip>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Icon name="BarChart3" />} onClick={() => { close(); navigate(STUDIO_PATHS.visuals) }}>
            Visualization components
          </MenuItem>
          <MenuItem icon={<Icon name="LayoutGrid" />} onClick={() => { close(); navigate(STUDIO_PATHS.reports) }}>
            Templates / Reports
          </MenuItem>
          <MenuItem icon={<Icon name="Database" />} onClick={() => { close(); navigate(STUDIO_PATHS.dataSources) }}>
            Data sources
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
