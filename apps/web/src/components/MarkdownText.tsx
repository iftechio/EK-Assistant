import type { ReactNode } from 'react'
import { safeHref } from '../safeHref'

export default function MarkdownText({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="markdown-text">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3')
            return <Tag key={index}>{renderInline(block.text)}</Tag>
          }
          case 'list':
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ul>
            )
          case 'ordered-list':
            return (
              <ol key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote key={index}>
                {block.lines.map((line, lineIndex) => (
                  <p key={lineIndex}>{renderInline(line)}</p>
                ))}
              </blockquote>
            )
          case 'table':
            return (
              <div key={index} className="md-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex}>{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr key={index} />
          default:
            return <p key={index}>{renderInline(block.text)}</p>
        }
      })}
    </div>
  )
}

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' }

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line)
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let orderedList: string[] = []
  let quote: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push({ type: 'list', items: list })
    list = []
  }
  const flushOrderedList = () => {
    if (!orderedList.length) return
    blocks.push({ type: 'ordered-list', items: orderedList })
    orderedList = []
  }
  const flushQuote = () => {
    if (!quote.length) return
    blocks.push({ type: 'quote', lines: quote })
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushOrderedList()
    flushQuote()
  }

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      flushAll()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushAll()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushAll()
      blocks.push({ type: 'hr' })
      continue
    }

    // 表格：本行以 | 开头，下一行是分隔行
    if (line.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1].trim())) {
      flushAll()
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 1 // 跳过分隔行
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i += 1
        rows.push(splitTableRow(lines[i].trim()))
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      flushOrderedList()
      quote.push(quoteMatch[1])
      continue
    }
    flushQuote()

    const listMatch = line.match(/^[-*]\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      flushOrderedList()
      list.push(listMatch[1])
      continue
    }
    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      flushList()
      orderedList.push(orderedMatch[1])
      continue
    }
    flushList()
    flushOrderedList()
    paragraph.push(line)
  }

  flushAll()
  return blocks
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={nodes.length}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      nodes.push(<em key={nodes.length}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = safeHref(link?.[2])
      if (link && href) {
        nodes.push(
          <a key={nodes.length} href={href} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        )
      } else {
        // 协议不安全（如 javascript:）或格式不对：按纯文本展示，不产生可点击链接
        nodes.push(link?.[1] ?? token)
      }
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}
