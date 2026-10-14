/** Minimal blank 16:9 presentation: one master, one blank layout, one theme, one empty slide. */
import type { ZipEntry } from './officeZip.js'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`
const CT = 'application/vnd.openxmlformats-officedocument'

const rels = (items: [string, string][]) =>
  `${XML}<Relationships xmlns="${PKG_REL}">${items.map(([type, target], i) =>
    `<Relationship Id="rId${i + 1}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`

const EMPTY_TREE = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>'

const srgb = (name: string, hex: string) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`
const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
const line = (w: number) => `<a:ln w="${w}">${solid}</a:ln>`

const THEME = `${XML}<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements>`
  + '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
  + srgb('dk2', '1A2332') + srgb('lt2', 'F1F3F7') + srgb('accent1', '2F6FBF') + srgb('accent2', '2A7F6F') + srgb('accent3', 'C77A2A')
  + srgb('accent4', '7A5AC9') + srgb('accent5', 'B23A48') + srgb('accent6', '2F8F5B') + srgb('hlink', '2F6FBF') + srgb('folHlink', '7A5AC9')
  + '</a:clrScheme>'
  + '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + `<a:fmtScheme name="Office"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>`
  + `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>`
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>`
  + '</a:themeElements></a:theme>'

const MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

export function blankPptxEntries(): ZipEntry[] {
  return [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>`
      + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>`
      + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>`
      + `<Override PartName="/ppt/slides/slide1.xml" ContentType="${CT}.presentationml.slide+xml"/>`
      + `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>`
      + '</Types>' },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: 'ppt/presentation.xml', data: `${XML}<p:presentation ${NS}>`
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
      + '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>'
      + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>' },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([['slideMaster', 'slideMasters/slideMaster1.xml'], ['slide', 'slides/slide1.xml'], ['theme', 'theme/theme1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `${XML}<p:sldMaster ${NS}>${EMPTY_TREE}${MAP}`
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>' },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `${XML}<p:sldLayout ${NS} type="blank" preserve="1">${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slides/slide1.xml', data: `${XML}<p:sld ${NS}>${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>` },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
  ]
}
