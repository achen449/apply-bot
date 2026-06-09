# Customer Standard Merge Summary

Generated: 2026-06-08T06:16:18Z

## Output Paths
- JSON dataset: `C:\Users\ADMIN\apply-bot\data\customer-data.json`
- Excel handoff: `C:\Users\ADMIN\apply-bot\data\customer-data.xlsx`
- Summary log: `C:\Users\ADMIN\apply-bot\merge-clients-summary.md`

## Source Workbooks
- Primary authoritative: `C:\Users\ADMIN\Documents\Downloads\clients-standard(2)(1).xlsx`
- Secondary supplemental: `C:\Users\ADMIN\Documents\Downloads\clients-standard (1)(1).xlsx`

## Merge Rules Applied
- Primary values are authoritative whenever primary and secondary both have nonblank conflicting values.
- Secondary values fill primary blanks only, including progress/remark fields such as `目前进度`, `跟进情况`, `项目线索`, and `最后跟进时间`.
- Customer identity key strength: company name + website, then company name + email, then company name + phone, then company name alone.
- Secondary-only rows were retained as historical supplemental customers because they are existing rows absent from the new primary workbook, and each is marked `secondary-only-historical` in the output.

## Counts
- Primary input rows: 56
- Primary unique rows after duplicate merge: 55
- Secondary input rows: 68
- Secondary unique rows after duplicate merge: 65
- Primary/secondary matched customers: 43
- Secondary-only historical customers retained: 22
- Final customer rows: 77
- Primary duplicate rows merged: 1
- Secondary duplicate rows merged: 3
- Conflicts resolved with primary winning: 48
- Blank primary fields filled from secondary: 71

## Column Mapping
The two workbooks use the same customer columns, with the secondary workbook adding `最后跟进时间`. The output keeps all source columns plus `数据来源` and `合并说明`.
