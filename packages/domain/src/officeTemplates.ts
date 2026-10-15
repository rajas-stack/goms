/** Blank, valid Office Open XML files for "New" in the Document maker. Kept minimal on purpose: Word, Excel,
 *  PowerPoint and ONLYOFFICE all open them, and the editor writes a full package on the first save. */
import type { MakerFileType } from './makerDocuments.js'
import { createZip, type ZipEntry } from './officeZip.js'
import { blankPptxEntries } from './officeTemplatesPptx.js'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const OFFICE_DOC = `${DOC_REL}/officeDocument`

export function rootRels(target: string): ZipEntry {
  return { name: '_rels/.rels', data: `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${OFFICE_DOC}" Target="${target}"/></Relationships>` }
}

function blankDocxEntries(): ZipEntry[] {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  return [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>' },
    rootRels('word/document.xml'),
    { name: 'word/document.xml', data: `${XML}<w:document xmlns:w="${w}"><w:body><w:p/>`
      // A4 portrait with 1-inch margins.
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
      + '</w:body></w:document>' },
  ]
}

function blankXlsxEntries(): ZipEntry[] {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  return [
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>' },
    rootRels('xl/workbook.xml'),
    { name: 'xl/workbook.xml', data: `${XML}<workbook xmlns="${main}" xmlns:r="${DOC_REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML}<Relationships xmlns="${PKG_REL}">`
      + `<Relationship Id="rId1" Type="${DOC_REL}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="${DOC_REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: `${XML}<worksheet xmlns="${main}"><sheetData/></worksheet>` },
    { name: 'xl/styles.xml', data: `${XML}<styleSheet xmlns="${main}">`
      + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>' },
  ]
}

/** A new, empty file of the given type. */
export function blankOfficeFile(fileType: MakerFileType): Uint8Array {
  const entries = fileType === 'docx' ? blankDocxEntries() : fileType === 'xlsx' ? blankXlsxEntries() : blankPptxEntries()
  return createZip(entries)
}
