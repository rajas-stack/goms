import { useMemo, useState } from 'react'
import { css } from './css'
import {
  FIELD_SCOPE_OPTIONS, ICON, LEVELS, SCOPE_OPTIONS, SENS, TEAMS, initialState, levelAllowed, levelRestrictionNote, pageScope, selectLevel, selectTeam, summarize,
  type MatrixState, type Overrides,
} from './matrixModel'

// Port of the "Access Matrix" design. Styles are the design's own inline CSS (via css()), the copy and layout are
// unchanged, and every permission shown comes from the generated RBAC policy through matrixModel.ts.

const STYLE = `
.am-root{min-height:100%;background:#FAFAF7;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#0F2942}
.am-root button{font-family:inherit}
.am-root a{color:#2F6FBF}.am-root a:hover{color:#245A9E}
@keyframes am-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.am-row:hover{background:#F7F8FB !important}
.am-group:hover{background:#F1F3F7 !important}
.am-discard:hover{background:rgba(255,255,255,.1) !important}
.am-save:hover{background:#8ACF73 !important}
.am-save:active{transform:scale(.97)}
`

const PC = ['#7A889B', '#2A7F6F', '#0B2B49']
const sel = (on: boolean) => (on ? 'background:#0B2B49;color:#fff;border-color:#0B2B49' : 'background:#fff;color:#1E3A5F;border-color:#DDE3EC')
const seg = (on: boolean) => 'position:relative;z-index:1;border:0;background:transparent;cursor:pointer;font-size:12px;font-weight:600;transition:color .2s;color:' + (on ? '#fff' : '#5C6B80')
const tab = (on: boolean) => 'height:28px;padding:0 12px;border:0;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:500;transition:all .2s;white-space:nowrap;' + (on ? 'background:#fff;color:#0B2B49;box-shadow:0 1px 3px rgba(15,41,66,.15)' : 'background:transparent;color:#5C6B80')
const GRID = 'minmax(0,1fr) 192px 150px 96px'

