# Example: a plan for "a budget for our family trip to Cornwall"

Look: the Budget template.

1. Budget: Date, Item, Category (drop-down: Travel, Stay, Food, Fun, Other), Planned (£), Spent (£), Difference = Planned - Spent; a total row with =SUM over each money column; data bars on Spent.
2. Summary: one row per category with =SUMIF(Budget!C:C, A5, Budget!E:E), the total, and a doughnut chart of spending by category.

Why it works: one table per sheet, money formatted as £, every total is a formula, and the drop-down keeps the categories the summary counts.
