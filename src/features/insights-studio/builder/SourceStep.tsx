import { useMemo, useState } from 'react'
import { datasetsByModule, type DatasetDef } from '@goms/domain'

/** Step 1: choose the ONE data source the visual reads. Only sources the user can read are offered. */
export function SourceStep({ datasets, selected, onPick }: { datasets: DatasetDef[]; selected?: string; onPick: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = term ? datasets.filter((d) => `${d.label} ${d.module} ${d.description}`.toLowerCase().includes(term)) : datasets
    return datasetsByModule(matching)
  }, [datasets, search])
  return (
    <section aria-label="Select a data source">
      <div className="studio-toolbar">
        <input type="search" aria-label="Search data sources" placeholder="Search data sources…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="studio-chip">Every field of the visual will come from the source you pick.</span>
      </div>
      {!groups.length && <div className="studio-empty">No data source matches.</div>}
      {groups.map((group) => (
        <section key={group.module} aria-label={group.module}>
          <h2 className="studio-section-title">{group.module}</h2>
          <div className="studio-grid-cards">
            {group.datasets.map((d) => (
              <button key={d.id} type="button" className="studio-card studio-source" aria-pressed={d.id === selected} onClick={() => onPick(d.id)} aria-label={`Use ${d.label}`}>
                <h3>{d.label}</h3>
                <p>{d.description}</p>
                <div className="studio-meta">
                  <span className="studio-chip studio-chip-accent">{d.module}</span>
                  <span className="studio-chip">{d.fields.length} fields</span>
                  {(d.suggestions?.length ?? 0) > 0 && <span className="studio-chip">{d.suggestions!.length} suggested visuals</span>}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
