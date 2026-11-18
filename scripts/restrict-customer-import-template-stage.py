from pathlib import Path

from openpyxl import load_workbook
from openpyxl.worksheet.datavalidation import DataValidation

path = Path(__file__).resolve().parents[1] / "assets/templates/Customer_Import_Template.xlsx"
book = load_workbook(path)
book["填写说明"]["B5"] = (
    "客户阶段不是必填项；批量导入仅支持潜在客户。"
    "意向客户或已成交客户请先导入为潜在客户，再逐个提交真实凭证完成阶段变更。"
)
sheet = book["客户导入模板"]
for validation in list(sheet.data_validations.dataValidation):
    if "I2:I1001" in str(validation.sqref):
        sheet.data_validations.dataValidation.remove(validation)
stage = DataValidation(type="list", formula1='"潜在客户"', allow_blank=True)
stage.error = "批量导入仅支持潜在客户"
stage.errorTitle = "客户阶段无效"
stage.showErrorMessage = True
sheet.add_data_validation(stage)
stage.add("I2:I1001")
book.save(path)
