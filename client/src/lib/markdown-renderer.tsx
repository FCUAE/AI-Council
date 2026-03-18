import { Fragment, ReactNode } from "react";

interface MarkdownTheme {
  text: string;
  heading1: string;
  heading2: string;
  heading3: string;
  bold: string;
  code: string;
  codeBlock: string;
  codeBlockBg: string;
  codeBlockBorder: string;
  codeBlockText: string;
  hr: string;
  bullet: string;
  bulletDot: string;
  numberedNum: string;
  tableWrapper: string;
  tableHeader: string;
  tableHeaderCell: string;
  tableRowEven: string;
  tableRowOdd: string;
  tableCell: string;
  tableBorder: string;
  blockquote: string;
  blockquoteText: string;
  link: string;
}

export const lightTheme: MarkdownTheme = {
  text: "text-[15px] leading-[1.8] text-[#2d2d2d]",
  heading1: "text-xl font-bold text-[#1a1a1a] mt-8 mb-4 pb-2 border-b border-[#eaeaea]",
  heading2: "text-[17px] font-semibold text-[#1a1a1a] mt-6 mb-3",
  heading3: "text-[15px] font-semibold text-[#1a1a1a] mt-5 mb-2",
  bold: "font-semibold text-[#1a1a1a]",
  code: "px-1.5 py-0.5 rounded bg-[#f0f0f0] font-mono text-[13px] text-[#4f46e5] border border-[#e5e5e5]",
  codeBlock: "my-4 rounded-md overflow-x-auto border border-[#e5e5e5]",
  codeBlockBg: "bg-[#f5f5f5] p-4 text-[13px] leading-[1.6] overflow-x-auto",
  codeBlockBorder: "border-[#e5e5e5]",
  codeBlockText: "font-mono text-[#2d2d2d]",
  hr: "my-6 border-t border-[#eaeaea]",
  bullet: "flex gap-3 text-[15px] leading-[1.8] text-[#2d2d2d] ml-1 my-1.5",
  bulletDot: "text-[#999] select-none mt-[2px]",
  numberedNum: "font-semibold text-[#999] select-none min-w-[22px] tabular-nums",
  tableWrapper: "my-4 overflow-x-auto rounded-md border border-[#eaeaea]",
  tableHeader: "bg-[#f0f0f0]",
  tableHeaderCell: "px-4 py-2.5 text-left font-semibold text-[#1a1a1a] border-b border-[#e5e5e5]",
  tableRowEven: "bg-white",
  tableRowOdd: "bg-[#fafafa]",
  tableCell: "px-4 py-2 text-[#2d2d2d] border-b border-[#f0f0f0]",
  tableBorder: "w-full text-[14px] border-collapse",
  blockquote: "my-4 pl-4 border-l-[3px] border-[#c7c7c7] bg-[#f9f9f9] rounded-r-md py-3 pr-4",
  blockquoteText: "text-[14px] leading-[1.7] text-[#666] italic",
  link: "underline text-[#4f46e5] hover:text-[#3730a3]",
};

export const darkTheme: MarkdownTheme = {
  text: "text-base md:text-lg leading-relaxed text-foreground/90",
  heading1: "text-xl font-bold text-foreground mb-3 mt-4",
  heading2: "text-lg font-semibold text-foreground mb-2 mt-3",
  heading3: "text-base font-semibold text-foreground mb-2 mt-2",
  bold: "font-semibold text-foreground",
  code: "px-1.5 py-0.5 rounded bg-white/10 font-mono text-sm text-cyan-300",
  codeBlock: "my-3 overflow-x-auto rounded-md border border-white/10 bg-black/30",
  codeBlockBg: "p-4 text-sm leading-relaxed",
  codeBlockBorder: "border-white/10",
  codeBlockText: "font-mono text-cyan-300/90",
  hr: "my-6 border-t border-white/10",
  bullet: "flex gap-3 my-1.5 ml-2",
  bulletDot: "text-purple-400 mt-1.5",
  numberedNum: "text-cyan-400 font-medium min-w-[1.5rem]",
  tableWrapper: "my-3 overflow-x-auto rounded-md border border-white/10",
  tableHeader: "border-b border-white/10 bg-white/5",
  tableHeaderCell: "px-4 py-2 text-left font-semibold text-foreground",
  tableRowEven: "",
  tableRowOdd: "bg-white/[0.02]",
  tableCell: "px-4 py-2",
  tableBorder: "w-full text-sm md:text-base text-foreground/90",
  blockquote: "my-3 border-l-4 border-purple-400/50 bg-white/5 rounded-r-md pl-4 pr-3 py-3",
  blockquoteText: "text-base md:text-lg leading-relaxed text-foreground/70 italic",
  link: "underline text-cyan-300 hover:text-cyan-200",
};

