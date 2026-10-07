// Phone-friendly tables, for pages that ask for them.
//
// A table wider than a phone scrolls sideways inside its own box (prose.css), which
// keeps the page from overflowing but still asks the reader to pan across five
// columns to read one row. A page that sets `stackTables: true` in its front matter
// gets its tables restacked instead: below the breakpoint in prose.css each row
// becomes a small card, and each cell carries its column's name.
//
// CSS cannot read a column's header text from a cell, so the name is copied onto the
// cell here, at build time, as `data-label` — prose.css prints it with
// `attr(data-label)`. Doing it here rather than in the browser keeps the stacked
// layout correct before any script runs, and keeps the markdown itself plain: the
// markdown mirrors (/status.md and the rest) are built from the raw source, so
// nothing written here reaches a machine reader.
//
// Restacking sets `display: block` on the table's rows and cells, and some browsers
// then stop exposing the table to assistive technology. The explicit ARIA roles
// below keep it announced as a table whatever the CSS does to it.
//
// Pages that do not opt in are left exactly as markdown-it renders them.

import type MarkdownIt from "markdown-it";

type Token = ReturnType<MarkdownIt["parse"]>[number];

/** The plain text of a header cell, without the markup inside it. */
function textOf(inline: Token | undefined): string {
  return (inline?.children ?? [])
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("")
    .trim();
}

const ROLES: Record<string, string> = {
  table_open: "table",
  tr_open: "row",
  th_open: "columnheader",
  td_open: "cell",
};

export function stackTables(md: MarkdownIt): void {
  md.core.ruler.push("stack_tables", (state) => {
    if (!state.env?.stackTables) {
      return;
    }

    let labels: string[] = [];
    let column = 0;
    let inHead = false;

    state.tokens.forEach((token, i) => {
      const role = ROLES[token.type];

      if (role) {
        token.attrSet("role", role);
      }

      switch (token.type) {
        case "table_open":
          labels = [];
          break;
        case "thead_open":
          inHead = true;
          break;
        case "thead_close":
          inHead = false;
          break;
        case "tr_open":
          column = 0;
          break;
        case "th_open":
          if (inHead) {
            labels[column] = textOf(state.tokens[i + 1]);
          }
          column++;
          break;
        case "td_open": {
          const label = labels[column];

          if (label) {
            token.attrSet("data-label", label);
          }
          column++;
          break;
        }
      }
    });
  });
}
