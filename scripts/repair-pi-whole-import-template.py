"""Preserve the existing PI workbook while repairing malformed OOXML cells."""

from pathlib import Path
from tempfile import NamedTemporaryFile
from xml.etree import ElementTree
from zipfile import ZipFile
import os


path = Path(__file__).resolve().parents[1] / "assets/templates/PI_Whole_Order_Import_Template.xlsx"
replacements = {
    '<x:c r="A4" s="5" t="str"><x:v>公司名称 *</x:v>'.encode():
        '<x:c r="A4" s="1" t="str"><x:v>公司名称（选填）</x:v>'.encode(),
    '需与我的客户资料一致；不自动创建客户'.encode():
        '可留空；填写时需与我的客户资料一致，导入后手动选择客户；不自动创建客户'.encode(),
    'YYYY-MM-DD；留空时由系统默认值预填并复核'.encode():
        'YYYY-MM-DD；留空时导入后手动填写并复核'.encode(),
}

with NamedTemporaryFile(dir=path.parent, suffix=".xlsx", delete=False) as temporary:
    temporary_path = Path(temporary.name)

try:
    with ZipFile(path) as source, ZipFile(temporary_path, "w") as output:
        for entry in source.infolist():
            data = source.read(entry.filename)
            if entry.filename.startswith("xl/worksheets/") and entry.filename.endswith(".xml"):
                data = data.replace(b't="str" t="inlineStr"', b't="inlineStr"')
                if entry.filename == "xl/worksheets/sheet1.xml":
                    for old, new in replacements.items():
                        if data.count(old) != 1:
                            raise ValueError(f"Expected exactly one original PI template value: {old!r}")
                        data = data.replace(old, new)
                ElementTree.fromstring(data)
            output.writestr(entry, data)
    os.replace(temporary_path, path)
finally:
    temporary_path.unlink(missing_ok=True)