export function AccessMatrix() {
  const [state, setState] = useState<MatrixState>(initialState)
  const { team, lvl, mode } = state
  const { who, pages, nOk, changes } = useMemo(() => summarize(state), [state])
  const set = (patch: Partial<MatrixState>) => setState((s) => ({ ...s, ...patch }))
  const setOv = (key: string, patch: { view?: boolean; edit?: boolean; scope?: string }) =>
    setState((s) => ({ ...s, ov: { ...s.ov, [key]: { ...(s.ov[key] || {}), ...patch } } }))
  const isEdit = mode === 'edit'
  const isPreview = mode === 'preview'

  return (
    <div className="am-root h-full overflow-auto">
      <style>{STYLE}</style>
      <div style={css('padding:28px 32px 110px;max-width:1080px;margin:0 auto')}>
        <div style={css('display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px')}>
          <div style={css('flex:1;min-width:260px')}>
            <h1 style={css('margin:0;font-size:20px;font-weight:600')}>Role &amp; Access Management</h1>
            <p style={css('margin:2px 0 0;font-size:13.5px;color:#5C6B80')}>Access is set per field as Denied, Read or Edit. Page rows only summarise their fields. System Admins are managed separately.</p>
          </div>
        </div>

        <div style={css('display:flex;gap:18px;flex-wrap:wrap;margin:-4px 0 14px;font-size:12.5px;color:#5C6B80')}>
          <span><b style={css('font-weight:600;color:#7A889B')}>Denied</b> field is completely hidden</span>
          <span><b style={css('font-weight:600;color:#2A7F6F')}>Read</b> visible, cannot be changed</span>
          <span><b style={css('font-weight:600;color:#0B2B49')}>Edit</b> visible and can be changed</span>
          <span><b style={css('font-weight:600;color:#4453C4')}>Scope</b> which records it applies to; not set when Denied</span>
        </div>

        <div style={css('background:#fff;border:1px solid #DDE3EC;border-radius:14px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(15,41,66,.04),0 8px 24px rgba(15,41,66,.06)')}>
          <div style={css('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
            <span style={css('width:44px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5C6B80')}>Team</span>
            <div style={css('display:flex;gap:6px;flex-wrap:wrap;flex:1')}>
              {TEAMS.map((t) => (
                <button key={t} onClick={() => setState((s) => selectTeam(s, t))} style={css('height:30px;padding:0 13px;white-space:nowrap;border-radius:8px;border:1px solid;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s;' + sel(t === team))}>{t}</button>
              ))}
            </div>
          </div>
          <div style={css('display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px')}>
            <span style={css('width:44px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5C6B80')}>Level</span>
            <div style={css('display:flex;gap:6px;flex-wrap:wrap;flex:1')}>
              {LEVELS.map((l, i) => (
                <button
                  key={l[0]}
                  disabled={!levelAllowed(team, i)}
                  title={levelAllowed(team, i) ? undefined : levelRestrictionNote(team) ?? undefined}
                  onClick={() => setState((s) => selectLevel(s, i))}
                  style={css('height:30px;padding:0 12px;white-space:nowrap;border-radius:8px;border:1px solid;font-size:13px;transition:all .2s;' + (levelAllowed(team, i) ? 'cursor:pointer;' + sel(i === lvl) : 'cursor:not-allowed;opacity:.45;background:#F1F3F7;color:#7A889B;border-color:#DDE3EC'))}
                ><b style={css('font-weight:600')}>{l[0]}</b> {l[1]}</button>
              ))}
            </div>
          </div>
          {levelRestrictionNote(team) && (
            <div role="note" style={css('margin:8px 0 0 56px;font-size:12.5px;color:#5C6B80')}>{levelRestrictionNote(team)}</div>
          )}
        </div>

        <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap')}>
          <div style={css('font-size:15px;font-weight:600')}>{who}</div>
          <div style={css('font-size:13px;color:#5C6B80;display:flex;gap:6px;align-items:center;white-space:nowrap')}>
            <span>{pages.length} pages</span><span>·</span><span style={css('color:#26744A;font-weight:500')}>{nOk} accessible</span><span>·</span><span style={css('color:#B23A48;font-weight:500')}>{pages.length - nOk} denied</span>
          </div>
        </div>

        <div style={css('background:#fff;border:1px solid #DDE3EC;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,41,66,.04),0 8px 24px rgba(15,41,66,.06)')}>
          <div style={css('display:grid;grid-template-columns:minmax(0,1.6fr) 120px 120px 150px 28px;gap:12px;align-items:center;padding:0 18px;height:38px;background:#F1F3F7;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5C6B80')}>
            <div>Page</div><div title="Fields set to Read or Edit (visible)">Read</div><div title="Fields set to Edit (visible and changeable)">Edit</div><div title="Default scope for visible fields">Scope</div><div></div>
          </div>
          {pages.map(({ page: p, pdef, nOv, v, e, n, isOpen, cats }) => (
            <div key={p.id} style={css('border-top:1px solid #EEF1F6')}>
              <button
                className="am-row"
                onClick={() => set({ open: isOpen ? null : p.id })}
                style={css('display:grid;grid-template-columns:minmax(0,1.6fr) 120px 120px 150px 28px;gap:12px;align-items:center;width:100%;padding:0 18px;height:52px;border:0;background:' + (isOpen ? '#F7F8FB' : '#fff') + ';cursor:pointer;text-align:left;transition:background .15s;opacity:' + (v === 0 ? 0.7 : 1))}
              >
                <div style={css('display:flex;align-items:center;gap:10px;min-width:0')}>
                  <div style={css('width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:none;transition:all .2s;' + (isOpen ? 'background:#0B2B49;color:#4CA7DD' : 'background:#F1F3F7;color:#4453C4'))}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[p.id]}></path></svg>
                  </div>
                  <span style={css('font-size:14px;font-weight:600;color:#0F2942')}>{p.name}</span>
                </div>
                <div style={css('text-align:left')}>
                  {v > 0 && <span style={css('display:inline-flex;align-items:center;gap:6px')}><span style={css('color:#2F8F5B;font-weight:700')}>✓</span><span style={css('font-size:12.5px;color:#5C6B80')}>{v + ' of ' + n}</span></span>}
                  {v === 0 && <span style={css('font-size:12px;font-weight:600;padding:2px 9px;border-radius:10px;background:#F6E0E3;color:#B23A48')}>Denied</span>}
                </div>
                <div style={css('text-align:left')}>
                  {e > 0 && <span style={css('display:inline-flex;align-items:center;gap:6px')}><span style={css('color:#245A9E;font-weight:700')}>✓</span><span style={css('font-size:12.5px;color:#5C6B80')}>{e + ' of ' + n}</span></span>}
                  {e === 0 && <span style={css('color:#A9B4C3;font-weight:600')}>—</span>}
                </div>
                <div style={css('font-size:13px;color:#1E3A5F;text-align:left')}>{v === 0 ? '—' : pdef + ' default'}<span style={css('font-size:11.5px;color:#4453C4;margin-left:6px')}>{v && nOv ? '· ' + nOv + (nOv === 1 ? ' field scope' : ' field scopes') : ''}</span></div>
                <span style={css('display:inline-block;color:#7A889B;font-size:12px;transition:transform .25s;transform:rotate(' + (isOpen ? 90 : 0) + 'deg)')}>▸</span>
              </button>
              <div style={css('display:grid;transition:grid-template-rows .35s cubic-bezier(.2,.8,.2,1);grid-template-rows:' + (isOpen ? '1fr' : '0fr'))}>
                <div style={css('overflow:hidden;min-height:0')}>
                  <div style={css('padding:4px 18px 18px 56px;background:#FBFBF9;border-top:1px solid #EEF1F6')}>
                    <div style={css('display:flex;align-items:center;gap:10px;padding:12px 0 4px')}>
                      <div style={css('font-size:13px;color:#5C6B80;flex:1')}>{(v - e) + ' Read · ' + e + ' Edit · ' + (n - v) + ' Denied (of ' + n + ' fields)'}</div>
                      <div style={css('display:flex;gap:2px;padding:3px;border-radius:9px;background:#F1F3F7;border:1px solid #DDE3EC')}>
                        <button onClick={() => set({ mode: 'edit' })} style={css(tab(isEdit))}>Set access</button>
                        <button onClick={() => set({ mode: 'preview' })} style={css(tab(isPreview))}>Preview as user</button>
                      </div>
                    </div>
                    {v > 0 && (
                      <div style={css('display:flex;align-items:center;gap:12px;margin:8px 0 2px;padding:10px 14px;border-radius:10px;background:#fff;border:1px solid #DDE3EC')}>
                        <span style={css('font-size:13px;font-weight:600')}>Default scope</span>
                        <select
                          value={pdef}
                          onChange={(ev) => setOv(team + '|' + lvl + '|' + p.id + '|scope', { scope: ev.target.value })}
                          style={css("height:30px;width:170px;border:1px solid #C9D1DD;border-radius:8px;background:#fff;font:600 13px 'IBM Plex Sans',sans-serif;color:#0B2B49;padding:0 6px")}
                        >
                          {SCOPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          {!SCOPE_OPTIONS.includes(pdef) && <option value={pdef}>{pdef}</option>}
                        </select>
                        <span style={css('font-size:12.5px;color:#5C6B80;flex:1')}>Fields set to Read or Edit inherit this unless overridden. Denied fields have no scope.</span>
                      </div>
                    )}
                    {isEdit && isOpen && (
                      <div style={css('margin-top:8px;border:1px solid #EEF1F6;border-radius:10px;background:#fff;overflow:hidden')}>
                        {cats.map((c, ci) => (
                          <div key={c.name} style={css(ci ? 'border-top:1px solid #EEF1F6' : '')}>
                            <button
                              className="am-group"
                              aria-expanded={c.isOpen}
                              aria-label={c.name + ' — ' + c.read + ' Read · ' + c.edit + ' Edit · ' + c.denied + ' Denied'}
                              onClick={() => setState((s) => ({ ...s, groups: { ...s.groups, [c.key]: !s.groups[c.key] } }))}
                              style={css('display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:10px;align-items:center;width:100%;min-height:42px;padding:0 14px;border:0;cursor:pointer;text-align:left;transition:background .15s;background:' + (c.isOpen ? '#F7F8FB' : '#fff') + ';opacity:' + (c.read + c.edit === 0 ? 0.7 : 1))}
                            >
                              <span style={css('display:inline-block;color:#7A889B;font-size:12px;transition:transform .25s;transform:rotate(' + (c.isOpen ? 90 : 0) + 'deg)')}>▸</span>
                              <span style={css('font-size:13px;font-weight:600;color:#1E3A5F')}>{c.name}</span>
                              <span style={css('font-size:12.5px;color:#5C6B80;white-space:nowrap')}>
                                <span style={css('font-weight:600;color:#2A7F6F')}>{c.read}</span> Read · <span style={css('font-weight:600;color:#0B2B49')}>{c.edit}</span> Edit · <span style={css('font-weight:600;color:#7A889B')}>{c.denied}</span> Denied
                              </span>
                            </button>
                            <div style={css('display:grid;transition:grid-template-rows .35s cubic-bezier(.2,.8,.2,1);grid-template-rows:' + (c.isOpen ? '1fr' : '0fr'))}>
                              <div style={css('overflow:hidden;min-height:0')}>
                                {c.isOpen && (
                                  <div style={css('padding:0 14px 8px;border-top:1px solid #EEF1F6')}>
                                    <div style={css('display:grid;grid-template-columns:' + GRID + ';gap:12px;padding:8px 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#7A889B')}><div>Field</div><div>Access</div><div>Scope</div><div>Sensitivity</div></div>
                                    {c.xs.map(({ f, x }) => (
                                      <div key={f.id} style={css('display:grid;grid-template-columns:' + GRID + ';gap:12px;align-items:center;padding:6px 0')}>
                                        <div style={css('min-width:0')}>
                                          <div style={css('font-size:13.5px;font-weight:500')}>{f.n}{' '}
                                            {x.over && (
                                              <button
                                                title="Undo change"
                                                onClick={() => setState((s) => { const n2: Overrides = { ...s.ov }; delete n2[x.key]; return { ...s, ov: n2 } })}
                                                style={css('border:0;background:#E7EAFC;color:#4453C4;font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;cursor:pointer;margin-left:4px')}
                                              >edited · undo</button>
                                            )}
                                          </div>
                                          {!x.view && <div style={css('font-size:12px;color:#B23A48;margin-top:1px')}>{x.note}</div>}
                                        </div>
                                        <div style={css('position:relative;display:grid;grid-template-columns:repeat(3,1fr);height:30px;padding:2px;border-radius:8px;background:#F1F3F7;border:1px solid #DDE3EC;box-sizing:border-box')}>
                                          <div style={css('position:absolute;top:2px;bottom:2px;left:2px;width:calc((100% - 4px)/3);border-radius:6px;transition:transform .4s cubic-bezier(.34,1.4,.64,1),background .25s;transform:translateX(' + (x.acc * 100) + '%);background:' + PC[x.acc])}></div>
                                          <button onClick={() => setOv(x.key, { view: false, edit: false })} title="Denied: field is completely hidden" style={css(seg(x.acc === 0))}>Denied</button>
                                          <button onClick={() => setOv(x.key, { view: true, edit: false })} title="Read: visible but cannot be changed" style={css(seg(x.acc === 1))}>Read</button>
                                          <button onClick={() => setOv(x.key, { view: true, edit: true })} title="Edit: visible and can be changed" style={css(seg(x.acc === 2))}>Edit</button>
                                        </div>
                                        <div>
                                          {x.view && (
                                            <select
                                              value={x.differs ? x.scope : ''}
                                              onChange={(ev) => setOv(x.key, { scope: ev.target.value || undefined })}
                                              style={css("height:30px;width:100%;border-radius:8px;font:13px 'IBM Plex Sans',sans-serif;padding:0 6px;" + (x.differs ? 'border:1px solid #5B6EE8;background:#E7EAFC;color:#4453C4;font-weight:600' : 'border:1px solid transparent;background:transparent;color:#7A889B'))}
                                            >
                                              <option value="">Inherited</option>
                                              {FIELD_SCOPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                          )}
                                        </div>
                                        <div style={css('font-size:12px;color:' + SENS[f.k][1])}>{SENS[f.k][0]}</div>
                                      </div>

                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {isPreview && isOpen && (
                      <div style={css('margin-top:8px;background:#fff;border:1px solid #DDE3EC;border-radius:12px;overflow:hidden')}>
                        <div style={css('padding:8px 16px;background:#0B2B49;color:#fff;font-size:12.5px;display:flex;gap:8px;align-items:center')}><span style={css('width:7px;height:7px;border-radius:50%;background:#74C05C')}></span>Viewing {p.name} as {who}</div>
                        <div style={css('padding:6px 16px;background:#F1F3F7;border-bottom:1px solid #EEF1F6;font-size:12px;color:#5C6B80')}>Policy preview — changes here affect this preview only and are not saved or enforced.</div>
                        {cats.map((c) => ({ name: c.name, visible: c.xs.filter((o) => o.x.view) })).filter((c) => c.visible.length).map((c) => (
                          <div key={c.name} style={css('padding:12px 16px 2px;animation:am-fade .3s ease both')}>
                            <div style={css('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5C6B80;margin-bottom:8px')}>{c.name}</div>
                            <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 20px;padding-bottom:10px')}>
                              {c.visible.map(({ f, x }) => (
                                <div key={f.id}>
                                  <div style={css('font-size:11.5px;color:#5C6B80;margin-bottom:3px')}>{f.n}</div>
                                  <div style={css(x.edit ? 'min-height:30px;display:flex;align-items:center;padding:0 10px;border:1px solid #C9D1DD;border-radius:8px;font-size:13.5px;background:#fff' : 'min-height:30px;display:flex;align-items:center;font-size:14px;font-weight:500')}>Sample value</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <div style={css('padding:9px 16px;border-top:1px solid #EEF1F6;background:#FAFAF7;font-size:12.5px;color:#5C6B80')}>{(n - v) + ' of ' + n + ' fields are Denied for ' + team + ' ' + LEVELS[lvl][0] + ' and are hidden.'}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={css('position:fixed;left:50%;bottom:20px;z-index:60;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 18px;border-radius:14px;background:#0B2B49;color:#fff;box-shadow:0 12px 40px rgba(15,41,66,.35);transition:transform .4s cubic-bezier(.34,1.4,.64,1),opacity .3s;transform:translate(-50%,' + (changes ? '0' : '140%') + ');opacity:' + (changes ? 1 : 0))} aria-hidden={changes ? undefined : true}>
        <span style={css('font-size:14px')}><b style={css('font-weight:600')}>{changes + (changes === 1 ? ' preview change' : ' preview changes')}</b></span>
        <button className="am-discard" onClick={() => setState((s) => ({ ...s, ov: JSON.parse(JSON.stringify(s.saved)) }))} style={css('height:34px;padding:0 14px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:transparent;color:#fff;font-size:14px;font-weight:500;cursor:pointer')}>Discard</button>
        <button className="am-save" onClick={() => setState((s) => ({ ...s, saved: JSON.parse(JSON.stringify(s.ov)) }))} style={css('height:34px;padding:0 16px;border:0;border-radius:8px;background:#74C05C;color:#0B2B49;font-size:14px;font-weight:600;cursor:pointer')}>Apply to preview</button>
      </div>
    </div>
  )
}

// pageScope is re-exported for tests that need the effective default scope of a page without rendering.
export { pageScope }
