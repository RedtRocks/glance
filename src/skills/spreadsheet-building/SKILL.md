---
name: spreadsheet-building
description: How to build or change a spreadsheet in Glance (.xlsx or .csv) so it is clear, correct and stays live, such as a budget, a project plan, a grade book or a tracker. Covers structure, formulas, number formats, charts and validation. Use with glance_create kind spreadsheet and the glance_sheet tools.
metadata:
  kinds: spreadsheet
  when: create, edit
---

# Spreadsheet building

Glance edits .xlsx and .csv files directly. You set cells, formulas, formats and rules with glance_sheet_edit; Glance recalculates and draws them. Never write a file, a script or a macro yourself, and never type a result that a formula should compute.

## Structure

- One table per sheet where you can: a title row, then one header row, then one row per thing (an expense, a task, a pupil, a day). Freeze the header row.
- One kind of value per column: numbers, dates, text, or TRUE/FALSE ticks. Units go in the header ("Cost (£)"), not in the cells.
- Totals and summaries go below the table or on a separate Summary sheet, never in the middle of the data.
- Name sheets for what they hold ("Budget", "Summary"), short and without dates.
- Keep a template's layout, fills and banner; replace its sample rows with the person's rows.

## Formulas

- Totals with SUM, averages with AVERAGE, counts with COUNTIF or COUNTA, conditional sums with SUMIF, progress as done / total formatted as a percentage, a running balance as the previous balance plus this row.
- Reference ranges, not single cells added one by one: =SUM(D5:D16), not =D5+D6+D7.
- Cross-sheet references for summaries: =SUM(Budget!D5:D16).
- Guard divisions: =IF(C5=0,"",B5/C5), so an empty row isn't #DIV/0!.
- When you add rows, extend the formulas, conditional formatting and charts that cover the table.

## Formats

- Money as currency with two decimals (or none for whole pounds), percentages as %, dates as dates (not text), long numbers with thousands separators.
- Right-align numbers, left-align text. Wrap long text rather than widening a column past about 40 characters.

## Charts and rules

- A chart only when it answers a question: a bar chart to compare categories, a line chart for change over time, a doughnut for parts of one whole (at most six parts). Give it a title that says what it shows.
- Conditional formatting sparingly: data bars for amounts, a colour scale for scores, an icon set or a red fill for overdue or over budget.
- Validation where people type: a drop-down list for status or category, a tick box for done, a number or date rule where a wrong value would break a formula.

## Facts

Use the person's numbers. If you are filling example rows for a topic, make them realistic and say they are examples; leave unknown amounts, names and dates as placeholders like [amount] rather than inventing exact figures.

## Finish

1. glance_sheet_check and fix every finding: formula errors (#REF!, #DIV/0!, #VALUE!), broken references, text in number columns.
2. glance_sheet_render the sheet and look: cut-off headers, ##### in narrow columns, a chart that covers data.
3. Tell the person in a sentence or two what you built and which cells are left for them.