function parseInlineMarkdown(text: string, theme: MarkdownTheme, keyPrefix: string = "im"): ReactNode[] {
  const elements: ReactNode[] = [];
  let remaining = text;
  let tokenIdx = 0;

  while (remaining.length > 0) {
    const k = `${keyPrefix}-${tokenIdx++}`;
    const boldItalicMatch = remaining.match(/^(\*\*\*|___)(.+?)\1/);
    if (boldItalicMatch) {
      elements.push(<strong key={k} className={theme.bold}><em className="italic">{boldItalicMatch[2]}</em></strong>);
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      elements.push(<strong key={k} className={theme.bold}>{boldMatch[2]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch) {
      elements.push(<em key={k} className="italic">{italicMatch[2]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    const strikethroughMatch = remaining.match(/^~~(.+?)~~/);
    if (strikethroughMatch) {
      elements.push(<del key={k} className="line-through">{strikethroughMatch[1]}</del>);
      remaining = remaining.slice(strikethroughMatch[0].length);
      continue;
    }
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(<code key={k} className={theme.code}>{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const href = linkMatch[2];
      const isSafeUrl = /^https?:\/\//.test(href) || /^mailto:/.test(href);
      if (isSafeUrl) {
        elements.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer" className={theme.link}>{linkMatch[1]}</a>);
      } else {
        elements.push(<span key={k} className="underline">{linkMatch[1]}</span>);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }
    const nextSpecial = remaining.search(/[\*_`~\[]/);
    if (nextSpecial === -1) {
      elements.push(<Fragment key={k}>{remaining}</Fragment>);
      break;
    } else if (nextSpecial === 0) {
      elements.push(<Fragment key={k}>{remaining[0]}</Fragment>);
      remaining = remaining.slice(1);
    } else {
      elements.push(<Fragment key={k}>{remaining.slice(0, nextSpecial)}</Fragment>);
      remaining = remaining.slice(nextSpecial);
    }
  }
  return elements;
}

function parseTableRow(row: string): string[] {
  const trimmed = row.trim();
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const withoutTrailing = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutTrailing.split('|').map(cell => cell.trim());
}

function isTableSeparator(row: string): boolean {
  return /^\|?[\s\-:|]+\|?$/.test(row.trim()) && row.includes('-');
}

function isHorizontalRule(line: string): boolean {
  return /^[\s]*[-*_][\s]*[-*_][\s]*[-*_][\s]*[-*_\s]*$/.test(line) && /[-*_]{3,}/.test(line.replace(/\s/g, ''));
}

export function renderMarkdown(content: string, theme: MarkdownTheme): ReactNode {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let currentParagraph: ReactNode[] = [];
  let blockIdx = 0;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      elements.push(<p key={`p-${blockIdx++}`} className={theme.text}>{currentParagraph}</p>);
      currentParagraph = [];
    }
  };

  const inline = (text: string, prefix: string) => parseInlineMarkdown(text, theme, prefix);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <div key={`code-${blockIdx++}`} className={theme.codeBlock}>
          <pre className={theme.codeBlockBg}>
            <code className={theme.codeBlockText}>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      continue;
    }

    if (isHorizontalRule(trimmed)) {
      flushParagraph();
      elements.push(<hr key={`hr-${blockIdx++}`} className={theme.hr} />);
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      flushParagraph();
      const tableLines: string[] = [trimmed];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i++;
        tableLines.push(lines[i].trim());
      }

      let headerCells: string[] | null = null;
      const bodyRows: string[][] = [];

      if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
        headerCells = parseTableRow(tableLines[0]);
        for (let t = 2; t < tableLines.length; t++) {
          if (!isTableSeparator(tableLines[t])) bodyRows.push(parseTableRow(tableLines[t]));
        }
      } else {
        for (let t = 0; t < tableLines.length; t++) {
          if (!isTableSeparator(tableLines[t])) bodyRows.push(parseTableRow(tableLines[t]));
        }
      }

      elements.push(
        <div key={`tbl-${blockIdx++}`} className={theme.tableWrapper} data-testid="table-rendered">
          <table className={theme.tableBorder}>
            {headerCells && (
              <thead>
                <tr className={theme.tableHeader}>
                  {headerCells.map((cell, ci) => (
                    <th key={ci} className={theme.tableHeaderCell}>
                      {inline(cell, `th-${blockIdx}-${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className={`border-b ${ri % 2 === 0 ? theme.tableRowEven : theme.tableRowOdd}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={theme.tableCell}>
                      {inline(cell, `td-${blockIdx}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines: string[] = [trimmed.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) {
        i++;
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
      }
      elements.push(
        <blockquote key={`bq-${blockIdx++}`} className={theme.blockquote} data-testid="blockquote-rendered">
          {quoteLines.map((ql, qi) => (
            <p key={qi} className={theme.blockquoteText}>
              {inline(ql, `bq-${blockIdx}-${qi}`)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    const headerMatch = trimmed.match(/^(#{1,6})\s*(.+?)(?:\s+#+)?$/);
    if (headerMatch) {
      flushParagraph();
      const level = headerMatch[1].length;
      const headerText = headerMatch[2];
      const cls = level === 1 ? theme.heading1 : level === 2 ? theme.heading2 : theme.heading3;
      elements.push(<h3 key={`h-${blockIdx++}`} className={cls}>{inline(headerText, `h${i}`)}</h3>);
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const indentStyle = indent > 0 ? { marginLeft: `${Math.min(indent, 6) * 0.5}rem` } : undefined;
      elements.push(
        <div key={`n-${blockIdx++}`} className={theme.bullet} style={indentStyle}>
          <span className={theme.numberedNum}>{numberedMatch[1]}.</span>
          <span className="flex-1">{inline(numberedMatch[2], `n${i}`)}</span>
        </div>
      );
      continue;
    }

    const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const indentStyle = indent > 0 ? { marginLeft: `${Math.min(indent, 6) * 0.5}rem` } : undefined;
      elements.push(
        <div key={`b-${blockIdx++}`} className={theme.bullet} style={indentStyle}>
          <span className={theme.bulletDot}>•</span>
          <span className="flex-1">{inline(bulletMatch[1], `b${i}`)}</span>
        </div>
      );
      continue;
    }

    currentParagraph.push(...inline(trimmed, `l${i}`));
    if (i < lines.length - 1 && lines[i + 1].trim() !== '') {
      currentParagraph.push(<br key={`br-${i}`} />);
    }
  }
  flushParagraph();

  return <div className="space-y-4">{elements}</div>;
}
