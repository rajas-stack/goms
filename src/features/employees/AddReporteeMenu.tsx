import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuItem } from '@/components/ui/Menu'

/** "Add Reportee" trigger with a choice of direction: a junior who reports to
 *  this person, or a manager this person reports to. Both directions reuse
 *  the same EmployeeFormDialog — only how the new person's manager link is
 *  wired differs, handled by the caller. */
export function AddReporteeMenu({ onChoose }: { onChoose: (mode: 'junior' | 'manager') => void }) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <Button variant="primary" size="sm" onClick={toggle}>
          <Icon name="Plus" size={14} /> Add Reportee
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Icon name="ArrowUp" size={15} />} onClick={() => { close(); onChoose('manager') }}>
            Add Reporting Manager
          </MenuItem>
          <MenuItem icon={<Icon name="ArrowDown" size={15} />} onClick={() => { close(); onChoose('junior') }}>
            Add Junior
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
