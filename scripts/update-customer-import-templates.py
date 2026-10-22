from copy import copy
from pathlib import Path
from openpyxl.styles import Protection

from openpyxl import load_workbook

root = Path(__file__).resolve().parents[1]
template_dir = root / "assets" / "templates"
private_path = template_dir / "Customer_Import_Template.xlsx"
pool_path = template_dir / "Customer_Public_Pool_Import_Template.xlsx"

private_help = [
    ("必填项", "仅“客户名称”和“国家/地区”必填；公司名称、联系方式及其余资料均可留空。填写的内容会保存到客户资料。"),
    ("客户阶段", "仅用于“我的客户”；可填写潜在客户、意向客户、已成交客户。留空时按系统默认阶段处理；阶段不是必填项。"),
    ("客户等级", "仅用于“我的客户”；可填写 S、A、B、C、D。留空不影响导入；AI等级由系统按既定流程产生。"),
    ("地址信息", "公司地址、客户收货地址、货代地址和其他地址分别填写；所有非空地址都会保存到客户资料。"),
    ("重复客户", "系统按电话、WhatsApp、同一联系人/公司的邮箱和主体网址等识别重复项；共享邮箱本身不会使不同联系人被合并。请核对预览结果。"),
    ("AI资料", "AI评分、AI等级和分析结论由系统流程维护；导入文件中的来源字段不会覆盖系统生成结果。"),
    ("导入前检查", "仅填写“客户导入模板”工作表；标题行已锁定以防误改，导入列名为系统标准字段，请勿更改、删除、合并或调换。上传前检查必填项、列对应关系及重复/异常提示。"),
]
pool_help = [
    ("必填项", "仅“客户名称”和“国家/地区”必填；公司名称、联系方式及其余资料均可留空。填写的内容会保存到客户资料。"),
    ("公海状态", "本模板不提供客户阶段和客户等级列。通过本模板导入的新记录统一进入公海“待认领”状态，不会因来源资料改变公海工作流。"),
    ("来源状态字段", "如使用其他文件导入了客户阶段或等级，系统仅保留为来源信息，不作为公海状态或系统客户等级，也不改变“待认领”状态。"),
    ("地址信息", "公司地址、客户收货地址、货代地址和其他地址分别填写；所有非空地址都会保存到客户资料。"),
    ("重复客户", "系统按电话、WhatsApp、同一联系人/公司的邮箱和主体网址等识别重复项；共享邮箱本身不会使不同联系人被合并。请核对预览结果。"),
    ("AI资料", "AI评分、AI等级和分析结论由系统流程维护；导入文件中的来源字段不会覆盖系统生成结果。"),
    ("导入前检查", "仅填写“客户导入模板”工作表；标题行已锁定以防误改，导入列名为系统标准字段，请勿更改、删除、合并或调换。上传前检查必填项、列对应关系及重复/异常提示。"),
]

wb = load_workbook(private_path)
headers_sheet = wb["客户导入模板"]
headers_sheet.cell(1, 2).value = "公司名称"
example_sheet = wb["填写示例"]
example_sheet.cell(4, 2).value = "公司名称"
help_sheet = wb["填写说明"]
help_sheet.cell(1, 1).value = "填写说明｜我的客户导入模板"
for row, (title, body) in enumerate(private_help, start=4):
    help_sheet.cell(row, 1).value = title
    help_sheet.cell(row, 2).value = body
help_sheet.column_dimensions["A"].width = max(help_sheet.column_dimensions["A"].width or 0, 20)
help_sheet.column_dimensions["B"].width = max(help_sheet.column_dimensions["B"].width or 0, 92)
for row in range(4, 11):
    help_sheet.row_dimensions[row].height = max(help_sheet.row_dimensions[row].height or 0, 34)
wb.save(private_path)

def protect_template(path, data_sheet_name="客户导入模板", header_row=1, first_data_row=2, last_data_row=1001):
    book = load_workbook(path)
    sheet = book[data_sheet_name]
    sheet.protection.sheet = True
    sheet.protection.selectLockedCells = False
    sheet.protection.selectUnlockedCells = True
    for cell in sheet[header_row]:
        cell.protection = Protection(locked=True)
    for row in sheet.iter_rows(min_row=first_data_row, max_row=last_data_row, min_col=1, max_col=sheet.max_column):
        for cell in row:
            cell.protection = Protection(locked=False)
    for name in ("填写说明", "填写示例"):
        book[name].protection.sheet = True
        book[name].protection.selectLockedCells = False
        book[name].protection.selectUnlockedCells = False
    book.save(path)
    verified = load_workbook(path)
    assert verified[data_sheet_name].protection.sheet
    assert all(cell.protection.locked for cell in verified[data_sheet_name][header_row])
    assert all(not cell.protection.locked for cell in verified[data_sheet_name][first_data_row])
    assert verified["填写说明"].protection.sheet and verified["填写示例"].protection.sheet

# Build the pool template from the same source so its workbook styling stays aligned.
pool_wb = load_workbook(private_path)
pool_headers = pool_wb["客户导入模板"]
pool_headers.delete_cols(9, 2)  # stage and grade are not public-pool workflow inputs
pool_example = pool_wb["填写示例"]
pool_example.delete_cols(9, 2)
pool_help_sheet = pool_wb["填写说明"]
pool_help_sheet.cell(1, 1).value = "填写说明｜客户公海导入模板"
for row, (title, body) in enumerate(pool_help, start=4):
    pool_help_sheet.cell(row, 1).value = title
    pool_help_sheet.cell(row, 2).value = body
pool_help_sheet.column_dimensions["A"].width = max(pool_help_sheet.column_dimensions["A"].width or 0, 20)
pool_help_sheet.column_dimensions["B"].width = max(pool_help_sheet.column_dimensions["B"].width or 0, 92)
for row in range(4, 11):
    pool_help_sheet.row_dimensions[row].height = max(pool_help_sheet.row_dimensions[row].height or 0, 34)
for validation in list(pool_headers.data_validations.dataValidation):
    if any(ref.startswith("I") or ref.startswith("J") for ref in str(validation.sqref).split()):
        pool_headers.data_validations.dataValidation.remove(validation)
pool_wb.save(pool_path)
protect_template(private_path)
protect_template(pool_path)
